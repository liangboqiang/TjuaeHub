const path = require('node:path');

const { validateOfficialAssistants } = require('../build-assistants');

const REPOSITORY_ROOT = path.resolve(__dirname, '..', '..');

function main() {
  const assistants = validateOfficialAssistants(REPOSITORY_ROOT);
  console.log(`已验证 ${assistants.length} 个 TjuaeHub 官方助手。`);
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
