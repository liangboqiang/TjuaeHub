const fs = require('node:fs');
const path = require('node:path');
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');

const REPOSITORY_ROOT = path.resolve(__dirname, '..', '..');
const PACKAGE_PREFIX = 'tjuaeasset-';
const PACKAGE_MANIFEST_FILENAME = 'asset-package.json';
const PACKAGE_SCHEMA_PATH = path.join(REPOSITORY_ROOT, 'schemas', 'asset-package.v1.schema.json');
const PACKAGE_SCHEMA_URL =
  'https://raw.githubusercontent.com/liangboqiang/TjuaeHub/main/schemas/asset-package.v1.schema.json';
const DEFINITION_CONTRACTS = Object.freeze({
  assistant: Object.freeze({
    fileName: 'assistant.json',
    schemaPath: path.join(REPOSITORY_ROOT, 'schemas', 'assistant-definition.v1.schema.json'),
    schemaUrl:
      'https://raw.githubusercontent.com/liangboqiang/TjuaeHub/main/schemas/assistant-definition.v1.schema.json',
  }),
  engineAdapter: Object.freeze({
    fileName: 'engine-adapter.json',
    schemaPath: path.join(REPOSITORY_ROOT, 'schemas', 'engine-adapter-definition.v1.schema.json'),
    schemaUrl:
      'https://raw.githubusercontent.com/liangboqiang/TjuaeHub/main/schemas/engine-adapter-definition.v1.schema.json',
  }),
  skill: Object.freeze({ fileName: 'SKILL.md' }),
  mcp: Object.freeze({
    fileName: 'mcp.json',
    schemaPath: path.join(REPOSITORY_ROOT, 'schemas', 'mcp-definition.v1.schema.json'),
    schemaUrl: 'https://raw.githubusercontent.com/liangboqiang/TjuaeHub/main/schemas/mcp-definition.v1.schema.json',
  }),
});
const FORBIDDEN_PORTABLE_KEYS = new Set([
  'account',
  'authorization',
  'credential',
  'credentials',
  'endpoint',
  'env',
  'environment',
  'headers',
  'install',
  'installCommand',
  'installUrl',
  'onActivate',
  'onDeactivate',
  'onInstall',
  'onUninstall',
  'password',
  'postInstall',
  'secretValue',
  'token',
  'url',
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function createAjv() {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv;
}

function createPackageValidator() {
  const schema = readJson(PACKAGE_SCHEMA_PATH);
  if (schema.$id !== PACKAGE_SCHEMA_URL || schema.version !== '1.0.0') {
    throw new Error('原子资产包模式身份或版本不正确');
  }
  return createAjv().compile(schema);
}

function createDefinitionValidators() {
  const validators = {};
  for (const [kind, contract] of Object.entries(DEFINITION_CONTRACTS)) {
    if (!contract.schemaPath) {
      continue;
    }
    const schema = readJson(contract.schemaPath);
    if (schema.$id !== contract.schemaUrl || schema.version !== '1.0.0') {
      throw new Error(`${kind} Definition 模式身份或版本不正确`);
    }
    validators[kind] = createAjv().compile(schema);
  }
  return validators;
}

function assertSortedUnique(values, label) {
  if (
    !Array.isArray(values) ||
    new Set(values).size !== values.length ||
    JSON.stringify(values) !== JSON.stringify([...values].sort())
  ) {
    throw new Error(`${label} 必须唯一并按字典序排列`);
  }
}

function isSafeRelativePath(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    !value.startsWith('/') &&
    !/^[A-Za-z]:/u.test(value) &&
    !value.includes('\\') &&
    !value.includes('//') &&
    !value.split('/').some((part) => part.length === 0 || part === '.' || part === '..') &&
    !/^\s/u.test(value) &&
    !value.includes('\0')
  );
}

function validatePortableDefinitionSafety(value, source, jsonPath = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => validatePortableDefinitionSafety(item, source, [...jsonPath, String(index)]));
    return;
  }
  if (!value || typeof value !== 'object') {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = [...jsonPath, key];
    const location = `${source}#/${childPath.join('/')}`;
    if (FORBIDDEN_PORTABLE_KEYS.has(key)) {
      throw new Error(`${location} 包含只能进入 Core Overlay 的字段`);
    }
    if (typeof child === 'string' && key !== '$schema') {
      if (/^(?:[A-Za-z]:[\\/]|\/|\\\\)/u.test(child) || /\/(?:Users|home)\//u.test(child)) {
        throw new Error(`${location} 包含本机绝对路径`);
      }
      for (const match of child.matchAll(/https?:\/\/(?<host>\[[^\]]+\]|[^/:?#\s]+)/giu)) {
        const host = match.groups?.host?.replace(/^\[|\]$/gu, '').toLowerCase();
        if (
          host &&
          (host === 'localhost' ||
            host.endsWith('.local') ||
            /^(?:0|10|127)\./u.test(host) ||
            /^192\.168\./u.test(host) ||
            /^169\.254\./u.test(host) ||
            /^172\.(?:1[6-9]|2\d|3[01])\./u.test(host) ||
            host === '::1' ||
            /^(?:fc|fd|fe8|fe9|fea|feb)/u.test(host))
        ) {
          throw new Error(`${location} 包含本机或私有网络 URL`);
        }
      }
    }
    validatePortableDefinitionSafety(child, source, childPath);
  }
}

function listPackageManifestPaths(groupName) {
  const groupRoot = path.join(REPOSITORY_ROOT, groupName);
  if (!fs.existsSync(groupRoot)) {
    throw new Error(`缺少资产目录：${groupName}`);
  }
  return fs
    .readdirSync(groupRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(groupRoot, entry.name, PACKAGE_MANIFEST_FILENAME))
    .sort();
}

function validateSkillDefinition(asset, packageDirectory) {
  const skillPath = path.join(packageDirectory, asset.definitionFile);
  const source = fs.readFileSync(skillPath, 'utf8');
  const name = source.match(/^---\r?\n[\s\S]*?^name:\s*['"]?([^'"\r\n]+)['"]?\s*$/mu)?.[1]?.trim();
  if (name !== asset.runtimeId) {
    throw new Error(`${asset.id} 的 SKILL.md frontmatter name 必须等于 runtimeId`);
  }
}

function validatePackageDefinition(manifest, manifestPath, validators = createDefinitionValidators()) {
  const packageDirectory = path.dirname(manifestPath);
  const asset = manifest.assets[0];
  const contract = DEFINITION_CONTRACTS[asset.kind];
  if (!contract || asset.definitionFile !== contract.fileName) {
    throw new Error(`${manifest.name} 未使用 ${asset.kind} 的规范 Definition 入口`);
  }
  if (!isSafeRelativePath(asset.definitionFile)) {
    throw new Error(`${manifest.name} 的 Definition 路径不安全`);
  }
  const definitionPath = path.join(packageDirectory, asset.definitionFile);
  if (!fs.existsSync(definitionPath) || !fs.statSync(definitionPath).isFile()) {
    throw new Error(`${manifest.name} 缺少 Definition：${asset.definitionFile}`);
  }
  if (asset.kind === 'skill') {
    validateSkillDefinition(asset, packageDirectory);
    return;
  }
  const definition = readJson(definitionPath);
  const validate = validators[asset.kind];
  if (!validate(definition)) {
    throw new Error(
      `${manifest.name}/${asset.definitionFile} 未通过 Definition 模式：${JSON.stringify(validate.errors)}`
    );
  }
  validatePortableDefinitionSafety(definition, `${manifest.name}/${asset.definitionFile}`);
  if (definition.runtimeId !== asset.runtimeId) {
    throw new Error(`${manifest.name} 的包声明与 Definition runtimeId 不一致`);
  }
  if (asset.kind !== 'assistant' && (definition.kind !== asset.kind || definition.id !== asset.id)) {
    throw new Error(`${manifest.name} 的包声明与规范 Definition 身份不一致`);
  }
  if (asset.kind === 'assistant') {
    assertSortedUnique(definition.skillDependencies, `${manifest.name} 的助手依赖`);
    if (JSON.stringify(definition.skillDependencies) !== JSON.stringify(asset.dependencies)) {
      throw new Error(`${manifest.name} 的包依赖与助手 Definition 不一致`);
    }
    for (const relativePath of Object.values(definition.rules)) {
      if (!isSafeRelativePath(relativePath) || !fs.existsSync(path.join(packageDirectory, relativePath))) {
        throw new Error(`${manifest.name} 引用了不存在或不安全的助手规则文件`);
      }
    }
  }
}

function validateAssetPackage(manifest, directoryName, groupName, validateSchema, validators) {
  if (!validateSchema(manifest)) {
    throw new Error(`${directoryName} 未通过原子资产包模式：${JSON.stringify(validateSchema.errors)}`);
  }
  if (manifest.name !== directoryName || !directoryName.startsWith(PACKAGE_PREFIX)) {
    throw new Error(`${directoryName} 的目录名与包身份不一致`);
  }
  if (groupName === 'assets' && manifest.review !== undefined) {
    throw new Error(`${manifest.name} 已发布，不能携带待审状态`);
  }
  if (groupName === 'submissions' && manifest.review?.status !== 'underReview') {
    throw new Error(`${manifest.name} 位于 submissions，必须显式声明 underReview`);
  }
  assertSortedUnique(manifest.tags, `${manifest.name} 的 tags`);
  assertSortedUnique(manifest.assets[0].dependencies, `${manifest.name} 的 dependencies`);
  validatePackageDefinition(
    manifest,
    path.join(REPOSITORY_ROOT, groupName, directoryName, PACKAGE_MANIFEST_FILENAME),
    validators
  );
}

function validateRepositoryStructure(publishedPaths, submissionPaths) {
  if (publishedPaths.length === 0) {
    throw new Error('assets 至少需要一个可分发原子资产包');
  }
  const published = publishedPaths.map((manifestPath) => path.basename(path.dirname(manifestPath)));
  const submissions = submissionPaths.map((manifestPath) => path.basename(path.dirname(manifestPath)));
  const duplicates = published.filter((name) => submissions.includes(name));
  if (duplicates.length > 0) {
    throw new Error(`资产包不能同时位于 assets 与 submissions：${duplicates.join(', ')}`);
  }
}

function validateAssetPackages() {
  const validateSchema = createPackageValidator();
  const validators = createDefinitionValidators();
  const publishedPaths = listPackageManifestPaths('assets');
  const submissionPaths = listPackageManifestPaths('submissions');
  validateRepositoryStructure(publishedPaths, submissionPaths);
  for (const [groupName, manifestPaths] of [
    ['assets', publishedPaths],
    ['submissions', submissionPaths],
  ]) {
    for (const manifestPath of manifestPaths) {
      if (!fs.existsSync(manifestPath)) {
        throw new Error(`缺少清单：${path.relative(REPOSITORY_ROOT, manifestPath)}`);
      }
      const directoryName = path.basename(path.dirname(manifestPath));
      validateAssetPackage(readJson(manifestPath), directoryName, groupName, validateSchema, validators);
    }
  }
  return { publishedCount: publishedPaths.length, submissionCount: submissionPaths.length };
}

function main() {
  const result = validateAssetPackages();
  console.log(`已验证 ${result.publishedCount} 个已发布原子资产包和 ${result.submissionCount} 个待审包。`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

module.exports = {
  DEFINITION_CONTRACTS,
  PACKAGE_MANIFEST_FILENAME,
  PACKAGE_PREFIX,
  PACKAGE_SCHEMA_PATH,
  PACKAGE_SCHEMA_URL,
  assertSortedUnique,
  createDefinitionValidators,
  createPackageValidator,
  isSafeRelativePath,
  listPackageManifestPaths,
  validateAssetPackage,
  validateAssetPackages,
  validatePackageDefinition,
  validatePortableDefinitionSafety,
  validateRepositoryStructure,
};
