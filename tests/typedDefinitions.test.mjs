import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const {
  createDefinitionValidators,
  validateAssetPackages,
  validatePortableDefinitionSafety,
} = require('../scripts/quality/check-assets');

const repositoryRoot = path.resolve(import.meta.dirname, '..');

function readFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'tests', 'fixtures', name), 'utf8'));
}

describe('四类 typed Definition', () => {
  it('完整引擎与 MCP 夹具通过共享模式并显式声明绑定', () => {
    const validators = createDefinitionValidators();
    const engine = readFixture('engine-adapter-definition.v1.complete.json');
    const mcp = readFixture('mcp-definition.v1.complete.json');
    expect(validators.engineAdapter(engine), JSON.stringify(validators.engineAdapter.errors)).toBe(true);
    expect(validators.mcp(mcp), JSON.stringify(validators.mcp.errors)).toBe(true);
    expect(engine.configurationSchema.fields.every((field) => field.binding.target === 'environment')).toBe(true);
    expect(mcp.configurationSchema.fields.every((field) => field.binding.target === 'environment')).toBe(true);
    expect(engine.configurationSchema.fields.some((field) => !field.secret)).toBe(true);
    expect(engine.configurationSchema.fields.some((field) => field.secret)).toBe(true);
  });

  it('官方 Codex 同时示范公开值与私密值的纯环境绑定', () => {
    const definition = JSON.parse(
      fs.readFileSync(path.join(repositoryRoot, 'assets/tjuaeasset-codex/engine-adapter.json'), 'utf8')
    );
    const fields = Object.fromEntries(definition.configurationSchema.fields.map((field) => [field.key, field]));
    expect(fields.apiBaseUrl).toMatchObject({
      secret: false,
      binding: { target: 'environment', name: 'OPENAI_BASE_URL' },
    });
    expect(fields.apiKey).toMatchObject({ secret: true, binding: { target: 'environment', name: 'OPENAI_API_KEY' } });
    expect(JSON.stringify(definition)).not.toContain('sk-');
  });

  it('引擎适配器只连接用户已安装命令，拒绝市场安装元数据', () => {
    const validators = createDefinitionValidators();
    const engine = readFixture('engine-adapter-definition.v1.complete.json');
    engine.runtime.package = {
      ecosystem: 'npm',
      name: '@openai/codex',
      version: '0.144.6',
      runner: 'npx',
    };
    expect(validators.engineAdapter(engine)).toBe(false);
  });

  it('所有已发布和待审 Definition 都通过唯一入口和 portable 安全门禁', () => {
    expect(validateAssetPackages()).toEqual({ publishedCount: 23, submissionCount: 7 });
  });

  it('拒绝 Definition 中的运行时值和私有端点', () => {
    for (const value of [
      { headers: { Authorization: 'secret' } },
      { environment: { TOKEN: 'secret' } },
      { endpoint: 'http://localhost:9000' },
      { executablePath: '/usr/local/bin/private' },
    ]) {
      expect(() => validatePortableDefinitionSafety(value, 'fixture')).toThrow();
    }
  });
});
