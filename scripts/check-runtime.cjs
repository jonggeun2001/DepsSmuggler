const satisfies = require('semver/functions/satisfies');
const metadata = require('../package.json');

try {
  if (!satisfies(process.versions.node, metadata.engines.node)) {
    throw new Error(
      `지원하지 않는 Node.js ${process.versions.node}입니다. 보안 패치가 포함된 ${metadata.engines.node}를 사용하세요.`
    );
  }

  if (process.argv.includes('--electron')) {
    const installed = require('electron/package.json').version;
    const expected = require('../package-lock.json').packages['node_modules/electron'].version;
    if (installed !== expected) {
      throw new Error(
        `설치된 Electron ${installed}가 lockfile의 ${expected}와 다릅니다. 지원되는 Node에서 npm ci를 실행하세요.`
      );
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
