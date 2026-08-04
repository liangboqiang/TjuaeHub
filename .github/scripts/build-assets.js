/**
 */
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const JSZip = require('jszip');
const {
  PACKAGE_MANIFEST_FILENAME,
  PACKAGE_PREFIX,
  validateAssetPackages,
} = require('../../scripts/quality/check-assets');

const HUB_INDEX_SCHEMA_URL =
  'https://raw.githubusercontent.com/liangboqiang/TjuaeHub/main/schemas/hub-index.v2.schema.json';
const HUB_REPOSITORY_URL = 'https://github.com/liangboqiang/TjuaeHub/';
const TRUST_POLICY_PATH = path.join('policies', 'trust-policy.v1.json');
const OFFICIAL_PROVENANCE_PATH = path.join('policies', 'official-asset-provenance.v1.json');
const OFFLINE_SEED_SCHEMA_URL =
  'https://raw.githubusercontent.com/liangboqiang/TjuaeHub/main/schemas/offline-seed-manifest.v1.schema.json';
const FIXED_ZIP_DATE = new Date('2024-01-01T00:00:00.000Z');
const SKIPPED_NAMES = new Set(['node_modules', '.git', '.DS_Store', '__MACOSX']);
const OFFICIAL_SEED_KINDS = Object.freeze(['assistant', 'engineAdapter', 'mcp', 'skill']);

function comparePortable(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertInside(root, target) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`拒绝访问仓库范围外路径：${resolvedTarget}`);
  }
  return resolvedTarget;
}

function getAllFiles(directory) {
  const root = path.resolve(directory);
  const files = [];
  function walk(current) {
    const entries = fs
      .readdirSync(current, { withFileTypes: true })
      .sort((left, right) => comparePortable(left.name, right.name));
    for (const entry of entries) {
      if (SKIPPED_NAMES.has(entry.name)) {
        continue;
      }
      const fullPath = assertInside(root, path.join(current, entry.name));
      if (entry.isSymbolicLink()) {
        throw new Error(`资产包禁止符号链接：${path.relative(root, fullPath)}`);
      }
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        files.push(fullPath);
      } else {
        throw new Error(`资产包包含不支持的文件类型：${path.relative(root, fullPath)}`);
      }
    }
  }
  walk(root);
  return files;
}

function relativePosixPath(root, file) {
  return path.relative(root, file).split(path.sep).join('/');
}

function sha256Integrity(value) {
  return `sha256-${crypto.createHash('sha256').update(value).digest('hex')}`;
}

function mediaTypeForPath(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return (
    {
      '.css': 'text/css',
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.json': 'application/json',
      '.md': 'text/markdown',
      '.svg': 'image/svg+xml',
      '.toml': 'application/toml',
      '.ts': 'text/typescript',
      '.yaml': 'application/yaml',
      '.yml': 'application/yaml',
    }[extension] ?? 'application/octet-stream'
  );
}

function buildFileManifest(packagePath, files = getAllFiles(packagePath)) {
  return files
    .map((file) => {
      const contents = fs.readFileSync(file);
      return {
        path: relativePosixPath(packagePath, file),
        digest: sha256Integrity(contents),
        size: contents.length,
        mediaType: mediaTypeForPath(file),
      };
    })
    .sort((left, right) => comparePortable(left.path, right.path));
}

function computeDefinitionDigest(files) {
  const hash = crypto.createHash('sha256');
  hash.update('tjuae-asset-definition-v1\0');
  for (const file of files) {
    const pathBytes = Buffer.from(file.path);
    const pathLength = Buffer.alloc(8);
    const size = Buffer.alloc(8);
    pathLength.writeBigUInt64BE(BigInt(pathBytes.length));
    size.writeBigUInt64BE(BigInt(file.size));
    hash.update(pathLength);
    hash.update(pathBytes);
    hash.update(size);
    hash.update(file.digest);
  }
  return `sha256-${hash.digest('hex')}`;
}

function computeContentHash(packagePath, files = getAllFiles(packagePath)) {
  const hash = crypto.createHash('sha256');
  for (const file of files) {
    hash.update(relativePosixPath(packagePath, file));
    hash.update(fs.readFileSync(file));
  }
  return hash.digest('hex');
}

async function createAssetArchive(packagePath, files) {
  const archive = new JSZip();
  for (const file of files) {
    archive.file(relativePosixPath(packagePath, file), fs.readFileSync(file), {
      binary: true,
      createFolders: false,
      date: FIXED_ZIP_DATE,
      unixPermissions: 0o100644,
    });
  }
  return archive.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
    platform: 'UNIX',
    streamFiles: false,
  });
}

function loadTrustPolicy(repositoryRoot) {
  const policy = JSON.parse(fs.readFileSync(path.join(repositoryRoot, TRUST_POLICY_PATH), 'utf8'));
  if (policy.schemaVersion !== 1) {
    throw new Error('资产信任策略必须使用 schemaVersion 1');
  }
  const allowedKeys = new Set([
    '$schema',
    'schemaVersion',
    'description',
    'officialPackages',
    'verifiedPackages',
    'revokedPackages',
  ]);
  const unknown = Object.keys(policy).filter((key) => !allowedKeys.has(key));
  if (unknown.length > 0) {
    throw new Error(`资产信任策略包含未知字段：${unknown.join(', ')}`);
  }
  for (const [name, values] of [
    ['officialPackages', policy.officialPackages],
    ['verifiedPackages', policy.verifiedPackages],
    ['revokedPackages', policy.revokedPackages],
  ]) {
    if (
      !Array.isArray(values) ||
      values.some((value) => typeof value !== 'string' || !value.startsWith(PACKAGE_PREFIX)) ||
      new Set(values).size !== values.length ||
      JSON.stringify(values) !== JSON.stringify([...values].sort())
    ) {
      throw new Error(`资产信任策略中的 ${name} 必须是按字典序排列的合法包名`);
    }
  }
  const official = new Set(policy.officialPackages);
  const verified = new Set(policy.verifiedPackages);
  const revoked = new Set(policy.revokedPackages);
  for (const name of official) {
    if (verified.has(name)) {
      throw new Error(`${name} 不能同时标记 official 与 verified`);
    }
  }

  const provenancePolicy = JSON.parse(fs.readFileSync(path.join(repositoryRoot, OFFICIAL_PROVENANCE_PATH), 'utf8'));
  if (provenancePolicy.schemaVersion !== 1 || !Array.isArray(provenancePolicy.packages)) {
    throw new Error('官方资产来源策略无效');
  }
  const names = provenancePolicy.packages.map((entry) => entry?.packageName);
  if (
    names.some((name) => typeof name !== 'string') ||
    new Set(names).size !== names.length ||
    JSON.stringify(names) !== JSON.stringify([...names].sort()) ||
    JSON.stringify(names) !== JSON.stringify([...official].sort())
  ) {
    throw new Error('官方信任包与官方来源记录必须完全一致且按字典序排列');
  }
  return {
    officialPackages: official,
    verifiedPackages: verified,
    revokedPackages: revoked,
    officialProvenance: new Map(provenancePolicy.packages.map((entry) => [entry.packageName, entry])),
  };
}

function resolveAssetTrust(packageName, policy) {
  if (policy.officialPackages.has(packageName)) {
    if (!policy.officialProvenance.has(packageName)) {
      throw new Error(`官方包 ${packageName} 缺少来源记录`);
    }
    return 'official';
  }
  return policy.verifiedPackages.has(packageName) ? 'verified' : 'community';
}

function validateOfficialPackageProvenance(manifest, officialProvenance) {
  const provenance = officialProvenance.get(manifest.name);
  if (!provenance) {
    return;
  }
  if (provenance.hubSourcePath !== `assets/${manifest.name}`) {
    throw new Error(`${manifest.name} 的官方来源未绑定实际 assets 路径`);
  }
  const asset = manifest.assets[0];
  if (
    asset.kind !== provenance.assetKind ||
    asset.runtimeId !== provenance.runtimeId ||
    asset.id !== provenance.runtimeId
  ) {
    throw new Error(`${manifest.name} 的原子资产身份与官方来源记录不一致`);
  }
}

function createAssetRecords(manifest, fileManifest, sourceRevision, trustPolicy) {
  const asset = manifest.assets[0];
  const assetId = `${manifest.name}/${asset.kind}/${asset.id}`;
  const trust = resolveAssetTrust(manifest.name, trustPolicy);
  const status = trustPolicy.revokedPackages.has(manifest.name)
    ? 'revoked'
    : manifest.status === 'deprecated'
      ? 'deprecated'
      : 'active';
  return {
    [assetId]: {
      id: assetId,
      kind: asset.kind,
      runtimeId: asset.runtimeId,
      dependencies: [...asset.dependencies].sort(comparePortable),
      displayName: manifest.displayName,
      description: manifest.description,
      version: manifest.version,
      definitionDigest: computeDefinitionDigest(fileManifest),
      entryFile: asset.definitionFile,
      packageName: manifest.name,
      author: manifest.author,
      trust,
      status,
      compatibility: manifest.compatibility,
      sourceRevision,
      files: fileManifest,
      tags: [...manifest.tags].sort(comparePortable),
    },
  };
}

function resolveSourceRevision(repositoryRoot, environment = process.env) {
  const revision =
    environment.TJUAE_HUB_SOURCE_REVISION ??
    environment.GITHUB_SHA ??
    execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  if (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(revision)) {
    throw new Error('Hub 源码修订必须是 40 或 64 位十六进制提交 ID');
  }
  return revision;
}

function resolveGeneratedAt(repositoryRoot, sourceRevision, environment = process.env) {
  let epoch;
  if (environment.SOURCE_DATE_EPOCH !== undefined) {
    if (!/^(?:0|[1-9]\d*)$/u.test(environment.SOURCE_DATE_EPOCH)) {
      throw new Error('SOURCE_DATE_EPOCH 必须是非负十进制整数');
    }
    epoch = Number(environment.SOURCE_DATE_EPOCH);
  } else {
    const commitEpoch = execFileSync('git', ['show', '-s', '--format=%ct', sourceRevision], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (!/^(?:0|[1-9]\d*)$/u.test(commitEpoch)) {
      throw new Error('无法从源码修订解析可复现时间');
    }
    epoch = Number(commitEpoch);
  }
  const generatedAt = new Date(epoch * 1000);
  if (!Number.isSafeInteger(epoch) || Number.isNaN(generatedAt.valueOf())) {
    throw new Error('构建时间超出可支持范围');
  }
  return generatedAt.toISOString();
}

function createPackageRecord(options) {
  const { manifest, assetIds, dependencies, tarball, integrity, archiveIntegrity, unpackedSize, sourceRevision } =
    options;
  const sourcePath = `assets/${manifest.name}`;
  return {
    name: manifest.name,
    version: manifest.version,
    reviewStatus: 'approved',
    atomic: true,
    assetIds,
    dependencies: Object.fromEntries(
      Object.entries(dependencies).sort(([left], [right]) => comparePortable(left, right))
    ),
    tarball,
    integrity,
    archiveIntegrity,
    unpackedSize,
    repository: HUB_REPOSITORY_URL,
    sourcePath,
    manifestPath: `${sourcePath}/${PACKAGE_MANIFEST_FILENAME}`,
    sourceRevision,
  };
}

function assertOfficialSeedCoverage(indexData, assetIds) {
  const kinds = [...new Set(assetIds.map((assetId) => indexData.assets[assetId].kind))].sort(comparePortable);
  if (JSON.stringify(kinds) !== JSON.stringify([...OFFICIAL_SEED_KINDS])) {
    throw new Error(`官方离线种子必须确定性覆盖四类资产，当前为：${kinds.join(', ')}`);
  }
  return kinds;
}

async function createOfflineSeed(options) {
  const { indexData, distDirectory, generatedAt, sourceRevision } = options;
  const assetIds = Object.entries(indexData.assets)
    .filter(([, asset]) => asset.trust === 'official' && asset.status !== 'revoked')
    .map(([assetId]) => assetId)
    .sort(comparePortable);
  const packageNames = Object.entries(indexData.packages)
    .filter(([, packageEntry]) => packageEntry.assetIds.some((assetId) => assetIds.includes(assetId)))
    .map(([packageName]) => packageName)
    .sort(comparePortable);
  if (assetIds.length === 0 || packageNames.length === 0) {
    throw new Error('离线种子至少需要一项官方资产');
  }
  const assetKinds = assertOfficialSeedCoverage(indexData, assetIds);
  const seedIndex = {
    ...indexData,
    assets: Object.fromEntries(assetIds.map((assetId) => [assetId, indexData.assets[assetId]])),
    packages: Object.fromEntries(packageNames.map((name) => [name, indexData.packages[name]])),
    metadata: {
      ...indexData.metadata,
      totalPackages: packageNames.length,
      totalAssets: assetIds.length,
    },
  };
  const seedIndexBytes = Buffer.from(`${JSON.stringify(seedIndex, null, 2)}\n`);
  const archive = new JSZip();
  archive.file('seed-index.json', seedIndexBytes, {
    binary: true,
    date: FIXED_ZIP_DATE,
    unixPermissions: 0o100644,
  });
  for (const packageName of packageNames) {
    const tarball = indexData.packages[packageName].tarball;
    archive.file(`packages/${tarball}`, fs.readFileSync(path.join(distDirectory, tarball)), {
      binary: true,
      createFolders: false,
      date: FIXED_ZIP_DATE,
      unixPermissions: 0o100644,
    });
  }
  const bundle = await archive.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
    platform: 'UNIX',
    streamFiles: false,
  });
  const bundleDigest = sha256Integrity(bundle);
  const bundleFileName = `tjuae-seed-${bundleDigest.slice('sha256-'.length)}.zip`;
  fs.writeFileSync(path.join(distDirectory, bundleFileName), bundle);
  const seedManifest = {
    $schema: OFFLINE_SEED_SCHEMA_URL,
    schemaVersion: 1,
    generatedAt,
    sourceRevision,
    seedIndexDigest: sha256Integrity(seedIndexBytes),
    bundle: { fileName: bundleFileName, digest: bundleDigest, size: bundle.length },
    assetKinds,
    packageNames,
    assetIds,
  };
  fs.writeFileSync(path.join(distDirectory, 'seed-manifest.json'), `${JSON.stringify(seedManifest, null, 2)}\n`);
  return seedManifest;
}

async function buildRepository(options) {
  const { repositoryRoot, sourceRevision, generatedAt } = options;
  validateAssetPackages();
  const assetsDirectory = assertInside(repositoryRoot, path.join(repositoryRoot, 'assets'));
  const distDirectory = assertInside(repositoryRoot, options.distDirectory ?? path.join(repositoryRoot, 'dist'));
  const trustPolicy = loadTrustPolicy(repositoryRoot);
  if (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(sourceRevision) || !Number.isFinite(Date.parse(generatedAt))) {
    throw new Error('构建源码修订或时间戳无效');
  }
  fs.rmSync(distDirectory, { recursive: true, force: true });
  fs.mkdirSync(distDirectory, { recursive: true });

  const indexData = {
    $schema: HUB_INDEX_SCHEMA_URL,
    schemaVersion: 2,
    generatedAt,
    assets: {},
    packages: {},
    metadata: {
      totalPackages: 0,
      totalAssets: 0,
      generatedBy: 'Tjuae 资产构建器 v3.0.0',
      repository: HUB_REPOSITORY_URL,
      sourceRevision,
    },
  };
  const packageNames = fs
    .readdirSync(assetsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(PACKAGE_PREFIX))
    .map((entry) => entry.name)
    .sort(comparePortable);
  if (packageNames.length === 0) {
    throw new Error(`未找到使用 ${PACKAGE_PREFIX} 前缀的已发布资产包`);
  }
  for (const packageName of trustPolicy.revokedPackages) {
    if (!packageNames.includes(packageName)) {
      throw new Error(`资产信任策略撤销了不存在的包：${packageName}`);
    }
  }

  const buildRows = [];
  for (const packageName of packageNames) {
    const packagePath = path.join(assetsDirectory, packageName);
    const manifestPath = path.join(packagePath, PACKAGE_MANIFEST_FILENAME);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (manifest.name !== packageName) {
      throw new Error(`${packageName} 的目录与包身份不一致`);
    }
    validateOfficialPackageProvenance(manifest, trustPolicy.officialProvenance);
    const files = getAllFiles(packagePath);
    const fileManifest = buildFileManifest(packagePath, files);
    const archive = await createAssetArchive(packagePath, files);
    const tarball = `${packageName}.zip`;
    fs.writeFileSync(path.join(distDirectory, tarball), archive);
    const records = createAssetRecords(manifest, fileManifest, sourceRevision, trustPolicy);
    const assetIds = Object.keys(records).sort(comparePortable);
    for (const assetId of assetIds) {
      if (indexData.assets[assetId]) {
        throw new Error(`Hub 索引中出现重复资产 ID：${assetId}`);
      }
      indexData.assets[assetId] = records[assetId];
    }
    buildRows.push({
      manifest,
      assetIds,
      tarball,
      integrity: `sha256-${computeContentHash(packagePath, files)}`,
      archiveIntegrity: sha256Integrity(archive),
      unpackedSize: files.reduce((total, file) => total + fs.statSync(file).size, 0),
    });
  }

  for (const row of buildRows) {
    const dependencies = {};
    for (const assetId of row.assetIds) {
      for (const dependencyId of indexData.assets[assetId].dependencies) {
        const dependency = indexData.assets[dependencyId];
        if (!dependency) {
          throw new Error(`${assetId} 引用了不存在的远程资产 ${dependencyId}`);
        }
        if (dependency.packageName !== row.manifest.name) {
          dependencies[dependency.packageName] = dependency.version;
        }
      }
    }
    indexData.packages[row.manifest.name] = createPackageRecord({
      ...row,
      dependencies,
      sourceRevision,
    });
  }
  indexData.assets = Object.fromEntries(
    Object.entries(indexData.assets).sort(([left], [right]) => comparePortable(left, right))
  );
  indexData.packages = Object.fromEntries(
    Object.entries(indexData.packages).sort(([left], [right]) => comparePortable(left, right))
  );
  indexData.metadata.totalPackages = Object.keys(indexData.packages).length;
  indexData.metadata.totalAssets = Object.keys(indexData.assets).length;
  const indexPath = path.join(distDirectory, 'index.json');
  fs.writeFileSync(indexPath, `${JSON.stringify(indexData, null, 2)}\n`);
  await createOfflineSeed({ indexData, distDirectory, generatedAt, sourceRevision });
  return {
    packageCount: indexData.metadata.totalPackages,
    assetCount: indexData.metadata.totalAssets,
    indexPath,
  };
}

async function main() {
  const repositoryRoot = path.resolve(__dirname, '..', '..');
  const sourceRevision = resolveSourceRevision(repositoryRoot);
  const generatedAt = resolveGeneratedAt(repositoryRoot, sourceRevision);
  const result = await buildRepository({ repositoryRoot, sourceRevision, generatedAt });
  console.log(`已构建 ${result.packageCount} 个原子包和 ${result.assetCount} 项 TjuaeHub 资产。`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  HUB_INDEX_SCHEMA_URL,
  HUB_REPOSITORY_URL,
  OFFICIAL_PROVENANCE_PATH,
  OFFICIAL_SEED_KINDS,
  OFFLINE_SEED_SCHEMA_URL,
  PACKAGE_MANIFEST_FILENAME,
  PACKAGE_PREFIX,
  TRUST_POLICY_PATH,
  assertOfficialSeedCoverage,
  buildFileManifest,
  buildRepository,
  comparePortable,
  computeContentHash,
  computeDefinitionDigest,
  createAssetArchive,
  createAssetRecords,
  createOfflineSeed,
  createPackageRecord,
  getAllFiles,
  loadTrustPolicy,
  main,
  mediaTypeForPath,
  relativePosixPath,
  resolveAssetTrust,
  resolveGeneratedAt,
  resolveSourceRevision,
  sha256Integrity,
  validateOfficialPackageProvenance,
};
