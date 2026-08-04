const fs = require('node:fs');
const path = require('node:path');
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');

const REPOSITORY_ROOT = path.resolve(__dirname, '..', '..');
const INDEX_SCHEMA_PATH = path.join(REPOSITORY_ROOT, 'schemas', 'hub-index.v2.schema.json');
const COMPLETE_FIXTURE_PATH = path.join(REPOSITORY_ROOT, 'tests', 'fixtures', 'hub-index.v2.complete.json');
const CROSS_REPOSITORY_FIXTURE_PATH = path.join(
  REPOSITORY_ROOT,
  'tests',
  'fixtures',
  'hub-index.v2.cross-repository.json'
);
const INDEX_SCHEMA_URL =
  'https://raw.githubusercontent.com/liangboqiang/TjuaeHub/main/schemas/hub-index.v2.schema.json';
const CANONICAL_ENTRY_BY_KIND = Object.freeze({
  assistant: 'assistant.json',
  engineAdapter: 'engine-adapter.json',
  skill: 'SKILL.md',
  mcp: 'mcp.json',
});

/**
 * Build the single validator used by fixtures and generated artifacts.
 *
 * @returns {(value: unknown) => boolean}
 */
function createIndexValidator() {
  const schema = JSON.parse(fs.readFileSync(INDEX_SCHEMA_PATH, 'utf8'));
  if (schema.$id !== INDEX_SCHEMA_URL || schema.version !== '2.0.0') {
    throw new Error('Hub Index v2 模式的身份或版本不正确');
  }

  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile(schema);
}

/**
 * Assert package/asset invariants that JSON Schema cannot express.
 *
 * @param {Record<string, any>} index
 * @param {string} source
 * @returns {void}
 */
function validateIndexContract(index, source = 'Hub Index') {
  const validateSchema = createIndexValidator();
  if (!validateSchema(index)) {
    throw new Error(`${source} 未通过 Index v2 模式验证：${JSON.stringify(validateSchema.errors)}`);
  }

  const packageEntries = Object.entries(index.packages);
  const assetEntries = Object.entries(index.assets);
  if (index.metadata.totalPackages !== packageEntries.length) {
    throw new Error(`${source} 的 totalPackages 与 packages 数量不一致`);
  }
  if (index.metadata.totalAssets !== assetEntries.length) {
    throw new Error(`${source} 的 totalAssets 与 assets 数量不一致`);
  }
  if (JSON.stringify(Object.keys(index.packages)) !== JSON.stringify(packageEntries.map(([name]) => name).sort())) {
    throw new Error(`${source} 的 packages 必须按字典序稳定输出`);
  }
  if (JSON.stringify(Object.keys(index.assets)) !== JSON.stringify(assetEntries.map(([id]) => id).sort())) {
    throw new Error(`${source} 的 assets 必须按字典序稳定输出`);
  }

  const claimedAssetIds = new Set();
  for (const [packageName, packageEntry] of packageEntries) {
    if (packageEntry.name !== packageName) {
      throw new Error(`${source} 的包键 ${packageName} 与 package.name ${packageEntry.name} 不一致`);
    }
    if (JSON.stringify(packageEntry.assetIds) !== JSON.stringify([...packageEntry.assetIds].sort())) {
      throw new Error(`${packageName} 的 assetIds 必须按字典序稳定输出`);
    }
    for (const assetId of packageEntry.assetIds) {
      if (!index.assets[assetId]) {
        throw new Error(`${packageName} 引用了不存在的资产 ${assetId}`);
      }
      if (claimedAssetIds.has(assetId)) {
        throw new Error(`资产 ${assetId} 被多个原子包声明`);
      }
      claimedAssetIds.add(assetId);
    }

    const expectedSourcePath = `assets/${packageName}`;
    if (
      packageEntry.sourcePath !== expectedSourcePath ||
      packageEntry.manifestPath !== `${expectedSourcePath}/asset-package.json`
    ) {
      throw new Error(`${packageName} 的来源路径与扩展目录不一致`);
    }
    if (
      packageEntry.repository !== index.metadata.repository ||
      packageEntry.sourceRevision !== index.metadata.sourceRevision
    ) {
      throw new Error(`${packageName} 的仓库或源码修订与索引元数据不一致`);
    }
    if (packageEntry.tarball !== `${packageName}.zip`) {
      throw new Error(`${packageName} 的 tarball 名称不正确`);
    }
  }

  for (const [assetId, asset] of assetEntries) {
    if (asset.id !== assetId) {
      throw new Error(`${source} 的资产键 ${assetId} 与 asset.id ${asset.id} 不一致`);
    }
    const expectedPrefix = `${asset.packageName}/${asset.kind}/`;
    if (!assetId.startsWith(expectedPrefix)) {
      throw new Error(`${assetId} 的包名或类型与稳定资产 ID 不一致`);
    }
    const owner = index.packages[asset.packageName];
    if (!owner || !owner.assetIds.includes(assetId)) {
      throw new Error(`${assetId} 没有对应的原子分发包`);
    }
    if (asset.version !== owner.version || asset.sourceRevision !== index.metadata.sourceRevision) {
      throw new Error(`${assetId} 的版本或源码修订与原子包不一致`);
    }
    if (JSON.stringify(asset.dependencies) !== JSON.stringify([...asset.dependencies].sort())) {
      throw new Error(`${assetId} 的 dependencies 必须唯一并按字典序稳定输出`);
    }
    for (const dependencyId of asset.dependencies) {
      const dependency = index.assets[dependencyId];
      if (!dependency) {
        throw new Error(`${assetId} 引用了不存在的资产依赖 ${dependencyId}`);
      }
      if (dependencyId === assetId) {
        throw new Error(`${assetId} 不能依赖自身`);
      }
      if (asset.trust === 'official' && dependency.trust !== 'official') {
        throw new Error(`官方资产 ${assetId} 只能依赖官方资产，当前依赖为 ${dependencyId}`);
      }
    }

    const filePaths = asset.files.map((file) => file.path);
    if (
      new Set(filePaths.map((filePath) => filePath.toLowerCase())).size !== filePaths.length ||
      JSON.stringify(filePaths) !== JSON.stringify([...filePaths].sort())
    ) {
      throw new Error(`${assetId} 的文件清单必须无大小写冲突并按字典序稳定输出`);
    }
    if (!filePaths.includes(asset.entryFile)) {
      throw new Error(`${assetId} 的 entryFile 不在文件清单中`);
    }
    const canonicalEntry = CANONICAL_ENTRY_BY_KIND[asset.kind];
    if (canonicalEntry && asset.entryFile !== canonicalEntry) {
      throw new Error(`${assetId} 必须使用规范 Definition 入口 ${canonicalEntry}`);
    }
    if (canonicalEntry && asset.runtimeId !== assetId.slice(assetId.lastIndexOf('/') + 1)) {
      throw new Error(`${assetId} 的 runtimeId 必须与规范 Definition id 对齐`);
    }
  }
  if (claimedAssetIds.size !== assetEntries.length) {
    throw new Error(`${source} 包含未被原子包声明的孤立资产`);
  }

  const visiting = new Set();
  const visited = new Set();
  const visit = (assetId, path = []) => {
    if (visiting.has(assetId)) {
      throw new Error(`${source} 包含资产依赖环：${[...path, assetId].join(' -> ')}`);
    }
    if (visited.has(assetId)) {
      return;
    }
    visiting.add(assetId);
    for (const dependencyId of index.assets[assetId].dependencies) {
      visit(dependencyId, [...path, assetId]);
    }
    visiting.delete(assetId);
    visited.add(assetId);
  };
  for (const [assetId] of assetEntries) {
    visit(assetId);
  }
}

/**
 * Validate the checked-in complete API fixture.
 *
 * @returns {{ packageCount: number, assetCount: number }}
 */
function validateCompleteFixture() {
  const fixture = JSON.parse(fs.readFileSync(COMPLETE_FIXTURE_PATH, 'utf8'));
  validateIndexContract(fixture, '完整 Index v2 API 夹具');
  return {
    packageCount: Object.keys(fixture.packages).length,
    assetCount: Object.keys(fixture.assets).length,
  };
}

/**
 * Validate the fixed fixture mirrored by Hub, Core and UI contract tests.
 *
 * @returns {{ packageCount: number, assetCount: number }}
 */
function validateCrossRepositoryFixture() {
  const fixture = JSON.parse(fs.readFileSync(CROSS_REPOSITORY_FIXTURE_PATH, 'utf8'));
  validateIndexContract(fixture, '跨仓库 Index v2 契约夹具');
  return {
    packageCount: Object.keys(fixture.packages).length,
    assetCount: Object.keys(fixture.assets).length,
  };
}

function main() {
  const result = validateCompleteFixture();
  const crossRepository = validateCrossRepositoryFixture();
  console.log(
    `Hub Index v2 契约通过，完整夹具包含 ${result.packageCount} 个原子包和 ${result.assetCount} 项资产；` +
      `跨仓库夹具包含 ${crossRepository.packageCount} 个原子包和 ${crossRepository.assetCount} 项资产。`
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

module.exports = {
  CANONICAL_ENTRY_BY_KIND,
  COMPLETE_FIXTURE_PATH,
  CROSS_REPOSITORY_FIXTURE_PATH,
  INDEX_SCHEMA_PATH,
  INDEX_SCHEMA_URL,
  createIndexValidator,
  validateCompleteFixture,
  validateCrossRepositoryFixture,
  validateIndexContract,
};
