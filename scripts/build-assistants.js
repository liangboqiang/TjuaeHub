const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const { comparePortable, createValidator, directoryDigest, fileIndex, listFiles } = require('./catalog-utils');

const ASSISTANT_SCHEMA_URL =
  'https://raw.githubusercontent.com/liangboqiang/TjuaeHub/main/schemas/tjuae-assistant.v1.schema.json';
const ASSISTANT_INDEX_SCHEMA_URL =
  'https://raw.githubusercontent.com/liangboqiang/TjuaeHub/main/schemas/assistant-index.v1.schema.json';
const MARKET_ID = 'tjuae-hub';
const MARKET_NAME = 'TjuaeHub';
const REPOSITORY_URL = 'https://github.com/liangboqiang/TjuaeHub.git';
const ASSISTANT_MANIFEST_FILE = '_meta.json';
const ASSISTANT_ENTRY_FILE = 'ASSISTANT.md';
const DIGEST_PREFIX = 'tjuae-assistant-workspace-v1';

function assistantDigest(directory, files = listFiles(directory, '助手')) {
  return directoryDigest(directory, ASSISTANT_MANIFEST_FILE, DIGEST_PREFIX, files);
}

function readVersionFromGit(repositoryRoot, directoryName, revision) {
  const prefix = `assistants/${directoryName}`;
  const read = (relative) =>
    execFileSync('git', ['show', `${revision}:${prefix}/${relative}`], {
      cwd: repositoryRoot,
      encoding: null,
      maxBuffer: 32 * 1024 * 1024,
    });
  const manifest = JSON.parse(read(ASSISTANT_MANIFEST_FILE).toString('utf8'));
  if (manifest.id !== directoryName) throw new Error(`${directoryName}@${revision} 的助手 ID 无效`);
  const names = execFileSync('git', ['ls-tree', '-r', '--name-only', revision, '--', prefix], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  })
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((name) => name.slice(prefix.length + 1))
    .sort(comparePortable);
  const files = names.map((name) => ({ name, contents: read(name) }));
  const digest = crypto.createHash('sha256');
  digest.update(`${DIGEST_PREFIX}\0`);
  for (const file of files.filter((file) => file.name !== ASSISTANT_MANIFEST_FILE)) {
    digest.update(file.name);
    digest.update('\0');
    digest.update(file.contents);
    digest.update('\0');
  }
  const contentHash = `sha256-${digest.digest('hex')}`;
  if (manifest.contentHash !== contentHash) {
    throw new Error(`${directoryName}@${revision} 的 contentHash 与助手内容不一致`);
  }
  return {
    version: manifest.version,
    revision,
    digest: contentHash,
    readme: read(manifest.instructions.default).toString('utf8').trim(),
    files: files.map((file) => ({
      path: file.name,
      size: file.contents.length,
      sha256: crypto.createHash('sha256').update(file.contents).digest('hex'),
    })),
  };
}

function assistantVersions(repositoryRoot, row, sourceRevision) {
  const current = {
    version: row.manifest.version,
    revision: sourceRevision,
    digest: row.digest,
    readme: fs.readFileSync(path.join(row.assistantPath, row.manifest.instructions.default), 'utf8').trim(),
    files: fileIndex(row.assistantPath, row.files),
  };
  let revisions = [];
  try {
    revisions = execFileSync(
      'git',
      ['log', '--format=%H', '--follow', '--', `assistants/${row.directoryName}/${ASSISTANT_MANIFEST_FILE}`],
      { cwd: repositoryRoot, encoding: 'utf8' }
    )
      .split(/\r?\n/u)
      .filter(Boolean);
  } catch {
    // 新助手尚未提交时只有当前工作副本版本。
  }
  const versions = [current];
  const seen = new Set([current.version]);
  for (const revision of revisions) {
    try {
      const candidate = readVersionFromGit(repositoryRoot, row.directoryName, revision);
      if (!seen.has(candidate.version)) {
        seen.add(candidate.version);
        versions.push(candidate);
      }
    } catch (error) {
      if (revision === sourceRevision) throw error;
    }
  }
  return versions;
}

function validateOfficialAssistants(repositoryRoot) {
  const assistantsRoot = path.join(repositoryRoot, 'assistants');
  const validate = createValidator(
    path.join(repositoryRoot, 'schemas', 'tjuae-assistant.v1.schema.json'),
    ASSISTANT_SCHEMA_URL,
    '助手'
  );
  const directories = fs
    .readdirSync(assistantsRoot, { withFileTypes: true })
    // TjuaeUI 管家属于每台设备的本地系统助手，不能进入远程官方市场。
    .filter((entry) => entry.isDirectory() && entry.name !== 'tjuaeui-assistant')
    .sort((left, right) => comparePortable(left.name, right.name));
  if (directories.length === 0) throw new Error('TjuaeHub 至少需要一个官方助手');
  const ids = new Set();
  return directories.map((directory) => {
    const assistantPath = path.join(assistantsRoot, directory.name);
    const manifestPath = path.join(assistantPath, ASSISTANT_MANIFEST_FILE);
    if (!fs.existsSync(manifestPath)) throw new Error(`${directory.name} 缺少 ${ASSISTANT_MANIFEST_FILE}`);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (!validate(manifest)) {
      throw new Error(`${directory.name} 未通过助手模式：${JSON.stringify(validate.errors)}`);
    }
    if (manifest.id !== directory.name || ids.has(manifest.id)) {
      throw new Error(`${directory.name} 的助手 ID 与目录不一致或重复`);
    }
    ids.add(manifest.id);
    const entryPath = path.join(assistantPath, manifest.instructions.default);
    if (!fs.existsSync(entryPath) || !fs.statSync(entryPath).isFile()) {
      throw new Error(`${directory.name} 的默认规则文件不存在：${manifest.instructions.default}`);
    }
    const files = listFiles(assistantPath, '助手');
    for (const rulePath of Object.values(manifest.instructions.locales)) {
      if (!fs.existsSync(path.join(assistantPath, rulePath))) {
        throw new Error(`${directory.name} 的本地化规则文件不存在：${rulePath}`);
      }
    }
    if (
      manifest.avatar &&
      !manifest.avatar.startsWith('emoji:') &&
      !fs.existsSync(path.join(assistantPath, manifest.avatar))
    ) {
      throw new Error(`${directory.name} 的头像文件不存在：${manifest.avatar}`);
    }
    const digest = assistantDigest(assistantPath, files);
    if (manifest.contentHash !== digest) {
      throw new Error(`${directory.name} 的 contentHash 与助手内容不一致`);
    }
    return { directoryName: directory.name, assistantPath, manifest, files, digest };
  });
}

async function buildOfficialAssistants({ repositoryRoot, distDirectory, sourceRevision }) {
  const rows = validateOfficialAssistants(repositoryRoot);
  const index = {
    $schema: ASSISTANT_INDEX_SCHEMA_URL,
    schemaVersion: 1,
    market: { id: MARKET_ID, name: MARKET_NAME },
    repository: REPOSITORY_URL,
    revision: sourceRevision,
    assistants: rows.map((row) => ({
      id: row.manifest.id,
      path: `assistants/${row.directoryName}`,
      name: row.manifest.name,
      description: row.manifest.description,
      ...(row.manifest.avatar ? { avatar: row.manifest.avatar } : {}),
      categories: row.manifest.categories,
      tags: row.manifest.tags,
      latestVersion: row.manifest.version,
      versions: assistantVersions(repositoryRoot, row, sourceRevision),
    })),
  };
  const validateIndex = createValidator(
    path.join(repositoryRoot, 'schemas', 'assistant-index.v1.schema.json'),
    ASSISTANT_INDEX_SCHEMA_URL,
    '助手索引'
  );
  if (!validateIndex(index)) throw new Error(`助手索引未通过模式：${JSON.stringify(validateIndex.errors)}`);
  const indexBytes = Buffer.from(`${JSON.stringify(index, null, 2)}\n`);
  fs.writeFileSync(path.join(distDirectory, 'assistants.json'), indexBytes);
  return { index, indexBytes, assistantCount: index.assistants.length };
}

module.exports = {
  ASSISTANT_INDEX_SCHEMA_URL,
  ASSISTANT_MANIFEST_FILE,
  ASSISTANT_SCHEMA_URL,
  assistantDigest,
  assistantVersions,
  buildOfficialAssistants,
  validateOfficialAssistants,
};
