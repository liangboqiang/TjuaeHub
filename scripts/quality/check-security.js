const fs = require('node:fs');
const path = require('node:path');
const JSZip = require('jszip');

const REPOSITORY_ROOT = path.resolve(__dirname, '..', '..');
const SOURCE_GROUPS = ['assets', 'submissions'];
const MAX_PACKAGE_FILES = 512;
const MAX_SINGLE_FILE_BYTES = 10 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 50 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 20 * 1024 * 1024;
const ALLOWED_BINARY_EXTENSIONS = new Set([
  '.gif',
  '.icns',
  '.ico',
  '.jpeg',
  '.jpg',
  '.otf',
  '.png',
  '.ttf',
  '.webp',
  '.woff',
  '.woff2',
  '.zip',
]);
const FORBIDDEN_FILE_EXTENSIONS = new Set([
  '.env',
  '.jks',
  '.kdbx',
  '.key',
  '.keystore',
  '.mobileprovision',
  '.ovpn',
  '.p12',
  '.pem',
  '.pfx',
  '.toml',
]);
const FORBIDDEN_FILE_NAMES = new Set([
  'authorized_keys',
  'credentials',
  'credentials.json',
  'git-credentials',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  'id_rsa',
  'known_hosts',
  'netrc',
  'npmrc',
  'pypirc',
  'secrets',
  'secrets.json',
]);
const FILE_PATH_KEYS = new Set([
  'contextFile',
  'cover',
  'directory',
  'definitionFile',
  'entryPoint',
  'file',
  'icon',
  'localesDir',
  'script',
]);
const HIGH_CONFIDENCE_CONTENT_PATTERNS = [
  {
    pattern: /-----BEGIN (?:DSA |EC |OPENSSH |RSA )?PRIVATE KEY-----/iu,
    reason: '检测到私钥',
  },
  {
    pattern:
      /\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16})\b/iu,
    reason: '检测到访问令牌或云凭据',
  },
  {
    pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=?\b/iu,
    reason: '检测到 Bearer 凭据',
  },
  {
    pattern: /\b[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s@]+@/iu,
    reason: '检测到 URL 内嵌凭据',
  },
  {
    pattern:
      /(?:[A-Za-z]:[\\/](?:Users|Documents and Settings)[\\/][^\\/\s]+|\/(?:Users|home)\/[^/\s]+\/|\\\\[^\\\s]+\\[^\\\s]+)/iu,
    reason: '检测到本机用户目录或 UNC 路径',
  },
];
const SECRET_ASSIGNMENT_PATTERN =
  /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?key|password|passwd|secret)\b\s*[:=]\s*(?<value>[^\s#]{4,})/gimu;

/**
 * Decide whether a declared sensitive value is a non-secret placeholder.
 *
 * @param {string} value
 * @returns {boolean}
 */
function isSecretPlaceholder(value) {
  const trimmed = value.trim().replace(/^["'`,;]+|["'`,;]+$/gu, '');
  const uppercase = trimmed.toUpperCase();
  return (
    trimmed.length === 0 ||
    trimmed === '***' ||
    /^\*+$/u.test(trimmed) ||
    /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/u.test(trimmed) ||
    /^\{\{[^{}]+\}\}$/u.test(trimmed) ||
    /^<[^<>]+>$/u.test(trimmed) ||
    /^process\.env\.[A-Za-z_][A-Za-z0-9_]*$/u.test(trimmed) ||
    /^\$env:[A-Za-z_][A-Za-z0-9_]*$/iu.test(trimmed) ||
    uppercase === 'CHANGEME' ||
    uppercase === 'EXAMPLE' ||
    uppercase === 'REPLACE_ME' ||
    uppercase === 'REDACTED'
  );
}

/**
 * Normalize one JSON key before comparing it with the sensitive-key denylist.
 *
 * @param {string} key
 * @returns {boolean}
 */
function isSensitiveKey(key) {
  const canonical = key
    .replace(/([a-z0-9])([A-Z])/gu, '$1_$2')
    .toLowerCase()
    .replace(/-/gu, '_');
  return /(?:^|_)(?:api_?key|access_?token|auth_?token|authorization|client_?secret|password|passwd|private_?key|refresh_?token|secret)(?:$|_)/u.test(
    canonical
  );
}

/**
 * Validate one portable path stored in source or an archive.
 *
 * @param {string} value
 * @returns {string | undefined}
 */
function validateSafeRelativePath(value) {
  if (value.length === 0 || value.trim() !== value) {
    return '路径为空或包含首尾空白';
  }
  if (value.includes('\\') || value.includes('\0') || /[\u0001-\u001f]/u.test(value)) {
    return '路径包含反斜杠、空字符或控制字符';
  }
  if (value.startsWith('/') || /^[A-Za-z]:/u.test(value) || value.startsWith('//')) {
    return '路径不能是绝对路径、盘符路径或 UNC 路径';
  }
  if (value.includes(':')) {
    return '路径不能包含冒号';
  }

  const parts = value.split('/');
  if (parts.some((part) => part.length === 0 || part === '.' || part === '..')) {
    return '路径包含空段、当前目录或上级目录';
  }
  return undefined;
}

/**
 * Reject paths and file types that should never enter a public asset package.
 *
 * This check is deliberately independent of file contents, so it also covers
 * encrypted, binary, empty, or otherwise unscannable credential files.
 *
 * @param {string} value
 * @returns {string | undefined}
 */
function validatePublishablePath(value) {
  const normalized = value.replace(/\/$/u, '');
  const pathError = validateSafeRelativePath(normalized);
  if (pathError) {
    return pathError;
  }

  const parts = normalized.split('/');
  if (parts.some((part) => part.startsWith('.'))) {
    return '公开资产包不得包含点文件或点目录';
  }

  const fileName = parts.at(-1).toLowerCase();
  const extension = path.posix.extname(fileName);
  if (FORBIDDEN_FILE_NAMES.has(fileName) || FORBIDDEN_FILE_EXTENSIONS.has(extension)) {
    return '文件名或文件类型属于敏感凭据配置';
  }
  return undefined;
}

/**
 * Scan parsed JSON for literal credentials and unsafe declared file paths.
 *
 * @param {unknown} value
 * @param {string} source
 * @param {string[]} jsonPath
 * @returns {{ source: string, reason: string }[]}
 */
function findSensitiveValues(value, source = 'fixture.json', jsonPath = []) {
  const violations = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      violations.push(...findSensitiveValues(item, source, [...jsonPath, String(index)]));
    });
    return violations;
  }
  if (!value || typeof value !== 'object') {
    return violations;
  }

  for (const [key, child] of Object.entries(value)) {
    const childPath = [...jsonPath, key];
    const location = `${source}#/${childPath.join('/')}`;

    if (isSensitiveKey(key) && typeof child === 'string' && !isSecretPlaceholder(child)) {
      violations.push({ source: location, reason: '敏感字段包含字面量凭据' });
    }

    if (typeof child === 'string' && FILE_PATH_KEYS.has(key)) {
      const pathError = validateSafeRelativePath(child);
      if (pathError) {
        violations.push({ source: location, reason: pathError });
      }
    }

    if (typeof child === 'string' && child.startsWith('$file:')) {
      const referenceError = validateSafeRelativePath(child.slice('$file:'.length));
      if (referenceError) {
        violations.push({ source: location, reason: `不安全的 $file 引用：${referenceError}` });
      }
    }

    violations.push(...findSensitiveValues(child, source, childPath));
  }
  return violations;
}

/**
 * Scan high-confidence credential formats in a text file.
 *
 * @param {string} text
 * @param {string} source
 * @returns {{ source: string, reason: string }[]}
 */
function findSecretPatterns(text, source = 'fixture.txt') {
  const violations = [];
  for (const { pattern, reason } of HIGH_CONFIDENCE_CONTENT_PATTERNS) {
    if (pattern.test(text)) {
      violations.push({ source, reason });
    }
    pattern.lastIndex = 0;
  }

  for (const match of text.matchAll(SECRET_ASSIGNMENT_PATTERN)) {
    const value = match.groups?.value;
    if (value && !isSecretPlaceholder(value)) {
      violations.push({ source, reason: '检测到疑似明文密钥配置' });
    }
  }
  SECRET_ASSIGNMENT_PATTERN.lastIndex = 0;
  return violations;
}

/**
 * Parse and scan one file payload.
 *
 * Every UTF-8 file is scanned regardless of extension. Non-UTF-8 files must
 * use an explicitly allowed asset extension; their raw bytes are still
 * searched for high-confidence ASCII credential and local-path patterns.
 *
 * @param {Buffer} bytes
 * @param {string} source
 * @param {string} logicalPath
 * @returns {{ source: string, reason: string }[]}
 */
function scanFilePayload(bytes, source, logicalPath = source) {
  const violations = [];
  let text;
  let isUtf8 = true;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (text.includes('\0')) {
      isUtf8 = false;
      text = bytes.toString('latin1');
    }
  } catch {
    isUtf8 = false;
    text = bytes.toString('latin1');
  }

  const extension = path.posix.extname(logicalPath.toLowerCase());
  if (!isUtf8 && !ALLOWED_BINARY_EXTENSIONS.has(extension)) {
    violations.push({
      source,
      reason: '文件无法以 UTF-8 扫描，且不属于允许的二进制资源类型',
    });
  }

  violations.push(...findSecretPatterns(text, source));
  if (isUtf8 && extension === '.json') {
    try {
      violations.push(...findSensitiveValues(JSON.parse(text), source));
    } catch (error) {
      violations.push({ source, reason: `JSON 无法解析：${error.message}` });
    }
  }
  return violations;
}

/**
 * Recursively scan one extension source directory without following links.
 *
 * @param {string} packagePath
 * @returns {{ source: string, reason: string }[]}
 */
function scanSourcePackage(packagePath) {
  const violations = [];
  const packageRelative = path.relative(REPOSITORY_ROOT, packagePath).split(path.sep).join('/');
  let fileCount = 0;
  let unpackedBytes = 0;

  function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      const relativePath = path.relative(packagePath, fullPath).split(path.sep).join('/');
      const source = `${packageRelative}/${relativePath}`;
      const pathError = validatePublishablePath(relativePath);
      if (pathError) {
        violations.push({ source, reason: pathError });
        continue;
      }

      if (entry.isSymbolicLink()) {
        violations.push({ source, reason: '扩展源码不得包含符号链接或目录联接' });
        continue;
      }
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!entry.isFile()) {
        violations.push({ source, reason: '扩展源码包含不支持的文件类型' });
        continue;
      }

      const stat = fs.statSync(fullPath);
      fileCount += 1;
      unpackedBytes += stat.size;
      if (path.extname(relativePath).toLowerCase() === '.zip') {
        violations.push({ source, reason: '公开扩展源码不得嵌套 ZIP 归档' });
        continue;
      }
      if (stat.size > MAX_SINGLE_FILE_BYTES) {
        violations.push({ source, reason: `单文件超过 ${MAX_SINGLE_FILE_BYTES} 字节上限` });
        continue;
      }

      const bytes = fs.readFileSync(fullPath);
      violations.push(...scanFilePayload(bytes, source, relativePath));
    }
  }

  walk(packagePath);
  if (fileCount > MAX_PACKAGE_FILES) {
    violations.push({ source: packageRelative, reason: `文件数超过 ${MAX_PACKAGE_FILES} 个上限` });
  }
  if (unpackedBytes > MAX_UNPACKED_BYTES) {
    violations.push({ source: packageRelative, reason: `总大小超过 ${MAX_UNPACKED_BYTES} 字节上限` });
  }
  return violations;
}

/**
 * Scan one generated ZIP without trusting entry names or Unix modes.
 *
 * @param {string} zipPath
 * @returns {Promise<{ source: string, reason: string }[]>}
 */
async function scanZipArchive(zipPath) {
  const violations = [];
  const relativeZipPath = path.relative(REPOSITORY_ROOT, zipPath).split(path.sep).join('/');
  const archiveBytes = fs.readFileSync(zipPath);
  if (archiveBytes.length > MAX_ARCHIVE_BYTES) {
    violations.push({ source: relativeZipPath, reason: `归档超过 ${MAX_ARCHIVE_BYTES} 字节上限` });
  }

  const archive = await JSZip.loadAsync(archiveBytes);
  const entries = Object.values(archive.files);
  if (entries.length > MAX_PACKAGE_FILES) {
    violations.push({ source: relativeZipPath, reason: `归档条目超过 ${MAX_PACKAGE_FILES} 个上限` });
  }

  let unpackedBytes = 0;
  for (const entry of entries) {
    const archivePath = entry.unsafeOriginalName ?? entry.name;
    const source = `${relativeZipPath}:${archivePath}`;
    const logicalPath = archivePath.replace(/\/$/u, '');
    const pathError = validatePublishablePath(logicalPath);
    if (pathError) {
      violations.push({ source, reason: pathError });
      continue;
    }

    const unixMode = typeof entry.unixPermissions === 'number' ? entry.unixPermissions : 0;
    if ((unixMode & 0o170000) === 0o120000) {
      violations.push({ source, reason: '归档不得包含符号链接' });
      continue;
    }
    if (entry.dir) {
      continue;
    }

    const declaredSize = Number(entry._data?.uncompressedSize);
    const hasDeclaredSize = Number.isSafeInteger(declaredSize) && declaredSize >= 0;
    if (hasDeclaredSize) {
      unpackedBytes += declaredSize;
      if (declaredSize > MAX_SINGLE_FILE_BYTES) {
        violations.push({ source, reason: `单文件超过 ${MAX_SINGLE_FILE_BYTES} 字节上限` });
        continue;
      }
      if (unpackedBytes > MAX_UNPACKED_BYTES) {
        continue;
      }
    }

    const bytes = await entry.async('nodebuffer');
    if (hasDeclaredSize && bytes.length !== declaredSize) {
      violations.push({ source, reason: '归档声明的解压大小与实际内容不一致' });
      continue;
    }
    if (!hasDeclaredSize) {
      unpackedBytes += bytes.length;
    }
    if (bytes.length > MAX_SINGLE_FILE_BYTES) {
      violations.push({ source, reason: `单文件超过 ${MAX_SINGLE_FILE_BYTES} 字节上限` });
      continue;
    }
    violations.push(...scanFilePayload(bytes, source, logicalPath));
  }

  if (unpackedBytes > MAX_UNPACKED_BYTES) {
    violations.push({ source: relativeZipPath, reason: `解压大小超过 ${MAX_UNPACKED_BYTES} 字节上限` });
  }
  return violations;
}

/**
 * Scan active/pending sources and optionally generated distribution files.
 *
 * @param {{ includeDist?: boolean }} options
 * @returns {Promise<{ source: string, reason: string }[]>}
 */
async function scanRepository({ includeDist = false } = {}) {
  const violations = [];
  for (const group of SOURCE_GROUPS) {
    const groupPath = path.join(REPOSITORY_ROOT, group);
    for (const entry of fs.readdirSync(groupPath, { withFileTypes: true })) {
      const source = `${group}/${entry.name}`;
      if (entry.isSymbolicLink()) {
        violations.push({ source, reason: '扩展根目录不得是符号链接或目录联接' });
      } else if (entry.isDirectory()) {
        violations.push(...scanSourcePackage(path.join(groupPath, entry.name)));
      } else {
        violations.push({ source, reason: '扩展分组根目录只能包含扩展目录' });
      }
    }
  }

  if (includeDist) {
    const distPath = path.join(REPOSITORY_ROOT, 'dist');
    for (const entry of fs.readdirSync(distPath, { withFileTypes: true })) {
      const fullPath = path.join(distPath, entry.name);
      if (!entry.isFile()) {
        violations.push({ source: `dist/${entry.name}`, reason: 'dist 只能包含普通文件' });
      } else if (entry.name.endsWith('.zip')) {
        violations.push(...(await scanZipArchive(fullPath)));
      } else if (entry.name === 'index.json' || entry.name === 'seed-manifest.json') {
        violations.push(...scanFilePayload(fs.readFileSync(fullPath), `dist/${entry.name}`, entry.name));
      }
    }
  }

  return violations;
}

async function main() {
  const includeDist = process.argv.includes('--include-dist');
  const violations = await scanRepository({ includeDist });
  if (violations.length > 0) {
    for (const violation of violations) {
      console.error(`${violation.source}: ${violation.reason}`);
    }
    throw new Error(`发现 ${violations.length} 处敏感信息或路径安全问题`);
  }
  console.log(`安全门禁通过${includeDist ? '（源码与分发产物）' : '（源码）'}。`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  MAX_ARCHIVE_BYTES,
  MAX_PACKAGE_FILES,
  MAX_SINGLE_FILE_BYTES,
  MAX_UNPACKED_BYTES,
  findSecretPatterns,
  findSensitiveValues,
  isSecretPlaceholder,
  scanFilePayload,
  scanRepository,
  scanSourcePackage,
  scanZipArchive,
  validatePublishablePath,
  validateSafeRelativePath,
};
