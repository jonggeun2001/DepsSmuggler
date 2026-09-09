const os = require('node:os');
const { syncBuiltinESMExports } = require('node:module');

const target = process.env.DEPS_SMUGGLER_TEST_USER_DIR;
if (!target) {
  throw new Error('DEPS_SMUGGLER_TEST_USER_DIR is required');
}

os.homedir = () => target;
syncBuiltinESMExports();
