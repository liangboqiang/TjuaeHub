/**
 * @license
 * Copyright 2026 Tjuae
 * SPDX-License-Identifier: Apache-2.0
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const JSZip = require('jszip');

const EXTENSION_PREFIX = 'tjuaeext-';
const MANIFEST_FILENAME = 'tjuae-extension.json';
const FIXED_ZIP_DATE = new Date('2024-01-01T00:00:00.000Z');
const SKIPPED_NAMES = new Set(['node_modules', '.git', '.DS_Store', '__MACOSX']);

/**
 * Return all regular files below a directory in stable relative-path order.
 *
 * @param {string} directory
 * @returns {string[]}
 */
function getAllFiles(directory) {
  const files = [];

  function walk(current) {
    const entries = fs
      .readdirSync(current, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      if (SKIPPED_NAMES.has(entry.name)) {
        continue;
      }

      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }

  walk(directory);
  return files;
}

/**
 * Compute the source-content hash used by the Hub index.
 *
 * @param {string} extensionPath
 * @param {string[]} files
 * @returns {string}
 */
function computeContentHash(extensionPath, files = getAllFiles(extensionPath)) {
  const hash = crypto.createHash('sha256');

  for (const file of files) {
    const relativePath = path.relative(extensionPath, file).split(path.sep).join('/');
    hash.update(relativePath);
    hash.update(fs.readFileSync(file));
  }

  return hash.digest('hex');
}

/**
 * Build a deterministic ZIP archive without modifying source mtimes.
 *
 * @param {string} extensionPath
 * @param {string[]} files
 * @returns {Promise<Buffer>}
 */
async function createExtensionArchive(extensionPath, files) {
  const archive = new JSZip();

  for (const file of files) {
    const relativePath = path.relative(extensionPath, file).split(path.sep).join('/');
    archive.file(relativePath, fs.readFileSync(file), {
      binary: true,
      createFolders: true,
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

/**
 * Summarize extension contributions for the generated index.
 *
 * @param {Record<string, unknown>} contributes
 * @returns {{ hubs: string[], summary: Record<string, string[]> }}
 */
function summarizeContributions(contributes) {
  const hubs = [];
  const summary = {};

  for (const [key, value] of Object.entries(contributes ?? {})) {
    if (!Array.isArray(value) || value.length === 0) {
      continue;
    }

    hubs.push(key);
    summary[key] = value
      .map((item) => (item && typeof item === 'object' ? item.id : undefined))
      .filter((id) => typeof id === 'string');
  }

  return { hubs, summary };
}

/**
 * Build all active extension archives and the Hub index.
 *
 * @returns {Promise<void>}
 */
async function main() {
  const repositoryRoot = path.resolve(__dirname, '..', '..');
  const extensionsDirectory = path.join(repositoryRoot, 'extensions');
  const distDirectory = path.join(repositoryRoot, 'dist');
  const indexPath = path.join(distDirectory, 'index.json');

  fs.rmSync(distDirectory, { recursive: true, force: true });
  fs.mkdirSync(distDirectory, { recursive: true });

  const generatedAt = process.env.SOURCE_DATE_EPOCH
    ? new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000).toISOString()
    : new Date().toISOString();

  const indexData = {
    schemaVersion: 2,
    generatedAt,
    extensions: {},
    metadata: {
      totalExtensions: 0,
      generatedBy: 'Tjuae 扩展构建器 v2.0.0',
      repository: 'https://github.com/liangboqiang/TjuaeHub/',
    },
  };

  const extensionDirectories = fs
    .readdirSync(extensionsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(EXTENSION_PREFIX))
    .map((entry) => entry.name)
    .sort();

  if (extensionDirectories.length === 0) {
    throw new Error(`未找到使用 ${EXTENSION_PREFIX} 前缀的扩展目录`);
  }

  for (const extensionDirectoryName of extensionDirectories) {
    const extensionPath = path.join(extensionsDirectory, extensionDirectoryName);
    const manifestPath = path.join(extensionPath, MANIFEST_FILENAME);
    const zipName = `${extensionDirectoryName}.zip`;
    const zipPath = path.join(distDirectory, zipName);

    if (!fs.existsSync(manifestPath)) {
      throw new Error(`${extensionDirectoryName} 缺少 ${MANIFEST_FILENAME}`);
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (manifest.name !== extensionDirectoryName) {
      throw new Error(`${MANIFEST_FILENAME} 中的名称 ${manifest.name} 与目录 ${extensionDirectoryName} 不一致`);
    }

    const files = getAllFiles(extensionPath);
    const archive = await createExtensionArchive(extensionPath, files);
    fs.writeFileSync(zipPath, archive);

    const { hubs, summary } = summarizeContributions(manifest.contributes);
    const unpackedSize = files.reduce((total, file) => total + fs.statSync(file).size, 0);

    indexData.extensions[extensionDirectoryName] = {
      name: manifest.name,
      displayName: manifest.displayName,
      version: manifest.version,
      description: manifest.description ?? '',
      author: manifest.author ?? 'Tjuae',
      icon: manifest.icon,
      engines: manifest.engine ?? {},
      hubs,
      contributes: summary,
      dist: {
        tarball: zipName,
        integrity: `sha256-${computeContentHash(extensionPath, files)}`,
        archiveIntegrity: `sha256-${crypto.createHash('sha256').update(archive).digest('hex')}`,
        unpackedSize,
      },
    };
  }

  indexData.metadata.totalExtensions = Object.keys(indexData.extensions).length;
  fs.writeFileSync(indexPath, `${JSON.stringify(indexData, null, 2)}\n`);
  console.log(`已构建 ${indexData.metadata.totalExtensions} 个 TjuaeHub 扩展。`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  EXTENSION_PREFIX,
  MANIFEST_FILENAME,
  computeContentHash,
  createExtensionArchive,
  getAllFiles,
  main,
  summarizeContributions,
};
