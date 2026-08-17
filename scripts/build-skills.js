const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');

const SKILL_SCHEMA_URL =
  'https://raw.githubusercontent.com/liangboqiang/TjuaeHub/main/schemas/tjuae-skill.v1.schema.json';
const SKILL_INDEX_SCHEMA_URL =
  'https://raw.githubusercontent.com/liangboqiang/TjuaeHub/main/schemas/skill-index.v1.schema.json';
const MARKET_ID = 'tjuae-hub';
const MARKET_NAME = 'TjuaeHub';
const REPOSITORY_URL = 'https://github.com/liangboqiang/TjuaeHub.git';
const SKILL_MANIFEST_FILE = '.tjuae-skill.json';
const SKIPPED_NAMES = new Set(['node_modules', '.git', '.DS_Store', '__MACOSX']);

function comparePortable(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertInside(root, target) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`拒绝访问技能目录范围外路径：${resolvedTarget}`);
  }
  return resolvedTarget;
}

function listFiles(directory) {
  const root = path.resolve(directory);
  const files = [];
  function walk(current) {
    const entries = fs
      .readdirSync(current, { withFileTypes: true })
      .sort((left, right) => comparePortable(left.name, right.name));
    for (const entry of entries) {
      if (SKIPPED_NAMES.has(entry.name)) continue;
      const fullPath = assertInside(root, path.join(current, entry.name));
      if (entry.isSymbolicLink()) throw new Error(`市场技能禁止符号链接：${path.relative(root, fullPath)}`);
      if (entry.isDirectory()) walk(fullPath);
      else if (entry.isFile()) files.push(fullPath);
      else throw new Error(`市场技能包含不支持的文件类型：${path.relative(root, fullPath)}`);
    }
  }
  walk(root);
  return files;
}

function relativePosixPath(root, file) {
  return path.relative(root, file).split(path.sep).join('/');
}

function directoryDigest(skillPath, files = listFiles(skillPath)) {
  const hash = crypto.createHash('sha256');
  hash.update('tjuae-skill-workspace-v1\0');
  for (const file of files) {
    const relative = relativePosixPath(skillPath, file);
    const contents = fs.readFileSync(file);
    hash.update(relative);
    hash.update('\0');
    hash.update(contents);
    hash.update('\0');
  }
  return `sha256-${hash.digest('hex')}`;
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
  return { name, description };
}

function createValidator(schemaPath, expectedId) {
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  if (schema.$id !== expectedId || schema.version !== '1.0.0') {
    throw new Error(`技能模式身份或版本无效：${path.basename(schemaPath)}`);
  }
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile(schema);
}

function validateMarketSkills(repositoryRoot) {
  const skillsRoot = path.join(repositoryRoot, 'skills');
  const validate = createValidator(
    path.join(repositoryRoot, 'schemas', 'tjuae-skill.v1.schema.json'),
    SKILL_SCHEMA_URL
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
    if (
      manifest.source.kind !== 'market' ||
      manifest.source.marketId !== MARKET_ID ||
      manifest.source.repository !== REPOSITORY_URL ||
      manifest.source.path !== `skills/${directory.name}`
    ) {
      throw new Error(`${directory.name} 的市场来源必须绑定自身 TjuaeHub 路径`);
    }
    ids.add(manifest.id);
    const frontmatter = parseFrontmatter(fs.readFileSync(entryPath, 'utf8'), `${directory.name}/SKILL.md`);
    return { directoryName: directory.name, skillPath, manifest, frontmatter };
  });
}

function validateOfficialSkills(repositoryRoot) {
  return validateMarketSkills(repositoryRoot);
}

async function buildOfficialSkills({ repositoryRoot, distDirectory, sourceRevision }) {
  const rows = validateMarketSkills(repositoryRoot);
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
      version: row.manifest.version,
      categories: row.manifest.categories,
      digest: directoryDigest(row.skillPath),
    })),
  };
  const validateIndex = createValidator(
    path.join(repositoryRoot, 'schemas', 'skill-index.v1.schema.json'),
    SKILL_INDEX_SCHEMA_URL
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
  parseFrontmatter,
  validateMarketSkills,
  validateOfficialSkills,
};
