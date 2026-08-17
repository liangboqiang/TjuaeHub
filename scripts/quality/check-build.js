const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { resolveSourceRevision } = require('../../.github/scripts/build-assets');
const { buildOfficialSkills } = require('../build-skills');

async function main() {
  const repositoryRoot = path.resolve(__dirname, '..', '..');
  const sourceRevision = resolveSourceRevision(repositoryRoot);
  const current = fs.readFileSync(path.join(repositoryRoot, 'dist', 'skills.json'));
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tjuae-hub-build-'));
  try {
    await buildOfficialSkills({ repositoryRoot, distDirectory: temporaryRoot, sourceRevision });
    const rebuilt = fs.readFileSync(path.join(temporaryRoot, 'skills.json'));
    if (!current.equals(rebuilt)) throw new Error('dist/skills.json 不是当前源目录的确定性构建结果');
    const files = fs.readdirSync(path.join(repositoryRoot, 'dist'));
    if (files.length !== 1 || files[0] !== 'skills.json') throw new Error('dist 只能包含 skills.json');
    console.log('技能市场构建产物已通过确定性检查。');
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { main };
