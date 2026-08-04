const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const JSZip = require('jszip');
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');
const {
  HUB_REPOSITORY_URL,
  OFFICIAL_SEED_KINDS,
  OFFLINE_SEED_SCHEMA_URL,
  PACKAGE_MANIFEST_FILENAME,
  PACKAGE_PREFIX,
  buildFileManifest,
  computeContentHash,
  createAssetRecords,
  getAllFiles,
  loadTrustPolicy,
  sha256Integrity,
} = require('../../.github/scripts/build-assets');
const { validateIndexContract } = require('./check-index');
const { MAX_PACKAGE_FILES, MAX_UNPACKED_BYTES, validateSafeRelativePath } = require('./check-security');

const REPOSITORY_ROOT = path.resolve(__dirname, '..', '..');
const DIST_DIRECTORY = path.join(REPOSITORY_ROOT, 'dist');
const OFFLINE_SEED_SCHEMA_PATH = path.join(REPOSITORY_ROOT, 'schemas', 'offline-seed-manifest.v1.schema.json');

function validateIndexShape(index) {
  if (index.schemaVersion !== 2 || index.metadata?.generatedBy !== 'Tjuae 资产构建器 v3.0.0') {
    throw new Error('生成索引的模式或构建器身份不正确');
  }
  if (index.metadata.repository !== HUB_REPOSITORY_URL || !Number.isFinite(Date.parse(index.generatedAt))) {
    throw new Error('生成索引的仓库地址或时间戳无效');
  }
}

function expectedPackageDependencies(index, assetIds, packageName) {
  const dependencies = {};
  for (const assetId of assetIds) {
    for (const dependencyId of index.assets[assetId].dependencies) {
      const dependency = index.assets[dependencyId];
      if (!dependency) {
        throw new Error(`${assetId} 引用了不存在的依赖 ${dependencyId}`);
      }
      if (dependency.packageName !== packageName) {
        dependencies[dependency.packageName] = dependency.version;
      }
    }
  }
  return Object.fromEntries(Object.entries(dependencies).sort(([left], [right]) => left.localeCompare(right)));
}

function validatePackageDescriptor(options) {
  const {
    index,
    packageName,
    packageEntry,
    manifest,
    assetIds,
    sourceRevision,
    unpackedSize,
    contentIntegrity,
    archiveIntegrity,
  } = options;
  const sourcePath = `assets/${packageName}`;
  const expected = {
    name: packageName,
    version: manifest.version,
    reviewStatus: 'approved',
    atomic: true,
    assetIds,
    dependencies: expectedPackageDependencies(index, assetIds, packageName),
    tarball: `${packageName}.zip`,
    integrity: contentIntegrity,
    archiveIntegrity,
    unpackedSize,
    repository: HUB_REPOSITORY_URL,
    sourcePath,
    manifestPath: `${sourcePath}/${PACKAGE_MANIFEST_FILENAME}`,
    sourceRevision,
  };
  if (JSON.stringify(packageEntry) !== JSON.stringify(expected)) {
    throw new Error(`${packageName} 的原子包描述与源码或归档不一致`);
  }
}

async function validateOfflineSeed(index) {
  const manifestPath = path.join(DIST_DIRECTORY, 'seed-manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error('dist/seed-manifest.json 不存在');
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const schema = JSON.parse(fs.readFileSync(OFFLINE_SEED_SCHEMA_PATH, 'utf8'));
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validateSchema = ajv.compile(schema);
  if (schema.$id !== OFFLINE_SEED_SCHEMA_URL || !validateSchema(manifest)) {
    throw new Error(`离线种子清单未通过 v1 模式验证：${JSON.stringify(validateSchema.errors)}`);
  }
  const assetIds = Object.entries(index.assets)
    .filter(([, asset]) => asset.trust === 'official' && asset.status !== 'revoked')
    .map(([assetId]) => assetId)
    .sort();
  const packageNames = Object.entries(index.packages)
    .filter(([, packageEntry]) => packageEntry.assetIds.some((assetId) => assetIds.includes(assetId)))
    .map(([packageName]) => packageName)
    .sort();
  const assetKinds = [...new Set(assetIds.map((assetId) => index.assets[assetId].kind))].sort();
  if (
    manifest.sourceRevision !== index.metadata.sourceRevision ||
    manifest.generatedAt !== index.generatedAt ||
    JSON.stringify(manifest.assetKinds) !== JSON.stringify(OFFICIAL_SEED_KINDS) ||
    JSON.stringify(assetKinds) !== JSON.stringify(OFFICIAL_SEED_KINDS) ||
    JSON.stringify(manifest.assetIds) !== JSON.stringify(assetIds) ||
    JSON.stringify(manifest.packageNames) !== JSON.stringify(packageNames)
  ) {
    throw new Error('离线种子清单未精确覆盖四类官方资产');
  }

  const bundlePath = path.join(DIST_DIRECTORY, manifest.bundle.fileName);
  const bundleBytes = fs.readFileSync(bundlePath);
  const bundleDigest = sha256Integrity(bundleBytes);
  if (
    manifest.bundle.digest !== bundleDigest ||
    manifest.bundle.size !== bundleBytes.length ||
    manifest.bundle.fileName !== `tjuae-seed-${bundleDigest.slice('sha256-'.length)}.zip`
  ) {
    throw new Error('离线种子归档文件名、大小或内容摘要不一致');
  }
  const archive = await JSZip.loadAsync(bundleBytes);
  const expectedEntries = ['seed-index.json', ...packageNames.map((name) => `packages/${name}.zip`)].sort();
  const actualEntries = Object.values(archive.files)
    .filter((entry) => !entry.dir)
    .map((entry) => entry.name)
    .sort();
  if (JSON.stringify(actualEntries) !== JSON.stringify(expectedEntries)) {
    throw new Error('离线种子归档条目与官方包集合不一致');
  }
  const seedIndexBytes = await archive.file('seed-index.json').async('nodebuffer');
  if (manifest.seedIndexDigest !== sha256Integrity(seedIndexBytes)) {
    throw new Error('离线种子索引摘要不一致');
  }
  const seedIndex = JSON.parse(seedIndexBytes.toString('utf8'));
  validateIndexContract(seedIndex, '离线种子 seed-index.json');
  const expectedSeedIndex = {
    ...index,
    assets: Object.fromEntries(assetIds.map((assetId) => [assetId, index.assets[assetId]])),
    packages: Object.fromEntries(packageNames.map((packageName) => [packageName, index.packages[packageName]])),
    metadata: { ...index.metadata, totalPackages: packageNames.length, totalAssets: assetIds.length },
  };
  if (JSON.stringify(seedIndex) !== JSON.stringify(expectedSeedIndex)) {
    throw new Error('离线种子索引不是 Hub Index 的精确官方子集');
  }
  for (const packageName of packageNames) {
    const nested = await archive.file(`packages/${packageName}.zip`).async('nodebuffer');
    if (!nested.equals(fs.readFileSync(path.join(DIST_DIRECTORY, `${packageName}.zip`)))) {
      throw new Error(`离线种子中的 ${packageName}.zip 与独立分发包不一致`);
    }
  }
  return { bundleFileName: manifest.bundle.fileName };
}

async function validateBuild() {
  const indexPath = path.join(DIST_DIRECTORY, 'index.json');
  if (!fs.existsSync(indexPath)) {
    throw new Error('dist/index.json 不存在，请先运行构建');
  }
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  const trustPolicy = loadTrustPolicy(REPOSITORY_ROOT);
  validateIndexShape(index);
  validateIndexContract(index, 'dist/index.json');
  const seed = await validateOfflineSeed(index);
  const sourceDirectories = fs
    .readdirSync(path.join(REPOSITORY_ROOT, 'assets'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(PACKAGE_PREFIX))
    .map((entry) => entry.name)
    .sort();
  const packageNames = Object.keys(index.packages).sort();
  if (JSON.stringify(sourceDirectories) !== JSON.stringify(packageNames)) {
    throw new Error('生成索引中的包键与已发布 assets 目录不一致');
  }
  const expectedDistFiles = [
    'index.json',
    'seed-manifest.json',
    seed.bundleFileName,
    ...sourceDirectories.map((name) => `${name}.zip`),
  ].sort();
  if (JSON.stringify(fs.readdirSync(DIST_DIRECTORY).sort()) !== JSON.stringify(expectedDistFiles)) {
    throw new Error('dist 中存在缺失或意外的产物');
  }

  for (const packageName of sourceDirectories) {
    const packagePath = path.join(REPOSITORY_ROOT, 'assets', packageName);
    const manifest = JSON.parse(fs.readFileSync(path.join(packagePath, PACKAGE_MANIFEST_FILENAME), 'utf8'));
    const sourceFiles = getAllFiles(packagePath);
    const fileManifest = buildFileManifest(packagePath, sourceFiles);
    const sourceEntries = fileManifest.map((file) => file.path);
    const unpackedSize = sourceFiles.reduce((total, file) => total + fs.statSync(file).size, 0);
    const archiveBuffer = fs.readFileSync(path.join(DIST_DIRECTORY, `${packageName}.zip`));
    const archiveIntegrity = `sha256-${crypto.createHash('sha256').update(archiveBuffer).digest('hex')}`;
    const expectedAssets = createAssetRecords(manifest, fileManifest, index.metadata.sourceRevision, trustPolicy);
    const assetIds = Object.keys(expectedAssets).sort();
    validatePackageDescriptor({
      index,
      packageName,
      packageEntry: index.packages[packageName],
      manifest,
      assetIds,
      sourceRevision: index.metadata.sourceRevision,
      unpackedSize,
      contentIntegrity: `sha256-${computeContentHash(packagePath, sourceFiles)}`,
      archiveIntegrity,
    });
    for (const assetId of assetIds) {
      if (JSON.stringify(index.assets[assetId]) !== JSON.stringify(expectedAssets[assetId])) {
        throw new Error(`${assetId} 的资产定义、文件清单或信任元数据无效`);
      }
    }
    const archive = await JSZip.loadAsync(archiveBuffer);
    const entries = Object.values(archive.files);
    if (entries.length > MAX_PACKAGE_FILES) {
      throw new Error(`${packageName} 的归档条目数超过安全上限`);
    }
    for (const file of entries) {
      const pathError = validateSafeRelativePath(file.name.replace(/\/$/u, ''));
      if (pathError) {
        throw new Error(`${packageName} 包含不安全归档路径 ${file.name}：${pathError}`);
      }
      const unixMode = typeof file.unixPermissions === 'number' ? file.unixPermissions : 0;
      if ((unixMode & 0o170000) === 0o120000) {
        throw new Error(`${packageName} 的归档包含符号链接：${file.name}`);
      }
    }
    const archiveEntries = entries
      .filter((file) => !file.dir)
      .map((file) => file.name)
      .sort();
    if (JSON.stringify(archiveEntries) !== JSON.stringify(sourceEntries)) {
      throw new Error(`${packageName} 的归档条目与源文件不一致`);
    }
    if (!archive.file(PACKAGE_MANIFEST_FILENAME) || unpackedSize > MAX_UNPACKED_BYTES) {
      throw new Error(`${packageName} 的归档缺少包清单或超过大小上限`);
    }
  }
  return { packageCount: sourceDirectories.length, assetCount: Object.keys(index.assets).length };
}

async function main() {
  const result = await validateBuild();
  console.log(`已验证 ${result.packageCount} 个原子包归档和 ${result.assetCount} 项资产。`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { validateBuild, validateIndexShape, validateOfflineSeed, validatePackageDescriptor };
