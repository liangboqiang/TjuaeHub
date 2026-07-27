const fs = require('node:fs');
const path = require('node:path');
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
    throw new Error('The generated index must use schemaVersion 2');
  }
  if (index.metadata?.generatedBy !== 'Tjuae Extension Builder v2.0.0') {
    throw new Error('The generated index has an unexpected builder identity');
  }
  if (index.metadata?.repository !== 'https://github.com/liangboqiang/TjuaeHub/') {
    throw new Error('The generated index has an unexpected repository URL');
  }
  if (!Number.isFinite(Date.parse(index.generatedAt))) {
    throw new Error('The generated index timestamp is invalid');
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
    throw new Error('dist/index.json does not exist; run the build first');
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
    throw new Error('Generated index keys do not match active extension directories');
  }
  if (index.metadata.totalExtensions !== sourceDirectories.length) {
    throw new Error('Generated extension count is inconsistent');
  }

  const expectedDistFiles = ['index.json', ...sourceDirectories.map((name) => `${name}.zip`)].sort();
  const actualDistFiles = fs.readdirSync(DIST_DIRECTORY).sort();
  if (JSON.stringify(actualDistFiles) !== JSON.stringify(expectedDistFiles)) {
    throw new Error('dist contains missing or unexpected artifacts');
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
      throw new Error(`${extensionName} has inconsistent index metadata`);
    }
    if (entry.dist.integrity !== `sha256-${computeContentHash(extensionPath, sourceFiles)}`) {
      throw new Error(`${extensionName} has an invalid content hash`);
    }

    const unpackedSize = sourceFiles.reduce((total, file) => total + fs.statSync(file).size, 0);
    if (entry.dist.unpackedSize !== unpackedSize) {
      throw new Error(`${extensionName} has an invalid unpacked size`);
    }

    const archive = await JSZip.loadAsync(fs.readFileSync(path.join(DIST_DIRECTORY, expectedTarball)));
    const archiveEntries = Object.values(archive.files)
      .filter((file) => !file.dir)
      .map((file) => file.name)
      .sort();
    if (JSON.stringify(archiveEntries) !== JSON.stringify(sourceEntries)) {
      throw new Error(`${extensionName} archive entries do not match source files`);
    }
    if (!archive.file(MANIFEST_FILENAME)) {
      throw new Error(`${extensionName} archive is missing ${MANIFEST_FILENAME}`);
    }
  }

  return { extensionCount: sourceDirectories.length };
}

async function main() {
  const result = await validateBuild();
  console.log(`Validated ${result.extensionCount} generated extension archives.`);
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
