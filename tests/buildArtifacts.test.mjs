import { createRequire } from 'node:module';
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
});
