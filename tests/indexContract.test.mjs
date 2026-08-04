import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const {
  createIndexValidator,
  validateCompleteFixture,
  validateCrossRepositoryFixture,
  validateIndexContract,
} = require('../scripts/quality/check-index');

const fixtureDirectory = path.resolve(import.meta.dirname, 'fixtures');
const read = (name) => JSON.parse(fs.readFileSync(path.join(fixtureDirectory, name), 'utf8'));

describe('Hub Index v2 原子资产契约', () => {
  it('完整夹具用四个原子包覆盖四类资产', () => {
    expect(validateCompleteFixture()).toEqual({ packageCount: 4, assetCount: 4 });
    const fixture = read('hub-index.v2.complete.json');
    expect(new Set(Object.values(fixture.assets).map((asset) => asset.kind))).toEqual(
      new Set(['assistant', 'engineAdapter', 'skill', 'mcp'])
    );
    expect(Object.values(fixture.packages).every((entry) => entry.atomic && entry.assetIds.length === 1)).toBe(true);
  });

  it('跨仓库夹具固定新包身份、依赖和源码路径', () => {
    expect(validateCrossRepositoryFixture()).toEqual({ packageCount: 2, assetCount: 2 });
    const fixture = read('hub-index.v2.cross-repository.json');
    const engineId = 'tjuaeasset-contract-engine/engineAdapter/contract-acp';
    const skillId = 'tjuaeasset-contract-skill/skill/contract-helper';
    expect(fixture.assets[engineId]).toMatchObject({
      id: engineId,
      runtimeId: 'contract-acp',
      entryFile: 'engine-adapter.json',
      dependencies: [skillId],
    });
    expect(fixture.packages['tjuaeasset-contract-engine']).toMatchObject({
      sourcePath: 'assets/tjuaeasset-contract-engine',
      manifestPath: 'assets/tjuaeasset-contract-engine/asset-package.json',
      dependencies: { 'tjuaeasset-contract-skill': '^1.4.0' },
    });
  });

  it('拒绝旧前缀、旧目录和旧清单路径', () => {
    const validate = createIndexValidator();
    const fixture = read('hub-index.v2.cross-repository.json');
    fixture.packages['tjuaeasset-contract-engine'].sourcePath = 'legacy/tjuaeasset-contract-engine';
    expect(validate(fixture)).toBe(false);
    const oldManifest = read('hub-index.v2.cross-repository.json');
    oldManifest.packages['tjuaeasset-contract-engine'].manifestPath =
      'assets/tjuaeasset-contract-engine/legacy-package.json';
    expect(validate(oldManifest)).toBe(false);
  });

  it('拒绝不存在、自引用和循环依赖', () => {
    const missing = read('hub-index.v2.complete.json');
    missing.assets['tjuaeasset-community-assistant/assistant/community-assistant'].dependencies = [
      'tjuaeasset-missing/skill/missing',
    ];
    expect(() => validateIndexContract(missing)).toThrow('不存在');

    const cycle = read('hub-index.v2.complete.json');
    cycle.assets['tjuaeasset-community-skill/skill/community-skill'].dependencies = [
      'tjuaeasset-community-assistant/assistant/community-assistant',
    ];
    expect(() => validateIndexContract(cycle)).toThrow('依赖环');
  });

  it.each(['0.0.0', '1.2.3', '1.2.3-alpha.1', '1.2.3+build.01', '1.2.3-rc.1+build.5'])(
    '接受 Core 兼容 SemVer %s',
    (version) => {
      const validate = createIndexValidator();
      const fixture = read('hub-index.v2.complete.json');
      fixture.packages['tjuaeasset-community-engine'].version = version;
      fixture.assets['tjuaeasset-community-engine/engineAdapter/community-acp'].version = version;
      expect(validate(fixture), JSON.stringify(validate.errors)).toBe(true);
    }
  );

  it.each(['01.2.3', '1.02.3', '1.2.03', '1.2.3-01', '1.2', '1.2.3-', '1.2.3+'])('拒绝非规范 SemVer %s', (version) => {
    const validate = createIndexValidator();
    const fixture = read('hub-index.v2.complete.json');
    fixture.packages['tjuaeasset-community-engine'].version = version;
    expect(validate(fixture)).toBe(false);
  });
});
