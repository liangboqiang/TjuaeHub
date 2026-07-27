import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const Ajv2020 = require('ajv/dist/2020');
const {
  CONTRIBUTION_KEYS,
  UNSAFE_FILE_REFERENCES,
  createManifestFixture,
  validateExtensions,
  validateFileReferenceContract,
  validateManifest,
} = require('../scripts/quality/check-extensions');

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const schema = JSON.parse(
  fs.readFileSync(path.join(repositoryRoot, 'schemas', 'extension-manifest.v1.schema.json'), 'utf8')
);

function createSchemaValidator() {
  return new Ajv2020({ allErrors: true, strict: false }).compile(schema);
}

describe('extension contract', () => {
  it('validates all active and pending manifests', () => {
    expect(validateExtensions()).toEqual({ activeCount: 7, pendingCount: 7 });
  });

  it('rejects the retired engine key without a compatibility alias', () => {
    const manifestPath = path.join(repositoryRoot, 'extensions', 'tjuaeext-codex', 'tjuae-extension.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const retiredEngineKey = ['ai', 'onui'].join('');
    manifest.engine = { [retiredEngineKey]: '^1.0.0' };

    expect(() => validateManifest(manifest, manifest.name, () => true)).toThrow('must declare only engine.tjuae');
  });

  it('accepts a safe relative JSON file reference for every contribution field', () => {
    const validateSchema = createSchemaValidator();

    expect(validateFileReferenceContract(validateSchema)).toEqual({
      contributionCount: CONTRIBUTION_KEYS.length,
      rejectedReferenceCount: UNSAFE_FILE_REFERENCES.length,
    });
  });

  it.each(UNSAFE_FILE_REFERENCES)('rejects unsafe contribution file reference %s', (reference) => {
    const validateSchema = createSchemaValidator();

    for (const contributionKey of CONTRIBUTION_KEYS) {
      expect(validateSchema(createManifestFixture(contributionKey, reference))).toBe(false);
    }
  });
});
