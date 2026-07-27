import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { validateExtensions, validateManifest } = require('../scripts/quality/check-extensions');

const repositoryRoot = path.resolve(import.meta.dirname, '..');

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
});
