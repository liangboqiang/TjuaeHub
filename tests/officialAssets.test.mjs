import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const { validateOfficialAssets } = require('../scripts/quality/check-official-assets');

const repositoryRoot = path.resolve(import.meta.dirname, '..');

describe('四类官方资产', () => {
  it('官方集合逐项审计并完整覆盖四类离线种子', () => {
    expect(validateOfficialAssets()).toEqual({
      packageCount: 17,
      counts: { assistant: 9, engineAdapter: 1, skill: 6, mcp: 1 },
    });
  });

  it('助手只引用 Hub 远程技能 ID，不携带 Overlay 或旧头像', () => {
    const assistantDirectories = fs
      .readdirSync(path.join(repositoryRoot, 'assets'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('tjuaeasset-assistant-'));
    expect(assistantDirectories.length).toBe(9);
    for (const entry of assistantDirectories) {
      const definition = JSON.parse(
        fs.readFileSync(path.join(repositoryRoot, 'assets', entry.name, 'assistant.json'), 'utf8')
      );
      for (const dependency of definition.skillDependencies) {
        expect(dependency).toMatch(/^tjuaeasset-skill-[a-z0-9-]+\/skill\/[a-z0-9-]+$/u);
      }
      const serialized = JSON.stringify(definition);
      expect(serialized).not.toMatch(/overlay|builtin-skills|\.jpg|\.png/u);
    }
  });

  it('官方身份来自 trust/provenance 策略而非包名自报', () => {
    const trust = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'policies/trust-policy.v1.json'), 'utf8'));
    const provenance = JSON.parse(
      fs.readFileSync(path.join(repositoryRoot, 'policies/official-asset-provenance.v1.json'), 'utf8')
    );
    expect(provenance.packages.map((entry) => entry.packageName)).toEqual(trust.officialPackages);
    expect(trust.officialPackages).toContain('tjuaeasset-codex');
    expect(trust.officialPackages).toContain('tjuaeasset-mcp-everything');
  });
});
