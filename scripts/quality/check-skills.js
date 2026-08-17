const path = require('node:path');

const { validateOfficialSkills } = require('../build-skills');

const REPOSITORY_ROOT = path.resolve(__dirname, '..', '..');

function main() {
  const skills = validateOfficialSkills(REPOSITORY_ROOT);
  console.log(`已验证 ${skills.length} 个 TjuaeHub 官方技能。`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

module.exports = { main };
