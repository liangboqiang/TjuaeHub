const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { buildOfficialAssistants } = require('../../scripts/build-assistants');
const { buildOfficialSkills } = require('../../scripts/build-skills');

function resolveSourceRevision(repositoryRoot) {
  const configured = process.env.TJUAE_SOURCE_REVISION?.trim();
  const revision =
    configured || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }).trim();
  if (!/^[0-9a-f]{40}$/u.test(revision)) throw new Error(`无效的源修订号：${revision}`);
  return revision;
}

async function buildRepository({ repositoryRoot, sourceRevision = resolveSourceRevision(repositoryRoot) }) {
  const distDirectory = path.join(repositoryRoot, 'dist');
  fs.rmSync(distDirectory, { recursive: true, force: true });
  fs.mkdirSync(distDirectory, { recursive: true });
  const [skills, assistants] = await Promise.all([
    buildOfficialSkills({ repositoryRoot, distDirectory, sourceRevision }),
    buildOfficialAssistants({ repositoryRoot, distDirectory, sourceRevision }),
  ]);
  return { ...skills, ...assistants };
}

async function main() {
  const repositoryRoot = path.resolve(__dirname, '..', '..');
  const result = await buildRepository({ repositoryRoot });
  console.log(`已生成 ${result.skillCount} 个技能和 ${result.assistantCount} 个助手的静态市场索引。`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { buildRepository, resolveSourceRevision };
