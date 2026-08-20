const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { resolveSourceRevision } = require('../../.github/scripts/build-assets');
const { buildOfficialAssistants } = require('../build-assistants');
const { buildOfficialSkills } = require('../build-skills');

async function main() {
  const repositoryRoot = path.resolve(__dirname, '..', '..');
  const sourceRevision = resolveSourceRevision(repositoryRoot);
  const currentSkills = fs.readFileSync(path.join(repositoryRoot, 'dist', 'skills.json'));
  const currentAssistants = fs.readFileSync(path.join(repositoryRoot, 'dist', 'assistants.json'));
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tjuae-hub-build-'));
  try {
    await Promise.all([
      buildOfficialSkills({ repositoryRoot, distDirectory: temporaryRoot, sourceRevision }),
      buildOfficialAssistants({ repositoryRoot, distDirectory: temporaryRoot, sourceRevision }),
    ]);
    const rebuiltSkills = fs.readFileSync(path.join(temporaryRoot, 'skills.json'));
    const rebuiltAssistants = fs.readFileSync(path.join(temporaryRoot, 'assistants.json'));
    if (!currentSkills.equals(rebuiltSkills)) throw new Error('dist/skills.json 不是当前源目录的确定性构建结果');
    if (!currentAssistants.equals(rebuiltAssistants)) {
      throw new Error('dist/assistants.json 不是当前源目录的确定性构建结果');
    }
    const files = fs.readdirSync(path.join(repositoryRoot, 'dist')).sort();
    if (files.join(',') !== 'assistants.json,skills.json') {
      throw new Error('dist 只能包含 assistants.json 与 skills.json');
    }
    console.log('技能和助手市场构建产物已通过确定性检查。');
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
