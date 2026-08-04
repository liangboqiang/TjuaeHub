import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const JSZip = require('jszip');
const {
  findSecretPatterns,
  findSensitiveValues,
  scanRepository,
  scanSourcePackage,
  scanZipArchive,
  validatePublishablePath,
  validateSafeRelativePath,
} = require('../scripts/quality/check-security');
const securityCases = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'security-gate-cases.json'), 'utf8')
);

function writeFixtureFiles(root, entries) {
  for (const entry of entries) {
    const fullPath = path.join(root, ...entry.path.split('/'));
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, entry.content);
  }
}

async function writeFixtureArchive(archivePath, entries) {
  const archive = new JSZip();
  for (const entry of entries) {
    archive.file(entry.path, entry.content);
  }
  fs.writeFileSync(archivePath, await archive.generateAsync({ type: 'nodebuffer' }));
}

function expectEachPathRejected(violations, entries) {
  for (const entry of entries) {
    expect(
      violations.some((violation) => {
        const sourcePath = violation.source.split('#/', 1)[0];
        return sourcePath.endsWith(entry.path) || sourcePath.endsWith(`:${entry.path}`);
      }),
      `应拒绝 ${entry.path}，实际违规：${JSON.stringify(violations)}`
    ).toBe(true);
  }
}

describe('敏感信息与路径安全门禁', () => {
  it('当前源码与分发产物均通过安全扫描', async () => {
    await expect(scanRepository({ includeDist: true })).resolves.toEqual([]);
  });

  it('拒绝字面量凭据但允许环境变量占位符', () => {
    expect(
      findSensitiveValues({
        env: {
          OPENAI_API_KEY: 'sk-this-is-a-real-looking-secret-value',
          SAFE_API_KEY: '${SAFE_API_KEY}',
        },
        headers: {
          authorization: 'Bearer literal-secret-token-value',
        },
      })
    ).toHaveLength(2);
  });

  it('占位符必须是完整语法或严格等值，不能用前缀和子串绕过', () => {
    expect(
      findSensitiveValues({
        refreshToken: 'YOUR_REAL_PASSWORD_hunter2',
        secretValue: 'abcREDACTEDactual-secret',
      })
    ).toHaveLength(2);
    expect(findSecretPatterns('password=abcREDACTEDactual-secret')).toHaveLength(1);
    expect(
      findSensitiveValues({
        refreshToken: '${REFRESH_TOKEN}',
        secretValue: 'REDACTED',
      })
    ).toEqual([]);
  });

  it('识别高置信度密钥格式', () => {
    expect(findSecretPatterns('token=github_pat_abcdefghijklmnopqrstuvwxyz1234567890ABCDEFGHIJ')).toHaveLength(1);
    expect(findSecretPatterns('普通扩展说明')).toEqual([]);
  });

  it.each([
    '../outside.json',
    'nested/../../outside.json',
    '/absolute.json',
    'C:/absolute.json',
    '\\\\server\\share.json',
    'nested\\file.json',
    'nested//file.json',
  ])('拒绝不安全路径 %s', (unsafePath) => {
    expect(validateSafeRelativePath(unsafePath)).toBeTruthy();
  });

  it.each(['resources/icon.svg', 'contributes/nested/skills.json', 'SKILL.md'])('接受可移植相对路径 %s', (safePath) => {
    expect(validateSafeRelativePath(safePath)).toBeUndefined();
  });

  it.each(securityCases.forbiddenPaths)('拒绝敏感文件或点路径 %s', (forbiddenPath) => {
    expect(validatePublishablePath(forbiddenPath)).toBeTruthy();
  });

  it('源码与 ZIP 对敏感路径和内容执行相同的 fail-closed 扫描', async () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tjuae-hub-security-'));
    try {
      const invalidEntries = [
        ...securityCases.forbiddenPaths.map((entryPath) => ({
          path: entryPath,
          content: 'fixture',
        })),
        ...securityCases.unsafeContents,
      ];
      const sourceRoot = path.join(temporaryRoot, 'tjuaeasset-security-source');
      fs.mkdirSync(sourceRoot, { recursive: true });
      writeFixtureFiles(sourceRoot, invalidEntries);
      const sourceViolations = scanSourcePackage(sourceRoot);
      expectEachPathRejected(sourceViolations, invalidEntries);

      const archivePath = path.join(temporaryRoot, 'tjuaeasset-security-archive.zip');
      await writeFixtureArchive(archivePath, invalidEntries);
      const archiveViolations = await scanZipArchive(archivePath);
      expectEachPathRejected(archiveViolations, invalidEntries);
    } finally {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it('源码与 ZIP 均允许占位凭据和普通文本/图片资源', async () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tjuae-hub-security-safe-'));
    try {
      const sourceRoot = path.join(temporaryRoot, 'tjuaeasset-security-safe');
      fs.mkdirSync(sourceRoot, { recursive: true });
      writeFixtureFiles(sourceRoot, securityCases.safeContents);
      expect(scanSourcePackage(sourceRoot)).toEqual([]);

      const archivePath = path.join(temporaryRoot, 'tjuaeasset-security-safe.zip');
      await writeFixtureArchive(archivePath, securityCases.safeContents);
      await expect(scanZipArchive(archivePath)).resolves.toEqual([]);
    } finally {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it('ZIP 使用未清洗的原始条目名拒绝路径穿越', async () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tjuae-hub-security-path-'));
    try {
      const archivePath = path.join(temporaryRoot, 'tjuaeasset-unsafe-path.zip');
      await writeFixtureArchive(archivePath, [{ path: '../escape.txt', content: 'fixture' }]);
      const violations = await scanZipArchive(archivePath);
      expect(violations.some((violation) => violation.source.includes('../escape.txt'))).toBe(true);
    } finally {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it('拒绝无法扫描且不在二进制资源白名单中的文件', async () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tjuae-hub-security-binary-'));
    try {
      const sourceRoot = path.join(temporaryRoot, 'tjuaeasset-unknown-binary');
      fs.mkdirSync(sourceRoot, { recursive: true });
      fs.writeFileSync(path.join(sourceRoot, 'payload.bin'), Buffer.from([0xff, 0xfe, 0xfd]));
      expect(scanSourcePackage(sourceRoot).some((violation) => violation.source.endsWith('payload.bin'))).toBe(true);

      const archive = new JSZip();
      archive.file('payload.bin', Buffer.from([0xff, 0xfe, 0xfd]));
      const archivePath = path.join(temporaryRoot, 'tjuaeasset-unknown-binary.zip');
      fs.writeFileSync(archivePath, await archive.generateAsync({ type: 'nodebuffer' }));
      const archiveViolations = await scanZipArchive(archivePath);
      expect(archiveViolations.some((violation) => violation.source.endsWith(':payload.bin'))).toBe(true);
    } finally {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });
});
