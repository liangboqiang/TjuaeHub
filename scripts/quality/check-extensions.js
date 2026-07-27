const fs = require('node:fs');
const path = require('node:path');
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');

const REPOSITORY_ROOT = path.resolve(__dirname, '..', '..');
const EXTENSION_PREFIX = 'tjuaeext-';
const MANIFEST_FILENAME = 'tjuae-extension.json';
const SCHEMA_PATH = path.join(REPOSITORY_ROOT, 'schemas', 'extension-manifest.v1.schema.json');
const SCHEMA_URL =
  'https://raw.githubusercontent.com/liangboqiang/TjuaeHub/main/schemas/extension-manifest.v1.schema.json';
const CONTRIBUTION_KEYS = Object.freeze([
  'acpAdapters',
  'mcpServers',
  'assistants',
  'agents',
  'skills',
  'channelPlugins',
  'webui',
  'themes',
  'settingsTabs',
  'modelProviders',
]);
const UNSAFE_FILE_REFERENCES = Object.freeze([
  '$file: ../outside.json',
  '$file:/absolute.json',
  '$file:C:/absolute.json',
  '$file:\\\\server\\share.json',
  '$file:../outside.json',
  '$file:contributes/../../outside.json',
  '$file:contributes\\settings-tabs.json',
  '$file:contributes//settings-tabs.json',
  '$file:contributes/settings-tabs.jsonc',
]);

/**
 * Read and parse a JSON file.
 *
 * @param {string} filePath
 * @returns {Record<string, unknown>}
 */
function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

/**
 * Create a minimal extension manifest for JSON Schema contract checks.
 *
 * @param {string} contributionKey
 * @param {unknown} contribution
 * @returns {Record<string, unknown>}
 */
function createManifestFixture(contributionKey, contribution) {
  return {
    name: 'schema-fixture',
    displayName: '模式样例',
    version: '1.0.0',
    contributes: {
      [contributionKey]: contribution,
    },
  };
}

/**
 * Assert the external contribution file reference contract.
 *
 * @param {(value: unknown) => boolean} validateSchema
 * @returns {{ contributionCount: number, rejectedReferenceCount: number }}
 */
function validateFileReferenceContract(validateSchema) {
  const safeReference = '$file:contributes/nested/settings-tabs.json';

  for (const contributionKey of CONTRIBUTION_KEYS) {
    const manifest = createManifestFixture(contributionKey, safeReference);
    if (!validateSchema(manifest)) {
      throw new Error(`${contributionKey} 拒绝了安全的 $file 引用：${JSON.stringify(validateSchema.errors)}`);
    }
  }

  for (const reference of UNSAFE_FILE_REFERENCES) {
    for (const contributionKey of CONTRIBUTION_KEYS) {
      const manifest = createManifestFixture(contributionKey, reference);
      if (validateSchema(manifest)) {
        throw new Error(`${contributionKey} 接受了不安全的 $file 引用 ${reference}`);
      }
    }
  }

  return {
    contributionCount: CONTRIBUTION_KEYS.length,
    rejectedReferenceCount: UNSAFE_FILE_REFERENCES.length,
  };
}

/**
 * Return manifest paths for a repository group.
 *
 * @param {'extensions' | 'pending'} group
 * @returns {string[]}
 */
function listManifestPaths(group) {
  const groupPath = path.join(REPOSITORY_ROOT, group);
  return fs
    .readdirSync(groupPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((directoryName) => {
      if (!directoryName.startsWith(EXTENSION_PREFIX)) {
        throw new Error(`${group}/${directoryName} 未使用 ${EXTENSION_PREFIX} 前缀`);
      }
      return path.join(groupPath, directoryName, MANIFEST_FILENAME);
    });
}

/**
 * Validate a manifest against both JSON Schema and migration invariants.
 *
 * @param {Record<string, any>} manifest
 * @param {string} directoryName
 * @param {(value: unknown) => boolean} validateSchema
 * @returns {void}
 */
function validateManifest(manifest, directoryName, validateSchema) {
  if (!validateSchema(manifest)) {
    throw new Error(`${directoryName} 未通过模式验证：${JSON.stringify(validateSchema.errors)}`);
  }
  if (manifest.$schema !== SCHEMA_URL) {
    throw new Error(`${directoryName} 使用了意外的模式地址`);
  }
  if (manifest.name !== directoryName) {
    throw new Error(`${directoryName} 与清单名称 ${manifest.name} 不一致`);
  }
  if (manifest.author !== 'Tjuae') {
    throw new Error(`${directoryName} 必须使用 Tjuae 作者身份`);
  }
  if (JSON.stringify(manifest).includes('Official')) {
    throw new Error(`${directoryName} 包含不受支持的背书声明`);
  }

  const engineKeys = Object.keys(manifest.engine ?? {});
  if (engineKeys.length !== 1 || engineKeys[0] !== 'tjuae') {
    throw new Error(`${directoryName} 只能声明 engine.tjuae`);
  }

  for (const contribution of Object.values(manifest.contributes ?? {})) {
    if (!Array.isArray(contribution)) {
      continue;
    }
    const ids = contribution.map((item) => item?.id).filter((id) => typeof id === 'string');
    if (new Set(ids).size !== ids.length) {
      throw new Error(`${directoryName} 包含重复的贡献项 ID`);
    }
  }
}

/**
 * Validate the schema and all active and pending extension manifests.
 *
 * @returns {{ activeCount: number, pendingCount: number }}
 */
function validateExtensions() {
  const schema = readJson(SCHEMA_PATH);
  if (schema.$id !== SCHEMA_URL || schema.version !== '1.0.0') {
    throw new Error('扩展模式的身份或版本不正确');
  }
  if (!schema.properties?.engine?.properties?.tjuae || Object.keys(schema.properties.engine.properties).length !== 1) {
    throw new Error('扩展模式只能公开 engine.tjuae');
  }

  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validateSchema = ajv.compile(schema);
  validateFileReferenceContract(validateSchema);

  const activePaths = listManifestPaths('extensions');
  const pendingPaths = listManifestPaths('pending');
  if (activePaths.length !== 7 || pendingPaths.length !== 7) {
    throw new Error(`应有 7 个已启用清单和 7 个候选清单，实际分别为 ${activePaths.length} 和 ${pendingPaths.length}`);
  }

  for (const manifestPath of [...activePaths, ...pendingPaths]) {
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`缺少清单：${path.relative(REPOSITORY_ROOT, manifestPath)}`);
    }
    const directoryName = path.basename(path.dirname(manifestPath));
    validateManifest(readJson(manifestPath), directoryName, validateSchema);
  }

  return { activeCount: activePaths.length, pendingCount: pendingPaths.length };
}

function main() {
  const result = validateExtensions();
  console.log(`已验证 ${result.activeCount} 个已启用清单和 ${result.pendingCount} 个候选清单。`);
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
  CONTRIBUTION_KEYS,
  MANIFEST_FILENAME,
  SCHEMA_URL,
  UNSAFE_FILE_REFERENCES,
  createManifestFixture,
  listManifestPaths,
  validateExtensions,
  validateFileReferenceContract,
  validateManifest,
};
