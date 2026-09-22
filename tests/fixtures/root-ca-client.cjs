const path = require('node:path');
const tls = require('node:tls');
if (process.env.DEPS_TEST_LEGACY_CA === '1') tls.setDefaultCACertificates = undefined;
require('ts-node').register({ project: path.resolve('tsconfig.cli.json'), transpileOnly: true });
const { initializeCliRootCa } = require('../../src/cli/root-ca-bootstrap');
const { initializeRootCaTrust, getRootCaStatus } = require('../../src/core/root-ca-trust');
const https = require('node:https');
(async () => {
  if (process.env.DEPS_TEST_DESKTOP_CA === '1') initializeRootCaTrust();
  else if (!(await initializeCliRootCa())) return;
  const response = await fetch(process.env.DEPS_TEST_CA_URL);
  await response.text();
  await new Promise((resolve, reject) => {
    https
      .get(process.env.DEPS_TEST_CA_URL, (response) => {
        response.resume();
        response.on('end', resolve);
      })
      .on('error', reject);
  });
  console.log(
    JSON.stringify({
      success: true,
      status: getRootCaStatus(),
      defaultCount: tls.getCACertificates?.('default').length,
      bundledCount: tls.rootCertificates.length,
    })
  );
})().catch((error) => {
  console.error(error.code || error.cause?.code || error.message);
  process.exitCode = 1;
});
