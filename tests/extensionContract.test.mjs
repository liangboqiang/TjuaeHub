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

describe('扩展契约', () => {
  it('验证全部已启用和候选清单', () => {
    expect(validateExtensions()).toEqual({ activeCount: 7, pendingCount: 7 });
  });

  it('拒绝已停用引擎键且不提供兼容别名', () => {
    const manifestPath = path.join(repositoryRoot, 'extensions', 'tjuaeext-codex', 'tjuae-extension.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const retiredEngineKey = ['ai', 'onui'].join('');
    manifest.engine = { [retiredEngineKey]: '^1.0.0' };

    expect(() => validateManifest(manifest, manifest.name, () => true)).toThrow('只能声明 engine.tjuae');
  });

  it('允许每个贡献字段引用安全的相对 JSON 文件', () => {
    const validateSchema = createSchemaValidator();

    expect(validateFileReferenceContract(validateSchema)).toEqual({
      contributionCount: CONTRIBUTION_KEYS.length,
      rejectedReferenceCount: UNSAFE_FILE_REFERENCES.length,
    });
  });

  it.each(UNSAFE_FILE_REFERENCES)('拒绝不安全的贡献文件引用 %s', (reference) => {
    const validateSchema = createSchemaValidator();

    for (const contributionKey of CONTRIBUTION_KEYS) {
      expect(validateSchema(createManifestFixture(contributionKey, reference))).toBe(false);
    }
  });
});
