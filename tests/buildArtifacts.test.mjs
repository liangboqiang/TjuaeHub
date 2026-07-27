import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { validateBuild, validateIndexShape } = require('../scripts/quality/check-build');

describe('扩展构建产物', () => {
  it('保持生成索引与全部归档一致', async () => {
    await expect(validateBuild()).resolves.toEqual({ extensionCount: 7 });
  });

  it('拒绝已过时的索引契约', () => {
    expect(() =>
      validateIndexShape({
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        metadata: {},
      })
    ).toThrow('schemaVersion 2');
  });

  it('只发布干净且扁平的 dist 载荷', async () => {
    const workflow = await readFile('.github/workflows/build-extensions.yml', 'utf8');

    expect(workflow).toContain('DIST_TMP=$(mktemp -d)');
    expect(workflow).toContain('cp dist/*.zip dist/index.json "${DIST_TMP}/"');
    expect(workflow).toContain('git clean -ffdx');
    expect(workflow).toContain('cp "${DIST_TMP}/"*.zip "${DIST_TMP}/index.json" .');
    expect(workflow).not.toContain('cp -r dist');
  });
});
