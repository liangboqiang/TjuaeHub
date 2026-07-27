import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { findBrandMatches, scanRepository } = require('../scripts/quality/check-brand');

describe('brand identity', () => {
  it('keeps active source free of the retired identity', async () => {
    await expect(scanRepository()).resolves.toEqual([]);
  });

  it('reports a retired identity with its source line', () => {
    const retiredName = ['Ai', 'onHub'].join('');

    expect(findBrandMatches(`first\n${retiredName}\nthird`, 'fixture.txt')).toEqual([
      { source: 'fixture.txt', line: 2 },
    ]);
  });
});
