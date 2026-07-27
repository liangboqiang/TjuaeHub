const fs = require('node:fs');
const path = require('node:path');
const JSZip = require('jszip');

const REPOSITORY_ROOT = path.resolve(__dirname, '..', '..');
const LEGACY_IDENTITY_PATTERN = new RegExp([['ai', 'on'].join(''), ['i', 'office', 'ai'].join('')].join('|'), 'i');
const RETIRED_INTEGRATION_PATTERN = new RegExp(
  [['sen', 'try'].join(''), ['tele', 'metry'].join(''), ['office', 'cli'].join(''), ['analytics', 'id'].join('')].join(
    '|'
  ),
  'i'
);
const MUTABLE_DISTRIBUTION_PATTERN = new RegExp(['dist', 'latest'].join('-'), 'i');
const ALLOWED_ATTRIBUTION_FILES = new Set(['UPSTREAM.md']);
const EXCLUDED_DIRECTORIES = new Set(['.git', 'coverage', 'node_modules']);
const TEXT_EXTENSIONS = new Set([
  '.css',
  '.html',
  '.js',
  '.json',
  '.lock',
  '.md',
  '.svg',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml',
]);

/**
 * Return legacy-brand matches in a text value.
 *
 * @param {string} text
 * @param {string} source
 * @returns {{ source: string, line: number }[]}
 */
function findBrandMatches(text, source, { includeRetiredIntegrations = true } = {}) {
  const violations = [];
  const lines = text.split(/\r?\n/u);

  lines.forEach((line, index) => {
    if (
      LEGACY_IDENTITY_PATTERN.test(line) ||
      MUTABLE_DISTRIBUTION_PATTERN.test(line) ||
      (includeRetiredIntegrations && RETIRED_INTEGRATION_PATTERN.test(line))
    ) {
      violations.push({ source, line: index + 1 });
    }
    LEGACY_IDENTITY_PATTERN.lastIndex = 0;
    RETIRED_INTEGRATION_PATTERN.lastIndex = 0;
    MUTABLE_DISTRIBUTION_PATTERN.lastIndex = 0;
  });

  return violations;
}

/**
 * Enumerate repository files without following generated dependency trees.
 *
 * @param {string} directory
 * @param {boolean} includeDist
 * @returns {string[]}
 */
function listFiles(directory, includeDist) {
  const files = [];

  function walk(current) {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (
          EXCLUDED_DIRECTORIES.has(entry.name) ||
          (!includeDist && entry.name === 'dist' && current === REPOSITORY_ROOT)
        ) {
          continue;
        }
        walk(path.join(current, entry.name));
      } else if (entry.isFile()) {
        files.push(path.join(current, entry.name));
      }
    }
  }

  walk(directory);
  return files;
}

/**
 * Scan a ZIP archive for legacy names and text.
 *
 * @param {string} zipPath
 * @returns {Promise<{ source: string, line: number }[]>}
 */
async function scanZipArchive(zipPath) {
  const violations = [];
  const archive = await JSZip.loadAsync(fs.readFileSync(zipPath));
  const relativeZipPath = path.relative(REPOSITORY_ROOT, zipPath).split(path.sep).join('/');

  for (const [entryName, entry] of Object.entries(archive.files)) {
    if (
      LEGACY_IDENTITY_PATTERN.test(entryName) ||
      RETIRED_INTEGRATION_PATTERN.test(entryName) ||
      MUTABLE_DISTRIBUTION_PATTERN.test(entryName)
    ) {
      violations.push({ source: `${relativeZipPath}:${entryName}`, line: 0 });
    }
    LEGACY_IDENTITY_PATTERN.lastIndex = 0;
    RETIRED_INTEGRATION_PATTERN.lastIndex = 0;
    MUTABLE_DISTRIBUTION_PATTERN.lastIndex = 0;

    if (entry.dir || !TEXT_EXTENSIONS.has(path.extname(entryName).toLowerCase())) {
      continue;
    }

    const text = await entry.async('string');
    violations.push(...findBrandMatches(text, `${relativeZipPath}:${entryName}`));
  }

  return violations;
}

/**
 * Scan source paths, source text, and optionally generated ZIP contents.
 *
 * @param {{ includeDist?: boolean }} options
 * @returns {Promise<{ source: string, line: number }[]>}
 */
async function scanRepository({ includeDist = false } = {}) {
  const violations = [];
  const files = listFiles(REPOSITORY_ROOT, includeDist);

  for (const file of files) {
    const relativePath = path.relative(REPOSITORY_ROOT, file).split(path.sep).join('/');

    if (
      LEGACY_IDENTITY_PATTERN.test(relativePath) ||
      RETIRED_INTEGRATION_PATTERN.test(relativePath) ||
      MUTABLE_DISTRIBUTION_PATTERN.test(relativePath)
    ) {
      violations.push({ source: relativePath, line: 0 });
    }
    LEGACY_IDENTITY_PATTERN.lastIndex = 0;
    RETIRED_INTEGRATION_PATTERN.lastIndex = 0;
    MUTABLE_DISTRIBUTION_PATTERN.lastIndex = 0;

    if (ALLOWED_ATTRIBUTION_FILES.has(relativePath) || !TEXT_EXTENSIONS.has(path.extname(file).toLowerCase())) {
      continue;
    }

    violations.push(
      ...findBrandMatches(fs.readFileSync(file, 'utf8'), relativePath, {
        // Lockfiles may name optional third-party peer APIs without shipping
        // or activating those integrations.
        includeRetiredIntegrations: relativePath !== 'bun.lock',
      })
    );
  }

  if (includeDist) {
    const distDirectory = path.join(REPOSITORY_ROOT, 'dist');
    const zipPaths = fs
      .readdirSync(distDirectory)
      .filter((name) => name.endsWith('.zip'))
      .map((name) => path.join(distDirectory, name));

    for (const zipPath of zipPaths) {
      violations.push(...(await scanZipArchive(zipPath)));
    }
  }

  return violations;
}

async function main() {
  const includeDist = process.argv.includes('--include-dist');
  const violations = await scanRepository({ includeDist });

  if (violations.length > 0) {
    for (const violation of violations) {
      console.error(`${violation.source}:${violation.line}`);
    }
    throw new Error(`发现 ${violations.length} 处已停用的身份或集成标识`);
  }

  console.log(`品牌门禁通过${includeDist ? '（源码与分发产物）' : '（源码）'}。`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  findBrandMatches,
  scanRepository,
  scanZipArchive,
};
