import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { gunzipSync } from 'node:zlib';
import * as tar from 'tar';
import { afterEach, describe, expect, it } from 'vitest';

const execFile = promisify(execFileCallback);
const projectRoot = process.cwd();
const isolateHomeScript = path.join(projectRoot, 'tests/fixtures/isolate-home.cjs');
const nativeEnabled = process.env.DEPS_SMUGGLER_NATIVE_APK === '1';
const nativeSuite = nativeEnabled ? describe : describe.skip;

type ApkRecord = Record<string, string>;

function runCli(
  userDirectory: string,
  outputDirectory: string
): Promise<{ stdout: string; stderr: string }> {
  const harness = `
const path = require('node:path');
require(path.join(process.env.DEPS_SMUGGLER_PROJECT_ROOT, 'node_modules/ts-node')).register({
  project: path.join(process.env.DEPS_SMUGGLER_PROJECT_ROOT, 'tsconfig.cli.json'),
});
process.argv = [process.execPath, path.join(process.env.DEPS_SMUGGLER_PROJECT_ROOT, 'src/cli/index.ts'), ...JSON.parse(process.env.DEPS_SMUGGLER_APK_ARGS)];
require(path.join(process.env.DEPS_SMUGGLER_PROJECT_ROOT, 'src/cli/index.ts'));
`;
  return execFile(process.execPath, ['-e', harness], {
    cwd: projectRoot,
    env: {
      ...process.env,
      DEPS_SMUGGLER_PROJECT_ROOT: projectRoot,
      DEPS_SMUGGLER_APK_ARGS: JSON.stringify([
        'os',
        'download',
        'zlib',
        '--distro',
        'alpine-3.20',
        '--arch',
        'x86_64',
        '--format',
        'repository',
        '--output',
        outputDirectory,
        '--concurrency',
        '1',
      ]),
      DEPS_SMUGGLER_TEST_USER_DIR: userDirectory,
      NODE_OPTIONS: `--require ${JSON.stringify(isolateHomeScript)}`,
    },
    maxBuffer: 4 * 1024 * 1024,
    timeout: 240_000,
  });
}

function parseIndex(content: string): ApkRecord[] {
  return content
    .trim()
    .split(/\n\n+/)
    .filter(Boolean)
    .map((record) => {
      const fields: ApkRecord = {};
      for (const line of record.split('\n')) {
        const separator = line.indexOf(':');
        if (separator > 0) fields[line.slice(0, separator)] = line.slice(separator + 1);
      }
      return fields;
    });
}

async function readIndex(indexPath: string): Promise<{ entries: string[]; records: ApkRecord[] }> {
  const payload = gunzipSync(await fs.promises.readFile(indexPath));
  const entries: string[] = [];
  let indexContent = '';
  await new Promise<void>((resolve, reject) => {
    const stream = tar.t({
      onReadEntry: (entry) => {
        entries.push(entry.path);
        const chunks: Buffer[] = [];
        entry.on('data', (chunk: Buffer) => chunks.push(chunk));
        entry.on('end', () => {
          if (entry.path === 'APKINDEX') indexContent = Buffer.concat(chunks).toString('utf8');
        });
      },
    });
    stream.on('error', reject);
    stream.on('end', resolve);
    stream.end(payload);
  });
  return { entries, records: parseIndex(indexContent) };
}

function hashTree(root: string): string {
  const hash = createHash('sha256');
  const walk = (directory: string, relative = ''): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryRelative = path.join(relative, entry.name);
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(entryPath, entryRelative);
      else {
        hash.update(entryRelative);
        hash.update(fs.readFileSync(entryPath));
      }
    }
  };
  walk(root);
  return hash.digest('hex');
}

async function requireDocker(): Promise<void> {
  if (process.platform !== 'linux') {
    throw new Error('DEPS_SMUGGLER_NATIVE_APK=1 requires Linux with Docker');
  }
  try {
    await execFile('docker', ['version', '--format', '{{.Server.Version}}'], { timeout: 20_000 });
    await execFile('docker', ['pull', 'alpine:3.20'], {
      timeout: 300_000,
      maxBuffer: 2 * 1024 * 1024,
    });
  } catch (error) {
    throw new Error(
      `DEPS_SMUGGLER_NATIVE_APK=1 requires a usable alpine:3.20 Docker image: ${(error as Error).message}`
    );
  }
}

async function buildHttpdImage(contextDirectory: string, imageTag: string): Promise<void> {
  await fs.promises.writeFile(
    path.join(contextDirectory, 'Dockerfile'),
    'FROM alpine:3.20\nRUN apk add --no-cache busybox-extras \\\n && /bin/busybox-extras --list | grep -Fx httpd\n'
  );
  await execFile('docker', ['build', '--pull=false', '--tag', imageTag, contextDirectory], {
    timeout: 300_000,
    maxBuffer: 2 * 1024 * 1024,
  });
}

nativeSuite('native APK repository consumer', () => {
  const tempDirectories: string[] = [];
  const temporaryImages: string[] = [];

  afterEach(async () => {
    for (const imageTag of temporaryImages.splice(0)) {
      await execFile('docker', ['image', 'rm', '--force', imageTag], {
        timeout: 30_000,
      }).catch(() => undefined);
    }
    for (const directory of tempDirectories.splice(0)) {
      await fs.promises.rm(directory, { recursive: true, force: true });
    }
  });

  it('updates and searches a generated repository through isolated apk-tools', async () => {
    await requireDocker();
    const tempDirectory = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'depssmuggler-native-apk-')
    );
    tempDirectories.push(tempDirectory);
    const imageTag = `depssmuggler-native-apk-httpd-${process.pid}-${Date.now()}`.toLowerCase();
    temporaryImages.push(imageTag);
    const imageContext = path.join(tempDirectory, 'image-context');
    await fs.promises.mkdir(imageContext, { recursive: true });
    await buildHttpdImage(imageContext, imageTag);
    const userDirectory = path.join(tempDirectory, 'user');
    const repositoryDirectory = path.join(tempDirectory, 'repository with spaces');
    await fs.promises.mkdir(userDirectory, { recursive: true });

    const cliResult = await runCli(userDirectory, repositoryDirectory);
    expect(cliResult.stderr).not.toContain('오류');
    const indexPath = path.join(repositoryDirectory, 'APKINDEX.tar.gz');
    expect(await fs.promises.stat(indexPath)).toBeTruthy();
    const packageFiles = (await fs.promises.readdir(repositoryDirectory)).filter((name) =>
      name.endsWith('.apk')
    );
    expect(packageFiles.length).toBeGreaterThanOrEqual(2);

    const index = await readIndex(indexPath);
    expect(index.entries).toEqual(['APKINDEX']);
    expect(index.records.length).toBeGreaterThanOrEqual(2);
    const records = index.records.map((record) => {
      for (const field of ['P', 'V', 'A', 'C', 'S', 'I']) {
        expect(record[field], `${field} missing from ${record.P ?? 'unknown'}`).toBeDefined();
      }
      expect(record.C).toMatch(/^Q1[A-Za-z0-9+/]+={0,2}$/);
      expect(Number(record.S)).toBeGreaterThan(0);
      expect(Number.isSafeInteger(Number(record.I))).toBe(true);
      expect(Number(record.I)).toBeGreaterThanOrEqual(0);
      return record;
    });
    expect(new Set(records.map((record) => record.C)).size).toBeGreaterThanOrEqual(2);
    for (const record of records) {
      expect(packageFiles).toContain(`${record.P}-${record.V}.apk`);
    }

    const repositoryDigestBefore = hashTree(repositoryDirectory);
    const dockerScript = [
      'set -eu',
      'mkdir -p /serve /tmp/apk-root',
      'ln -s /repo /serve/x86_64',
      "printf '%s\\n' 'http://127.0.0.1:8080' >/tmp/repositories",
      '/bin/busybox-extras httpd -f -p 127.0.0.1:8080 -h /serve >/tmp/httpd.log 2>&1 &',
      'httpd_pid=$!',
      "trap 'kill $httpd_pid 2>/dev/null || true' EXIT",
      'sleep 1',
      'apk --version',
      'apk --root /tmp/apk-root --repositories-file /dev/null --no-network add --initdb',
      'if apk --verbose --root /tmp/apk-root --repositories-file /tmp/repositories --allow-untrusted update >/tmp/apk-update.log 2>&1; then',
      '  cat /tmp/apk-update.log',
      'else',
      '  cat /tmp/apk-update.log',
      '  exit 1',
      'fi',
      "grep -F '/x86_64/APKINDEX.tar.gz' /tmp/apk-update.log",
      'for package_name in "$@"; do',
      '  apk --root /tmp/apk-root --repositories-file /tmp/repositories --allow-untrusted search --exact "$package_name"',
      'done',
    ].join('\n');
    const dockerResult = await execFile(
      'docker',
      [
        'run',
        '--rm',
        '--network',
        'none',
        '-v',
        `${repositoryDirectory}:/repo:ro`,
        imageTag,
        'sh',
        '-eu',
        '-c',
        dockerScript,
        'apk-native-consumer',
        ...records.map((record) => record.P),
      ],
      { timeout: 180_000, maxBuffer: 4 * 1024 * 1024 }
    );
    expect(dockerResult.stdout).toContain('apk-tools');
    const dockerLines = dockerResult.stdout.split(/\r?\n/);
    console.info(dockerLines.find((line) => line.includes('apk-tools')));
    for (const record of records) expect(dockerLines).toContain(`${record.P}-${record.V}`);
    expect(hashTree(repositoryDirectory)).toBe(repositoryDigestBefore);
  }, 600_000);
});
