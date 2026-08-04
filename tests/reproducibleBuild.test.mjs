import fs from 'node:fs';
import path from 'node:path';

import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

const {
  assertOfficialSeedCoverage,
  buildFileManifest,
  computeContentHash,
  createAssetArchive,
  getAllFiles,
  loadTrustPolicy,
  resolveAssetTrust,
  resolveGeneratedAt,
  sha256Integrity,
} = require('../.github/scripts/build-assets');

const repositoryRoot = path.resolve(import.meta.dirname, '..');

describe('可复现原子资产构建', () => {
  it('同一源码生成字节一致的 ZIP 与稳定文件清单', async () => {
    const packageRoot = path.join(repositoryRoot, 'assets/tjuaeasset-codex');
    const files = getAllFiles(packageRoot);
    const first = await createAssetArchive(packageRoot, files);
    const second = await createAssetArchive(packageRoot, files);
    expect(first.equals(second)).toBe(true);
    expect(sha256Integrity(first)).toBe(sha256Integrity(second));
    expect(buildFileManifest(packageRoot, files).map((file) => file.path)).toEqual([
      'asset-package.json',
      'engine-adapter.json',
      'resources/icon.svg',
    ]);
    expect(computeContentHash(packageRoot, files)).toMatch(/^[0-9a-f]{64}$/u);
    const archive = await JSZip.loadAsync(first);
    expect(Object.keys(archive.files).sort()).toEqual([
      'asset-package.json',
      'engine-adapter.json',
      'resources/icon.svg',
    ]);
  });

  it('SOURCE_DATE_EPOCH 决定稳定构建时间', () => {
    expect(resolveGeneratedAt(repositoryRoot, '0'.repeat(40), { SOURCE_DATE_EPOCH: '0' })).toBe(
      '1970-01-01T00:00:00.000Z'
    );
    expect(() => resolveGeneratedAt(repositoryRoot, '0'.repeat(40), { SOURCE_DATE_EPOCH: '-1' })).toThrow(
      'SOURCE_DATE_EPOCH'
    );
  });

  it('信任只来自逐项 provenance 策略', () => {
    const policy = loadTrustPolicy(repositoryRoot);
    expect(resolveAssetTrust('tjuaeasset-codex', policy)).toBe('official');
    expect(resolveAssetTrust('tjuaeasset-auggie', policy)).toBe('community');
    expect(() =>
      resolveAssetTrust('tjuaeasset-fake', {
        officialPackages: new Set(['tjuaeasset-fake']),
        verifiedPackages: new Set(),
        revokedPackages: new Set(),
        officialProvenance: new Map(),
      })
    ).toThrow('缺少来源记录');
  });

  it('当前索引官方子集确定性覆盖四类', () => {
    const index = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'dist/index.json'), 'utf8'));
    const ids = Object.keys(index.assets).filter((id) => index.assets[id].trust === 'official');
    expect(assertOfficialSeedCoverage(index, ids)).toEqual(['assistant', 'engineAdapter', 'mcp', 'skill']);
  });
});
