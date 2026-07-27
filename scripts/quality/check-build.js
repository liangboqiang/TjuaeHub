const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const JSZip = require('jszip');
const {
  EXTENSION_PREFIX,
  MANIFEST_FILENAME,
  computeContentHash,
  getAllFiles,
} = require('../../.github/scripts/build-extensions');

const REPOSITORY_ROOT = path.resolve(__dirname, '..', '..');
const DIST_DIRECTORY = path.join(REPOSITORY_ROOT, 'dist');

/**
 * Validate top-level generated index metadata.
 *
 * @param {Record<string, any>} index
 * @returns {void}
 */
function validateIndexShape(index) {
  if (index.schemaVersion !== 2) {
    throw new Error('生成的索引必须使用 schemaVersion 2');
  }
  if (index.metadata?.generatedBy !== 'Tjuae 扩展构建器 v2.0.0') {
    throw new Error('生成索引中的构建器身份不正确');
  }
  if (index.metadata?.repository !== 'https://github.com/liangboqiang/TjuaeHub/') {
    throw new Error('生成索引中的仓库地址不正确');
  }
  if (!Number.isFinite(Date.parse(index.generatedAt))) {
    throw new Error('生成索引中的时间戳无效');
  }
}

/**
 * Validate all generated archives and index entries.
 *
 * @returns {Promise<{ extensionCount: number }>}
 */
async function validateBuild() {
  const indexPath = path.join(DIST_DIRECTORY, 'index.json');
  if (!fs.existsSync(indexPath)) {
    throw new Error('dist/index.json 不存在，请先运行构建');
  }

  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  validateIndexShape(index);

  const sourceDirectories = fs
    .readdirSync(path.join(REPOSITORY_ROOT, 'extensions'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(EXTENSION_PREFIX))
    .map((entry) => entry.name)
    .sort();
  const indexNames = Object.keys(index.extensions ?? {}).sort();

  if (JSON.stringify(sourceDirectories) !== JSON.stringify(indexNames)) {
    throw new Error('生成索引中的键与已启用扩展目录不一致');
  }
  if (index.metadata.totalExtensions !== sourceDirectories.length) {
    throw new Error('生成的扩展数量不一致');
  }

  const expectedDistFiles = ['index.json', ...sourceDirectories.map((name) => `${name}.zip`)].sort();
  const actualDistFiles = fs.readdirSync(DIST_DIRECTORY).sort();
  if (JSON.stringify(actualDistFiles) !== JSON.stringify(expectedDistFiles)) {
    throw new Error('dist 中存在缺失或意外的产物');
  }

  for (const extensionName of sourceDirectories) {
    const extensionPath = path.join(REPOSITORY_ROOT, 'extensions', extensionName);
    const entry = index.extensions[extensionName];
    const sourceFiles = getAllFiles(extensionPath);
    const sourceEntries = sourceFiles
      .map((file) => path.relative(extensionPath, file).split(path.sep).join('/'))
      .sort();
    const expectedTarball = `${extensionName}.zip`;

    if (
      entry.name !== extensionName ||
      entry.dist?.tarball !== expectedTarball ||
      Object.keys(entry.engines ?? {}).join(',') !== 'tjuae'
    ) {
      throw new Error(`${extensionName} 的索引元数据不一致`);
    }
    if (entry.dist.integrity !== `sha256-${computeContentHash(extensionPath, sourceFiles)}`) {
      throw new Error(`${extensionName} 的内容哈希无效`);
    }

    const unpackedSize = sourceFiles.reduce((total, file) => total + fs.statSync(file).size, 0);
    if (entry.dist.unpackedSize !== unpackedSize) {
      throw new Error(`${extensionName} 的解压大小无效`);
    }

    const archiveBuffer = fs.readFileSync(path.join(DIST_DIRECTORY, expectedTarball));
    const expectedArchiveIntegrity = `sha256-${crypto.createHash('sha256').update(archiveBuffer).digest('hex')}`;
    if (entry.dist.archiveIntegrity !== expectedArchiveIntegrity) {
      throw new Error(`${extensionName} 的归档哈希无效`);
    }

    const archive = await JSZip.loadAsync(archiveBuffer);
    const archiveEntries = Object.values(archive.files)
      .filter((file) => !file.dir)
      .map((file) => file.name)
      .sort();
    if (JSON.stringify(archiveEntries) !== JSON.stringify(sourceEntries)) {
      throw new Error(`${extensionName} 的归档条目与源文件不一致`);
    }
    if (!archive.file(MANIFEST_FILENAME)) {
      throw new Error(`${extensionName} 的归档中缺少 ${MANIFEST_FILENAME}`);
    }
  }

  return { extensionCount: sourceDirectories.length };
}

async function main() {
  const result = await validateBuild();
  console.log(`已验证 ${result.extensionCount} 个生成的扩展归档。`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  validateBuild,
  validateIndexShape,
};
