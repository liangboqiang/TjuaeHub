import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const { validateBuild, validateIndexShape, validateOfflineSeed } = require('../scripts/quality/check-build');

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const distDirectory = path.join(repositoryRoot, 'dist');
const readIndex = () => JSON.parse(fs.readFileSync(path.join(distDirectory, 'index.json'), 'utf8'));

describe('原子资产构建产物', () => {
  it('源码、索引、归档和四类官方离线种子完全一致', async () => {
    await expect(validateBuild()).resolves.toEqual({ packageCount: 23, assetCount: 23 });
  });

  it('每个原子包都使用 assets 路径、新清单和内容寻址摘要', () => {
    const index = readIndex();
    for (const [name, entry] of Object.entries(index.packages)) {
      expect(entry).toMatchObject({
        name,
        atomic: true,
        assetIds: [expect.stringMatching(new RegExp(`^${name}/`))],
        sourcePath: `assets/${name}`,
        manifestPath: `assets/${name}/asset-package.json`,
        tarball: `${name}.zip`,
      });
      expect(entry.integrity).toMatch(/^sha256-[0-9a-f]{64}$/u);
      expect(entry.archiveIntegrity).toMatch(/^sha256-[0-9a-f]{64}$/u);
    }
  });

  it('离线种子确定性覆盖 assistant/engineAdapter/mcp/skill', async () => {
    const index = readIndex();
    await expect(validateOfflineSeed(index)).resolves.toMatchObject({
      bundleFileName: expect.stringMatching(/^tjuae-seed-[0-9a-f]{64}\.zip$/u),
    });
    const seed = JSON.parse(fs.readFileSync(path.join(distDirectory, 'seed-manifest.json'), 'utf8'));
    expect(seed.assetKinds).toEqual(['assistant', 'engineAdapter', 'mcp', 'skill']);
  });

  it('dist 只包含索引、种子与 tjuaeasset 归档', () => {
    const files = fs.readdirSync(distDirectory);
    expect(files).toContain('index.json');
    expect(files).toContain('seed-manifest.json');
    expect(files.some((name) => /^tjuae-seed-[0-9a-f]{64}\.zip$/u.test(name))).toBe(true);
    for (const file of files.filter((name) => name.endsWith('.zip') && !name.startsWith('tjuae-seed-'))) {
      expect(file).toMatch(/^tjuaeasset-[a-z0-9-]+\.zip$/u);
    }
  });

  it('拒绝旧索引构建器身份', () => {
    const index = readIndex();
    expect(() => validateIndexShape({ ...index, schemaVersion: 1 })).toThrow('模式或构建器');
    expect(() =>
      validateIndexShape({ ...index, metadata: { ...index.metadata, generatedBy: 'legacy builder' } })
    ).toThrow('模式或构建器');
  });

  it('工作流通过统一 verify 构建和校验资产', () => {
    const workflow = fs.readFileSync(path.join(repositoryRoot, '.github/workflows/build-assets.yml'), 'utf8');
    expect(workflow).toContain('bun run verify');
    expect(workflow).toContain("- 'assets/**'");
    expect(workflow).toContain("- 'submissions/**'");
  });
});
