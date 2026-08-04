const fs = require('node:fs');
const path = require('node:path');
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');
const { loadTrustPolicy, validateOfficialPackageProvenance } = require('../../.github/scripts/build-assets');
const { PACKAGE_MANIFEST_FILENAME, createDefinitionValidators, validatePackageDefinition } = require('./check-assets');

const REPOSITORY_ROOT = path.resolve(__dirname, '..', '..');
const PROVENANCE_SCHEMA_PATH = path.join(REPOSITORY_ROOT, 'schemas', 'official-asset-provenance.v1.schema.json');
const PROVENANCE_POLICY_PATH = path.join(REPOSITORY_ROOT, 'policies', 'official-asset-provenance.v1.json');
const REQUIRED_KINDS = Object.freeze(['assistant', 'engineAdapter', 'mcp', 'skill']);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
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

function validateOfficialAssets() {
  const schema = readJson(PROVENANCE_SCHEMA_PATH);
  const policy = readJson(PROVENANCE_POLICY_PATH);
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validateProvenance = ajv.compile(schema);
  if (!validateProvenance(policy)) {
    throw new Error(`官方资产来源策略未通过模式验证：${JSON.stringify(validateProvenance.errors)}`);
  }
  const trustPolicy = loadTrustPolicy(REPOSITORY_ROOT);
  const packageNames = policy.packages.map((entry) => entry.packageName);
  assertSortedUnique(packageNames, '官方来源包');
  const validators = createDefinitionValidators();
  const officialAssetIds = new Set(
    policy.packages.map((entry) => `${entry.packageName}/${entry.assetKind}/${entry.runtimeId}`)
  );
  const counts = Object.fromEntries(REQUIRED_KINDS.map((kind) => [kind, 0]));

  for (const provenance of policy.packages) {
    const expectedPath = `assets/${provenance.packageName}`;
    if (provenance.hubSourcePath !== expectedPath) {
      throw new Error(`${provenance.packageName} 的 Hub 来源路径不正确`);
    }
    const packageDirectory = path.join(REPOSITORY_ROOT, ...expectedPath.split('/'));
    const manifestPath = path.join(packageDirectory, PACKAGE_MANIFEST_FILENAME);
    const manifest = readJson(manifestPath);
    validateOfficialPackageProvenance(manifest, trustPolicy.officialProvenance);
    validatePackageDefinition(manifest, manifestPath, validators);
    assertSortedUnique(provenance.excludedOverlayFields, `${provenance.packageName} 的 Overlay 排除字段`);
    const asset = manifest.assets[0];
    const missingDependencies = asset.dependencies.filter((dependency) => !officialAssetIds.has(dependency));
    if (missingDependencies.length > 0) {
      throw new Error(`${provenance.packageName} 依赖未发布的官方资产：${missingDependencies.join(', ')}`);
    }
    counts[asset.kind] += 1;
  }

  const absentKinds = REQUIRED_KINDS.filter((kind) => counts[kind] === 0);
  if (absentKinds.length > 0) {
    throw new Error(`官方资产与离线种子缺少类型：${absentKinds.join(', ')}`);
  }
  return { packageCount: packageNames.length, counts };
}

function main() {
  const result = validateOfficialAssets();
  console.log(
    `已验证 ${result.packageCount} 个官方原子包（助手 ${result.counts.assistant}、引擎 ${result.counts.engineAdapter}、技能 ${result.counts.skill}、MCP ${result.counts.mcp}）。`
  );
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

module.exports = { REQUIRED_KINDS, assertSortedUnique, validateOfficialAssets };
