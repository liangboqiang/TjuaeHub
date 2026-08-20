const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');

const SKIPPED_NAMES = new Set(['node_modules', '.git', '.DS_Store', '__MACOSX']);

function comparePortable(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertInside(root, target, kind) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`拒绝访问${kind}目录范围外路径：${resolvedTarget}`);
  }
  return resolvedTarget;
}

function listFiles(directory, kind) {
  const root = path.resolve(directory);
  const files = [];
  function walk(current) {
    const entries = fs
      .readdirSync(current, { withFileTypes: true })
      .sort((left, right) => comparePortable(left.name, right.name));
    for (const entry of entries) {
      if (SKIPPED_NAMES.has(entry.name)) continue;
      const fullPath = assertInside(root, path.join(current, entry.name), kind);
      if (entry.isSymbolicLink()) throw new Error(`市场${kind}禁止符号链接：${path.relative(root, fullPath)}`);
      if (entry.isDirectory()) walk(fullPath);
      else if (entry.isFile()) files.push(fullPath);
      else throw new Error(`市场${kind}包含不支持的文件类型：${path.relative(root, fullPath)}`);
    }
  }
  walk(root);
  return files;
}

function relativePosixPath(root, file) {
  return path.relative(root, file).split(path.sep).join('/');
}

function directoryDigest(directory, manifestFile, digestPrefix, files = listFiles(directory, '资源')) {
  const hash = crypto.createHash('sha256');
  hash.update(`${digestPrefix}\0`);
  for (const file of files.filter((file) => path.basename(file) !== manifestFile)) {
    const relative = relativePosixPath(directory, file);
    const contents = fs.readFileSync(file);
    hash.update(relative);
    hash.update('\0');
    hash.update(contents);
    hash.update('\0');
  }
  return `sha256-${hash.digest('hex')}`;
}

function fileIndex(directory, files = listFiles(directory, '资源')) {
  return files.map((file) => {
    const contents = fs.readFileSync(file);
    return {
      path: relativePosixPath(directory, file),
      size: contents.length,
      sha256: crypto.createHash('sha256').update(contents).digest('hex'),
    };
  });
}

function createValidator(schemaPath, expectedId, kind) {
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  if (schema.$id !== expectedId || schema.version !== '1.0.0') {
    throw new Error(`${kind}模式身份或版本无效：${path.basename(schemaPath)}`);
  }
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile(schema);
}

module.exports = {
  comparePortable,
  createValidator,
  directoryDigest,
  fileIndex,
  listFiles,
  relativePosixPath,
};
