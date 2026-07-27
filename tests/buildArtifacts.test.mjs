import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { validateBuild, validateIndexShape } = require('../scripts/quality/check-build');

describe('extension build artifacts', () => {
  it('keeps the generated index and all archives consistent', async () => {
    await expect(validateBuild()).resolves.toEqual({ extensionCount: 7 });
  });

  it('rejects an obsolete index contract', () => {
    expect(() =>
      validateIndexShape({
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        metadata: {},
      })
    ).toThrow('schemaVersion 2');
  });

  it('publishes only a clean, flat dist payload', async () => {
    const workflow = await readFile('.github/workflows/build-extensions.yml', 'utf8');

    expect(workflow).toContain('DIST_TMP=$(mktemp -d)');
    expect(workflow).toContain('cp dist/*.zip dist/index.json "${DIST_TMP}/"');
    expect(workflow).toContain('git clean -ffdx');
    expect(workflow).toContain('cp "${DIST_TMP}/"*.zip "${DIST_TMP}/index.json" .');
    expect(workflow).not.toContain('cp -r dist');
  });
});
