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
    displayName: 'Schema Fixture',
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
      throw new Error(`${contributionKey} rejected a safe $file reference: ${JSON.stringify(validateSchema.errors)}`);
    }
  }

  for (const reference of UNSAFE_FILE_REFERENCES) {
    for (const contributionKey of CONTRIBUTION_KEYS) {
      const manifest = createManifestFixture(contributionKey, reference);
      if (validateSchema(manifest)) {
        throw new Error(`${contributionKey} accepted unsafe $file reference ${reference}`);
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
        throw new Error(`${group}/${directoryName} does not use ${EXTENSION_PREFIX}`);
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
    throw new Error(`${directoryName} failed schema validation: ${JSON.stringify(validateSchema.errors)}`);
  }
  if (manifest.$schema !== SCHEMA_URL) {
    throw new Error(`${directoryName} has an unexpected schema URL`);
  }
  if (manifest.name !== directoryName) {
    throw new Error(`${directoryName} does not match manifest name ${manifest.name}`);
  }
  if (manifest.author !== 'Tjuae') {
    throw new Error(`${directoryName} must use the Tjuae author identity`);
  }
  if (JSON.stringify(manifest).includes('Official')) {
    throw new Error(`${directoryName} contains an unsupported endorsement claim`);
  }

  const engineKeys = Object.keys(manifest.engine ?? {});
  if (engineKeys.length !== 1 || engineKeys[0] !== 'tjuae') {
    throw new Error(`${directoryName} must declare only engine.tjuae`);
  }

  for (const contribution of Object.values(manifest.contributes ?? {})) {
    if (!Array.isArray(contribution)) {
      continue;
    }
    const ids = contribution.map((item) => item?.id).filter((id) => typeof id === 'string');
    if (new Set(ids).size !== ids.length) {
      throw new Error(`${directoryName} contains duplicate contribution IDs`);
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
    throw new Error('The extension schema identity or version is incorrect');
  }
  if (!schema.properties?.engine?.properties?.tjuae || Object.keys(schema.properties.engine.properties).length !== 1) {
    throw new Error('The extension schema must expose only engine.tjuae');
  }

  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validateSchema = ajv.compile(schema);
  validateFileReferenceContract(validateSchema);

  const activePaths = listManifestPaths('extensions');
  const pendingPaths = listManifestPaths('pending');
  if (activePaths.length !== 7 || pendingPaths.length !== 7) {
    throw new Error(
      `Expected 7 active and 7 pending manifests, found ${activePaths.length} and ${pendingPaths.length}`
    );
  }

  for (const manifestPath of [...activePaths, ...pendingPaths]) {
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`Missing manifest: ${path.relative(REPOSITORY_ROOT, manifestPath)}`);
    }
    const directoryName = path.basename(path.dirname(manifestPath));
    validateManifest(readJson(manifestPath), directoryName, validateSchema);
  }

  return { activeCount: activePaths.length, pendingCount: pendingPaths.length };
}

function main() {
  const result = validateExtensions();
  console.log(`Validated ${result.activeCount} active and ${result.pendingCount} pending manifests.`);
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
