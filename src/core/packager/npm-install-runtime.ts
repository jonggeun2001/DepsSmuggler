import type { NpmInstallPlan } from './npm-install-plan';

/**
 * Self-contained Node program embedded in both installers. The base64 payload
 * keeps package names and portable paths out of shell syntax and PS5 encoding.
 * Returns the physical npm prefix as base64 so native stdout also survives PS5.
 * npm local overrides require the prefix and file specs to use matching realpaths.
 */
export function buildNpmProjectSetupScript(plan: NpmInstallPlan): string {
  const payload = Buffer.from(JSON.stringify(plan), 'utf8').toString('base64');
  const script = [
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    "const plan = JSON.parse(Buffer.from('" + payload + "', 'base64').toString('utf8'));",
    'const scriptDir = fs.realpathSync(process.argv[2]);',
    'const packageDir = fs.realpathSync(path.resolve(scriptDir, process.argv[3]));',
    "if (!plan.packages.length || !plan.roots.length) throw new Error('설치할 npm tarball이 없습니다.');",
    'const entries = new Map();',
    'for (const pkg of plan.packages) {',
    '  const archive = fs.realpathSync(path.resolve(packageDir, pkg.relativePath));',
    '  const relative = path.relative(packageDir, archive);',
    "  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {",
    "    throw new Error('npm 패키지 디렉터리 밖의 경로입니다: ' + pkg.relativePath);",
    '  }',
    "  if (!fs.statSync(archive).isFile()) throw new Error('npm tarball이 일반 파일이 아닙니다: ' + archive);",
    "  const spec = 'file:' + archive.replace(/\\\\/g, '/');",
    "  entries.set(pkg.name + '@' + pkg.version, { name: pkg.name, spec });",
    '}',
    'const dependencies = Object.create(null);',
    'const overrides = Object.create(null);',
    'for (const key of plan.roots) {',
    '  const pkg = entries.get(key);',
    '  dependencies[pkg.name] = pkg.spec;',
    '}',
    'const ruleObjects = [];',
    'for (const rule of plan.rules) {',
    '  const pkg = entries.get(rule.packageKey);',
    '  const node = Object.create(null);',
    "  node['.'] = rule.parent === null ? '$' + rule.name : pkg.spec;",
    '  if (rule.parent === null) overrides[rule.name] = node;',
    '  else ruleObjects[rule.parent][rule.name] = node;',
    '  ruleObjects.push(node);',
    '}',
    "const target = path.join(scriptDir, 'npm-project');",
    "const manifestPath = path.join(target, 'package.json');",
    'if (fs.existsSync(target)) {',
    '  if (!fs.lstatSync(target).isDirectory()) {',
    "    throw new Error('npm-project는 일반 디렉터리여야 합니다.');",
    '  }',
    '  if (fs.readdirSync(target).length) {',
    '    const owned = fs.existsSync(manifestPath) && !fs.lstatSync(manifestPath).isSymbolicLink() &&',
    "      JSON.parse(fs.readFileSync(manifestPath, 'utf8')).depssmugglerOfflineBundle === 1;",
    "    if (!owned) throw new Error('npm-project에 기존 사용자 프로젝트가 있습니다. 다른 폴더에 압축을 풀어 설치하세요.');",
    '  }',
    '}',
    'fs.mkdirSync(target, { recursive: true });',
    'fs.writeFileSync(manifestPath, JSON.stringify({',
    "  name: 'depssmuggler-offline-bundle',",
    '  private: true,',
    '  depssmugglerOfflineBundle: 1,',
    '  dependencies,',
    '  overrides,',
    "}, null, 2) + '\\n');",
    "process.stdout.write(Buffer.from(target, 'utf8').toString('base64'));",
  ].join('\n');
  return script.replace(/[\u0080-\uFFFF]/g, character =>
    '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0'),
  );
}
