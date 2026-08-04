import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { findBrandMatches, scanRepository } = require('../scripts/quality/check-brand');

describe('品牌身份', () => {
  it('确保活跃源码不含已停用身份', async () => {
    await expect(scanRepository()).resolves.toEqual([]);
  });

  it('报告已停用身份及其源文件行号', () => {
    const retiredName = ['Ai', 'onHub'].join('');

    expect(findBrandMatches(`first\n${retiredName}\nthird`, 'fixture.txt')).toEqual([
      { source: 'fixture.txt', line: 2 },
    ]);
  });

  it('报告已停用的发布者身份', () => {
    const retiredPublisher = ['i', 'Office', 'AI'].join('');

    expect(findBrandMatches(retiredPublisher, 'fixture.txt')).toEqual([{ source: 'fixture.txt', line: 1 }]);
  });

  it('报告已停用的上报和文档集成', () => {
    const retiredReporting = ['tele', 'metry'].join('');
    const retiredDocumentTool = ['office', 'cli'].join('');

    expect(findBrandMatches(`${retiredReporting}\n${retiredDocumentTool}`, 'fixture.txt')).toEqual([
      { source: 'fixture.txt', line: 1 },
      { source: 'fixture.txt', line: 2 },
    ]);
  });
});
