const path = require('path');

const projectRoot = path.resolve(__dirname, '..');

require('ts-node').register({
  project: path.join(projectRoot, 'tsconfig.cli.json'),
});

require(path.join(projectRoot, 'src/cli/index.ts'));
