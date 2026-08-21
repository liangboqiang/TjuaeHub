const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const {
  comparePortable,
  createValidator,
  directoryDigest: catalogDirectoryDigest,
  fileIndex,
  listFiles,
} = require('./catalog-utils');

const SKILL_SCHEMA_URL =
  'https://raw.githubusercontent.com/liangboqiang/TjuaeHub/main/schemas/tjuae-skill.v1.schema.json';
const SKILL_INDEX_SCHEMA_URL =
  'https://raw.githubusercontent.com/liangboqiang/TjuaeHub/main/schemas/skill-index.v1.schema.json';
const MARKET_ID = 'tjuae-hub';
const MARKET_NAME = 'TjuaeHub';
const REPOSITORY_URL = 'https://github.com/liangboqiang/TjuaeHub.git';
const SKILL_MANIFEST_FILE = '_meta.json';
function directoryDigest(skillPath, files = listFiles(skillPath)) {
  return catalogDirectoryDigest(skillPath, SKILL_MANIFEST_FILE, 'tjuae-skill-workspace-v1', files);
}

function versionFromGit(repositoryRoot, directoryName, revision) {
  const prefix = `skills/${directoryName}`;
  const read = (relative) =>
    execFileSync('git', ['show', `${revision}:${prefix}/${relative}`], {
      cwd: repositoryRoot,
      encoding: null,
      maxBuffer: 32 * 1024 * 1024,
    });
  const manifest = JSON.parse(read(SKILL_MANIFEST_FILE).toString('utf8'));
  if (manifest.id !== directoryName) throw new Error(`${directoryName}@${revision} 的技能 ID 无效`);
  const frontmatter = parseFrontmatter(read('SKILL.md').toString('utf8'), `${directoryName}@${revision}/SKILL.md`);
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
  digest.update('tjuae-skill-workspace-v1\0');
  for (const file of files.filter((file) => file.name !== SKILL_MANIFEST_FILE)) {
    digest.update(file.name);
    digest.update('\0');
    digest.update(file.contents);
    digest.update('\0');
  }
  const contentHash = `sha256-${digest.digest('hex')}`;
  if (manifest.contentHash !== contentHash) {
    throw new Error(`${directoryName}@${revision} 的 contentHash 与技能内容不一致`);
  }
  return {
    version: manifest.version,
    revision,
    digest: contentHash,
    readme: frontmatter.body,
    files: files.map((file) => ({
      path: file.name,
      size: file.contents.length,
      sha256: crypto.createHash('sha256').update(file.contents).digest('hex'),
    })),
  };
}

function skillVersions(repositoryRoot, row, sourceRevision) {
  const current = versionFromGit(repositoryRoot, row.directoryName, sourceRevision);
  if (current.version !== row.manifest.version) {
    throw new Error(`${row.directoryName} 的工作副本版本尚未提交到源修订 ${sourceRevision}`);
  }
  let revisions = [];
  try {
    revisions = execFileSync(
      'git',
      ['log', '--format=%H', '--follow', '--', `skills/${row.directoryName}/${SKILL_MANIFEST_FILE}`],
      { cwd: repositoryRoot, encoding: 'utf8' }
    )
      .split(/\r?\n/u)
      .filter(Boolean);
  } catch {
    // A newly-created, uncommitted package has no history yet. The current
    // version above remains a complete deterministic index entry.
  }
  const versions = [current];
  const seen = new Set([current.version]);
  for (const revision of revisions) {
    try {
      const candidate = versionFromGit(repositoryRoot, row.directoryName, revision);
      if (!seen.has(candidate.version)) {
        seen.add(candidate.version);
        versions.push(candidate);
      }
    } catch {
      // 当前工作副本已完整校验。旧提交若来自历史协议或不同换行约定，
      // 只跳过该历史版本，不能让整个市场目录失效。
    }
  }
  return versions;
}

function parseFrontmatter(source, label) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u);
  if (!match) throw new Error(`${label} 缺少 YAML frontmatter`);
  const lines = match[1].split(/\r?\n/u);
  const nameLine = lines.find((line) => /^name:\s*/u.test(line));
  const name = nameLine
    ?.replace(/^name:\s*/u, '')
    .trim()
    .replace(/^(['"])(.*)\1$/u, '$2');
  const descriptionIndex = lines.findIndex((line) => /^description:\s*/u.test(line));
  if (!name || descriptionIndex < 0) throw new Error(`${label} 的 frontmatter 必须包含 name 与 description`);
  const rawDescription = lines[descriptionIndex].replace(/^description:\s*/u, '').trim();
  let description;
  if (rawDescription === '|' || rawDescription === '>') {
    const block = [];
    for (const line of lines.slice(descriptionIndex + 1)) {
      if (!/^\s+/u.test(line)) break;
      block.push(line.trim());
    }
    description = block.join(' ');
  } else {
    description = rawDescription.replace(/^(['"])(.*)\1$/u, '$2');
  }
  if (!description) throw new Error(`${label} 的 description 不能为空`);
  const body = source.slice(match[0].length).trim();
  if (!body) throw new Error(`${label} 的正文不能为空`);
  return { name, description, body };
}

function validateMarketSkills(
  repositoryRoot,
  sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }).trim()
) {
  const skillsRoot = path.join(repositoryRoot, 'skills');
  const validate = createValidator(
    path.join(repositoryRoot, 'schemas', 'tjuae-skill.v1.schema.json'),
    SKILL_SCHEMA_URL,
    '技能'
  );
  const directories = fs
    .readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => comparePortable(left.name, right.name));
  if (directories.length === 0) throw new Error('TjuaeHub 至少需要一个市场技能');
  const ids = new Set();
  return directories.map((directory) => {
    const skillPath = path.join(skillsRoot, directory.name);
    const manifestPath = path.join(skillPath, SKILL_MANIFEST_FILE);
    const entryPath = path.join(skillPath, 'SKILL.md');
    if (!fs.existsSync(manifestPath) || !fs.existsSync(entryPath)) {
      throw new Error(`${directory.name} 必须同时包含 ${SKILL_MANIFEST_FILE} 与 SKILL.md`);
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (!validate(manifest)) {
      throw new Error(`${directory.name} 未通过技能模式：${JSON.stringify(validate.errors)}`);
    }
    if (manifest.id !== directory.name || ids.has(manifest.id)) {
      throw new Error(`${directory.name} 的技能 ID 与目录不一致或重复`);
    }
    ids.add(manifest.id);
    const frontmatter = parseFrontmatter(fs.readFileSync(entryPath, 'utf8'), `${directory.name}/SKILL.md`);
    const files = listFiles(skillPath, '技能');
    const committed = versionFromGit(repositoryRoot, directory.name, sourceRevision);
    if (manifest.version !== committed.version || manifest.contentHash !== committed.digest) {
      throw new Error(`${directory.name} 的工作副本清单尚未提交到源修订 ${sourceRevision}`);
    }
    return { directoryName: directory.name, skillPath, manifest, frontmatter, files, digest: committed.digest };
  });
}

function validateOfficialSkills(repositoryRoot) {
  return validateMarketSkills(repositoryRoot);
}

async function buildOfficialSkills({ repositoryRoot, distDirectory, sourceRevision }) {
  const rows = validateMarketSkills(repositoryRoot, sourceRevision);
  const index = {
    $schema: SKILL_INDEX_SCHEMA_URL,
    schemaVersion: 1,
    market: { id: MARKET_ID, name: MARKET_NAME },
    repository: REPOSITORY_URL,
    revision: sourceRevision,
    skills: rows.map((row) => ({
      id: row.manifest.id,
      path: `skills/${row.directoryName}`,
      name: row.frontmatter.name,
      description: row.frontmatter.description,
      categories: row.manifest.categories,
      latestVersion: row.manifest.version,
      versions: skillVersions(repositoryRoot, row, sourceRevision),
    })),
  };
  const validateIndex = createValidator(
    path.join(repositoryRoot, 'schemas', 'skill-index.v1.schema.json'),
    SKILL_INDEX_SCHEMA_URL,
    '技能索引'
  );
  if (!validateIndex(index)) throw new Error(`市场技能索引未通过模式：${JSON.stringify(validateIndex.errors)}`);
  const indexBytes = Buffer.from(`${JSON.stringify(index, null, 2)}\n`);
  fs.writeFileSync(path.join(distDirectory, 'skills.json'), indexBytes);
  return { index, indexBytes, skillCount: index.skills.length };
}

module.exports = {
  MARKET_ID,
  REPOSITORY_URL,
  SKILL_INDEX_SCHEMA_URL,
  SKILL_MANIFEST_FILE,
  SKILL_SCHEMA_URL,
  buildOfficialSkills,
  directoryDigest,
  fileIndex,
  parseFrontmatter,
  skillVersions,
  validateMarketSkills,
  validateOfficialSkills,
};
