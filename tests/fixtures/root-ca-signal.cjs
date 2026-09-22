const path = require('node:path');
require('ts-node').register({ project: path.resolve('tsconfig.cli.json'), transpileOnly: true });
const { initializeCliRootCa } = require('../../src/cli/root-ca-bootstrap');
(async () => {
  if (!(await initializeCliRootCa())) return;
  console.log(JSON.stringify({ pid: process.pid, bundle: process.env.NODE_EXTRA_CA_CERTS }));
  setInterval(() => {}, 1000);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
