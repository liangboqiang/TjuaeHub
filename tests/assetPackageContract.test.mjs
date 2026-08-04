import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const {
  PACKAGE_MANIFEST_FILENAME,
  PACKAGE_PREFIX,
  PACKAGE_SCHEMA_URL,
  createDefinitionValidators,
  createPackageValidator,
  isSafeRelativePath,
  validateAssetPackages,
  validateRepositoryStructure,
} = require('../scripts/quality/check-assets');

const repositoryRoot = path.resolve(import.meta.dirname, '..');

describe('原子资产包契约', () => {
  it('只接受 assets/submissions 下的新包身份与清单', () => {
    expect(PACKAGE_PREFIX).toBe('tjuaeasset-');
    expect(PACKAGE_MANIFEST_FILENAME).toBe('asset-package.json');
    expect(PACKAGE_SCHEMA_URL).toContain('/asset-package.v1.schema.json');
    expect(validateAssetPackages()).toEqual({ publishedCount: 23, submissionCount: 7 });
  });

  it('每个包只声明一个四类 typed asset，且没有扩展钩子', () => {
    const validate = createPackageValidator();
    for (const group of ['assets', 'submissions']) {
      for (const entry of fs.readdirSync(path.join(repositoryRoot, group), { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const manifest = JSON.parse(
          fs.readFileSync(path.join(repositoryRoot, group, entry.name, PACKAGE_MANIFEST_FILENAME), 'utf8')
        );
        expect(validate(manifest), JSON.stringify(validate.errors)).toBe(true);
        expect(manifest.assets).toHaveLength(1);
        expect(['assistant', 'engineAdapter', 'skill', 'mcp']).toContain(manifest.assets[0].kind);
        expect(JSON.stringify(manifest)).not.toMatch(/contributions|lifecycle|onInstall|onActivate/u);
      }
    }
  });

  it('旧包字段和任意执行入口无法通过模式', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(repositoryRoot, 'assets', 'tjuaeasset-codex', PACKAGE_MANIFEST_FILENAME), 'utf8')
    );
    const validate = createPackageValidator();
    for (const [field, value] of [
      ['contributions', {}],
      ['hooks', { install: 'scripts/install.js' }],
      ['lifecycle', { onActivate: 'scripts/activate.js' }],
      ['commands', ['install']],
    ]) {
      const candidate = structuredClone(manifest);
      candidate[field] = value;
      expect(validate(candidate), `${field} must be rejected`).toBe(false);
    }
  });

  it('Definition 配置字段必须显式绑定，且 transport 约束目标', () => {
    const validators = createDefinitionValidators();
    const engine = JSON.parse(
      fs.readFileSync(path.join(repositoryRoot, 'tests/fixtures/engine-adapter-definition.v1.complete.json'), 'utf8')
    );
    expect(validators.engineAdapter(engine), JSON.stringify(validators.engineAdapter.errors)).toBe(true);
    const missing = structuredClone(engine);
    delete missing.configurationSchema.fields[0].binding;
    expect(validators.engineAdapter(missing)).toBe(false);
    const wrongEngineTarget = structuredClone(engine);
    wrongEngineTarget.configurationSchema.fields[0].binding.target = 'header';
    expect(validators.engineAdapter(wrongEngineTarget)).toBe(false);

    const mcp = JSON.parse(
      fs.readFileSync(path.join(repositoryRoot, 'tests/fixtures/mcp-definition.v1.complete.json'), 'utf8')
    );
    expect(validators.mcp(mcp), JSON.stringify(validators.mcp.errors)).toBe(true);
    const wrongMcpTarget = structuredClone(mcp);
    wrongMcpTarget.configurationSchema.fields[0].binding.target = 'header';
    expect(validators.mcp(wrongMcpTarget)).toBe(false);
  });

  it('拒绝不安全路径和两目录重名包', () => {
    expect(isSafeRelativePath('assistant.json')).toBe(true);
    for (const unsafe of ['../assistant.json', '/assistant.json', 'C:/assistant.json', 'nested\\assistant.json']) {
      expect(isSafeRelativePath(unsafe)).toBe(false);
    }
    expect(() =>
      validateRepositoryStructure(
        ['assets/tjuaeasset-duplicate/asset-package.json'],
        ['submissions/tjuaeasset-duplicate/asset-package.json']
      )
    ).toThrow('不能同时位于');
  });
});
