import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const workflow = fs.readFileSync(path.join(repositoryRoot, '.github/workflows/build-assets.yml'), 'utf8');

describe('原子资产发布工作流', () => {
  it('PR 只读验证，main 才能发布 dist', () => {
    expect(workflow).toContain('pull_request:');
    expect(workflow).toContain('permissions:\n      contents: read');
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).toContain('needs: verify');
    expect(workflow).toContain('contents: write');
  });

  it('监控新目录并使用冻结依赖与统一 verify', () => {
    expect(workflow).toContain("- 'assets/**'");
    expect(workflow).toContain("- 'submissions/**'");
    expect(workflow).toContain('bun install --frozen-lockfile');
    expect(workflow.match(/bun run verify/gu)).toHaveLength(2);
  });

  it('发布分支只携带扁平 dist 载荷', () => {
    expect(workflow).toContain('DIST_TMP=$(mktemp -d)');
    expect(workflow).toContain('cp dist/*.zip dist/index.json dist/seed-manifest.json');
    expect(workflow).toContain('git clean -ffdx');
  });
});
