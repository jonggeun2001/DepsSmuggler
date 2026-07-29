# CLI Download Environment Options Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `depssmuggler download`에서 대상 OS, 아키텍처, Python/CUDA 버전, Conda 채널과 Maven classifier를 검증하고 의존성 해결부터 실제 아티팩트 다운로드까지 일관되게 적용한다.

**Architecture:** CLI 환경 옵션의 런타임 검증과 비기본값 판별을 작은 전용 모듈로 분리한다. `downloadCommand`는 검증된 값을 공용 dependency resolver에 전달하고, resolver는 기존 요청 패키지에 실제 선택된 root 메타데이터를 병합한다. 각 downloader는 resolver가 선택한 URL 또는 classifier를 우선 사용하고 기존 조회 로직은 폴백으로 유지한다.

**Tech Stack:** TypeScript, Commander, Node.js, Vitest, Electron 공용 core modules

---

## File structure

- Create `src/cli/commands/download-environment.ts`: CLI 대상 환경 값, 유효성 검증, `--no-deps` 루트 해결 필요 여부를 담당한다.
- Create `src/cli/commands/download-environment.test.ts`: 값 및 패키지 타입별 검증 계약을 테스트한다.
- Modify `src/cli/index.ts`: 새 Commander 옵션을 공개한다.
- Modify `src/cli/commands/download.ts`: 환경 옵션을 패키지와 resolver로 전달하고 깊이 0 루트 해결 결과를 큐에 반영한다.
- Modify `src/cli/commands/download.test.ts`: resolver 전달, classifier, `--no-deps` 조건부 루트 해결을 테스트한다.
- Modify `src/core/shared/dependency-resolver.ts`: resolver가 선택한 root/flat package 정보를 기존 요청 항목에 병합한다.
- Modify `src/core/shared/dependency-resolver.test.ts`: 병합 우선순위와 Conda 선택 메타데이터 보존을 테스트한다.
- Modify `src/core/downloaders/pip.ts`: resolver가 제공한 URL과 체크섬을 우선 사용한다.
- Modify `src/core/downloaders/pip.test.ts`: 제공된 URL 사용과 메타데이터 재조회 생략을 테스트한다.
- Modify `src/core/resolver/pip-resolver.ts`: 선택한 PyPI/Simple API 파일 URL과 체크섬을 결과 메타데이터에 보존한다.
- Create `src/core/resolver/pip-resolver-download.test.ts`: resolver 선택 결과가 downloader까지 유지되는 통합 경로를 테스트한다.
- Modify `src/core/downloaders/conda.test.ts`: resolver URL 우선 사용 회귀 테스트를 추가한다.
- Modify `src/core/downloaders/maven-download.test.ts`: classifier가 실제 다운로드 호출에 전달되는지 assertion을 강화한다.
- Modify `docs/cli.md`: 새 옵션, 적용 범위, 검증과 예시를 문서화한다.
- Modify `README.md`: pip, conda, Maven 대상 환경 다운로드 예시를 추가한다.

### Task 1: CLI 환경 옵션 검증 모듈

**Files:**
- Create: `src/cli/commands/download-environment.ts`
- Create: `src/cli/commands/download-environment.test.ts`

- [ ] **Step 1: 잘못된 값과 타입별 조합에 대한 실패 테스트 작성**

```ts
describe('validateDownloadEnvironmentOptions', () => {
  it.each(['sparc', 'x64'])('지원하지 않는 아키텍처 %s를 거부한다', (arch) => {
    expect(() => validateDownloadEnvironmentOptions(base({ arch }))).toThrow(
      '지원하지 않는 아키텍처'
    );
  });

  it('pip가 아닌 타입의 Python 버전을 거부한다', () => {
    expect(() => validateDownloadEnvironmentOptions(
      base({ type: 'npm', pythonVersion: '3.12' })
    )).toThrow('Python 버전 옵션');
  });

  it.each(['', '3', '3.12.1', 'latest'])('Python 버전 형식 %s를 거부한다', (version) => {
    expect(() => validateDownloadEnvironmentOptions(
      base({ type: 'pip', pythonVersion: version })
    )).toThrow('major.minor');
  });

  it('conda가 아닌 타입의 CUDA 버전을 거부한다', () => {
    expect(() => validateDownloadEnvironmentOptions(
      base({ type: 'pip', cudaVersion: '12.4' })
    )).toThrow('CUDA 버전 옵션');
  });

  it('Maven이 아닌 타입의 classifier를 거부한다', () => {
    expect(() => validateDownloadEnvironmentOptions(
      base({ type: 'pip', classifier: 'natives-linux' })
    )).toThrow('classifier 옵션');
  });

  it('빈 Maven classifier를 거부한다', () => {
    expect(() => validateDownloadEnvironmentOptions(
      base({ type: 'maven', classifier: '' })
    )).toThrow('비어 있을 수 없습니다');
  });
});
```

- [ ] **Step 2: 검증 테스트를 실행해 모듈 부재로 실패하는지 확인**

Run: `npx vitest run src/cli/commands/download-environment.test.ts`

Expected: FAIL because `./download-environment` does not exist.

- [ ] **Step 3: 최소 타입과 검증 함수 구현**

```ts
const ARCHITECTURES = new Set<Architecture>([
  'x86_64', 'amd64', 'arm64', 'aarch64', 'i386',
  'i686', 'noarch', 'all', 'arm/v7', '386',
]);
const TARGET_OSES = new Set<TargetOS>(['any', 'linux', 'windows', 'macos']);
const MAJOR_MINOR_VERSION = /^\d+\.\d+$/;

export interface CliDownloadEnvironmentOptions {
  type: PackageType;
  arch: Architecture;
  targetOS: TargetOS;
  pythonVersion?: string;
  cudaVersion?: string;
  condaChannel: string;
  classifier?: string;
}

export function validateDownloadEnvironmentOptions(
  options: CliDownloadEnvironmentOptions
): void {
  if (!ARCHITECTURES.has(options.arch)) {
    throw new Error(`지원하지 않는 아키텍처: ${options.arch}`);
  }
  if (!TARGET_OSES.has(options.targetOS)) {
    throw new Error(`지원하지 않는 대상 OS: ${options.targetOS}`);
  }
  if (options.pythonVersion !== undefined) {
    if (options.type !== 'pip' && options.type !== 'conda') {
      throw new Error('Python 버전 옵션은 pip와 conda에서만 사용할 수 있습니다');
    }
    if (!MAJOR_MINOR_VERSION.test(options.pythonVersion)) {
      throw new Error('Python 버전은 major.minor 형식이어야 합니다');
    }
  }
  if (options.cudaVersion !== undefined) {
    if (options.type !== 'conda') {
      throw new Error('CUDA 버전 옵션은 conda에서만 사용할 수 있습니다');
    }
    if (!MAJOR_MINOR_VERSION.test(options.cudaVersion)) {
      throw new Error('CUDA 버전은 major.minor 형식이어야 합니다');
    }
  }
  if (options.classifier !== undefined) {
    if (options.type !== 'maven') {
      throw new Error('classifier 옵션은 maven에서만 사용할 수 있습니다');
    }
    if (options.classifier.trim().length === 0) {
      throw new Error('classifier는 비어 있을 수 없습니다');
    }
  }
  if (options.targetOS !== 'any' && !['pip', 'conda', 'maven'].includes(options.type)) {
    throw new Error('대상 OS 옵션은 pip, conda, maven에서만 사용할 수 있습니다');
  }
  if (options.condaChannel !== 'conda-forge' && options.type !== 'conda') {
    throw new Error('Conda 채널 옵션은 conda에서만 사용할 수 있습니다');
  }
}
```

- [ ] **Step 4: 비기본 환경 옵션 판별 테스트와 구현**

```ts
it('새 환경 옵션이 모두 기본값이면 false를 반환한다', () => {
  expect(hasExplicitTargetEnvironment(base())).toBe(false);
});

it.each([
  { targetOS: 'linux' },
  { pythonVersion: '3.12' },
  { cudaVersion: '12.4' },
  { condaChannel: 'defaults' },
  { classifier: 'natives-linux' },
])('비기본 환경 옵션 $targetOS$pythonVersion$cudaVersion$condaChannel$classifier를 감지한다', (override) => {
  expect(hasExplicitTargetEnvironment(base(override))).toBe(true);
});
```

```ts
export function hasExplicitTargetEnvironment(
  options: CliDownloadEnvironmentOptions
): boolean {
  return options.targetOS !== 'any'
    || options.pythonVersion !== undefined
    || options.cudaVersion !== undefined
    || options.condaChannel !== 'conda-forge'
    || options.classifier !== undefined;
}
```

- [ ] **Step 5: 검증 모듈 테스트 통과 확인**

Run: `npx vitest run src/cli/commands/download-environment.test.ts`

Expected: PASS.

- [ ] **Step 6: 커밋**

```bash
git add src/cli/commands/download-environment.ts src/cli/commands/download-environment.test.ts
git commit -m "feat: CLI 다운로드 환경 옵션 검증 추가"
```

### Task 2: Commander 옵션과 download command 전달

**Files:**
- Modify: `src/cli/index.ts`
- Modify: `src/cli/commands/download.ts`
- Modify: `src/cli/commands/download.test.ts`

- [ ] **Step 1: 환경 옵션 resolver 전달 실패 테스트 작성**

```ts
it('대상 환경 옵션을 의존성 resolver에 전달한다', async () => {
  await downloadCommand(commandOptions({
    type: 'conda',
    targetOS: 'linux',
    arch: 'aarch64',
    pythonVersion: '3.12',
    cudaVersion: '12.4',
    condaChannel: 'defaults',
  }));

  expect(resolveAllDependencies).toHaveBeenCalledWith(
    expect.any(Array),
    expect.objectContaining({
      architecture: 'aarch64',
      targetOS: 'linux',
      pythonVersion: '3.12',
      cudaVersion: '12.4',
      condaChannel: 'defaults',
      includeDependencies: true,
    })
  );
});
```

- [ ] **Step 2: `--no-deps` 조건부 루트 해결 실패 테스트 작성**

```ts
it('환경 옵션이 지정된 pip --no-deps는 깊이 0으로 루트만 해결한다', async () => {
  vi.mocked(resolveAllDependencies).mockResolvedValueOnce(resolvedPipRootWithMetadata);

  await downloadCommand(commandOptions({
    type: 'pip',
    deps: false,
    targetOS: 'linux',
    pythonVersion: '3.12',
  }));

  expect(resolveAllDependencies).toHaveBeenCalledWith(
    expect.any(Array),
    expect.objectContaining({ includeDependencies: true, maxDepth: 0 })
  );
  expect(addToQueue).toHaveBeenCalledWith([
    expect.objectContaining({
      name: 'requests',
      metadata: expect.objectContaining({ downloadUrl: expect.any(String) }),
    }),
  ]);
});

it('새 환경 옵션이 없는 --no-deps는 resolver를 호출하지 않는다', async () => {
  await downloadCommand(commandOptions({ deps: false }));
  expect(resolveAllDependencies).not.toHaveBeenCalled();
});
```

- [ ] **Step 3: 잘못된 환경 옵션이 부수 효과 전에 실패하는 테스트 작성**

```ts
it('잘못된 환경 옵션은 resolver, 큐, 출력 디렉터리 작업 전에 실패한다', async () => {
  const exitSpy = mockProcessExit();

  await expect(downloadCommand(commandOptions({
    type: 'npm',
    targetOS: 'linux',
  }))).rejects.toThrow('process.exit');

  expect(resolveAllDependencies).not.toHaveBeenCalled();
  expect(addToQueue).not.toHaveBeenCalled();
  expect(ensureDir).not.toHaveBeenCalled();
  exitSpy.mockRestore();
});
```

같은 패턴으로 잘못된 OS, 아키텍처, Python/CUDA 버전 형식과 타입별 조합을 table-driven 테스트로 확인한다.

- [ ] **Step 4: Maven classifier 전달 실패 테스트 작성**

```ts
it('Maven classifier를 resolver 입력과 다운로드 큐에 보존한다', async () => {
  await downloadCommand(commandOptions({
    type: 'maven',
    package: 'org.lwjgl:lwjgl',
    classifier: 'natives-linux',
  }));

  expect(resolveAllDependencies).toHaveBeenCalledWith(
    [expect.objectContaining({ classifier: 'natives-linux' })],
    expect.any(Object)
  );
  expect(addToQueue).toHaveBeenCalledWith([
    expect.objectContaining({
      metadata: expect.objectContaining({ classifier: 'natives-linux' }),
    }),
  ]);
});
```

- [ ] **Step 5: 관련 테스트가 기존 구현에서 실패하는지 확인**

Run: `npx vitest run src/cli/commands/download.test.ts`

Expected: FAIL because the new options are not forwarded and classifier is absent.

- [ ] **Step 6: Commander 옵션 추가**

```ts
.option('--target-os <os>', '대상 OS (any, linux, windows, macos)', 'any')
.option('--python-version <version>', 'Python 버전 (예: 3.12)')
.option('--cuda-version <version>', 'CUDA 버전 (예: 12.4)')
.option('--conda-channel <channel>', 'Conda 채널', 'conda-forge')
.option('--classifier <classifier>', 'Maven classifier')
```

- [ ] **Step 7: download command 옵션 타입과 초기 검증 연결**

`DownloadCommandOptions`가 `CliDownloadEnvironmentOptions`를 확장하게 하고 `downloadCommand`의 `try` 블록 첫 줄에서 `validateDownloadEnvironmentOptions(options)`를 호출한다. 모든 기존 테스트 fixture에 `targetOS: 'any'`, `condaChannel: 'conda-forge'`를 추가한다.

- [ ] **Step 8: classifier와 resolver 옵션 전달 구현**

```ts
packages = packages.map((pkg) => options.classifier
  ? {
      ...pkg,
      metadata: { ...(pkg.metadata ?? {}), classifier: options.classifier },
    }
  : pkg
);

const resolved = await resolveAllDependencies(packages.map(toDownloadPackage), {
  architecture: options.arch,
  targetOS: options.targetOS,
  pythonVersion: options.pythonVersion,
  cudaVersion: options.cudaVersion,
  condaChannel: options.condaChannel,
  includeDependencies: true,
  maxDepth: options.deps ? undefined : 0,
});
```

`toDownloadPackage`는 `metadata.classifier`, `metadata.indexUrl`, `metadata.extras`를 대응하는 최상위 `DownloadPackage` 필드로 복원한다.

- [ ] **Step 9: `--no-deps` 루트 결과 선택 구현**

`options.deps === false`이고 `hasExplicitTargetEnvironment(options)`가 참인 pip/conda/Maven만 resolver를 실행한다. resolver 호출 전에 요청 `DownloadPackage`의 `id` 집합을 저장하고, 반환된 `resolved.allPackages`에서 해당 `id`에 속하는 병합 완료 항목만 골라 `PackageInfo`로 변환한다. 따라서 의존성은 큐에 넣지 않으면서 Task 3의 병합 우선순위에 따라 보존된 `indexUrl`, `extras`, 요청 메타데이터와 resolver 선택 메타데이터를 함께 사용한다. 그 외 `--no-deps`는 조기 반환한다.

- [ ] **Step 10: download command 테스트 통과 확인**

Run: `npx vitest run src/cli/commands/download-environment.test.ts src/cli/commands/download.test.ts`

Expected: PASS.

- [ ] **Step 11: 커밋**

```bash
git add src/cli/index.ts src/cli/commands/download.ts src/cli/commands/download.test.ts
git commit -m "feat: CLI 다운로드 대상 환경 옵션 전달"
```

### Task 3: Resolver 선택 메타데이터 병합

**Files:**
- Modify: `src/core/shared/dependency-resolver.ts`
- Modify: `src/core/shared/dependency-resolver.test.ts`

- [ ] **Step 1: 기존 root에 Conda 선택 결과를 병합하는 실패 테스트 작성**

```ts
it('resolver가 선택한 root 메타데이터를 기존 요청 패키지에 병합한다', async () => {
  mockResolver.resolveDependencies.mockResolvedValue({
    root: {
      package: {
        type: 'conda',
        name: 'pandas',
        version: '2.0.0',
        arch: 'aarch64',
        metadata: {
          repository: 'defaults/pandas',
          subdir: 'linux-aarch64',
          filename: 'pandas-2.0.0-py312.conda',
          downloadUrl: 'https://conda.example/pandas-2.0.0-py312.conda',
          checksum: { md5: 'resolved' },
        },
      },
      dependencies: [],
    },
    flatList: [{
      type: 'conda',
      name: 'pandas',
      version: '2.0.0',
      arch: 'aarch64',
      metadata: {
        repository: 'defaults/pandas',
        subdir: 'linux-aarch64',
        filename: 'pandas-2.0.0-py312.conda',
        downloadUrl: 'https://conda.example/pandas-2.0.0-py312.conda',
        checksum: { md5: 'resolved' },
      },
    }],
    conflicts: [],
    totalSize: 1,
  });

  const [root] = (await resolveAllDependencies([{
    id: 'request-id',
    type: 'conda',
    name: 'pandas',
    version: '2.0.0',
    architecture: 'x86_64',
    indexUrl: 'https://request.example/simple',
    metadata: { classifier: 'request', checksum: { md5: 'old' } },
  }])).allPackages;

  expect(root).toMatchObject({
    id: 'request-id',
    architecture: 'aarch64',
    downloadUrl: 'https://conda.example/pandas-2.0.0-py312.conda',
    filename: 'pandas-2.0.0-py312.conda',
    indexUrl: 'https://request.example/simple',
    metadata: {
      classifier: 'request',
      checksum: { md5: 'resolved' },
      subdir: 'linux-aarch64',
    },
  });
});
```

- [ ] **Step 2: 테스트를 실행해 기존 root가 병합되지 않아 실패하는지 확인**

Run: `npx vitest run src/core/shared/dependency-resolver.test.ts`

Expected: FAIL because `resolvedSet.has(depKey)` currently skips the resolver package.

- [ ] **Step 3: 변환 및 병합 helper 구현**

```ts
function mergeResolvedPackage(
  existing: DownloadPackage,
  resolved: DownloadPackage
): DownloadPackage {
  return {
    ...existing,
    version: resolved.version ?? existing.version,
    architecture: resolved.architecture ?? existing.architecture,
    size: resolved.size ?? existing.size,
    downloadUrl: resolved.downloadUrl ?? existing.downloadUrl,
    repository: resolved.repository ?? existing.repository,
    location: resolved.location ?? existing.location,
    filename: resolved.filename ?? existing.filename,
    classifier: resolved.classifier ?? existing.classifier,
    indexUrl: existing.indexUrl ?? resolved.indexUrl,
    extras: existing.extras ?? resolved.extras,
    metadata: {
      ...(existing.metadata ?? {}),
      ...(resolved.metadata ?? {}),
    },
  };
}
```

flat package를 `DownloadPackage`로 변환한 뒤 같은 키가 있으면 `mergeResolvedPackage`로 교체한다. `id`, `type`, `name`은 spread된 기존 값으로 유지하고 resolver가 같은 필드를 덮어쓰지 않도록 명시적으로 구성한다.

- [ ] **Step 4: Conda와 Maven 선택 결과 보존 assertion 추가**

Conda 테스트는 `downloadUrl`, `subdir`, `filename`을 확인한다. Maven 테스트는 root의 `classifier`가 최상위와 metadata 변환 경로에서 보존되는지 확인한다.

- [ ] **Step 5: resolver 테스트 통과 확인**

Run: `npx vitest run src/core/shared/dependency-resolver.test.ts`

Expected: PASS.

- [ ] **Step 6: 커밋**

```bash
git add src/core/shared/dependency-resolver.ts src/core/shared/dependency-resolver.test.ts
git commit -m "fix: resolver 선택 메타데이터 보존"
```

### Task 4: Downloader가 선택된 아티팩트를 사용

**Files:**
- Modify: `src/core/downloaders/pip.ts`
- Modify: `src/core/downloaders/pip.test.ts`
- Modify: `src/core/downloaders/conda.test.ts`
- Modify: `src/core/downloaders/maven-download.test.ts`

- [ ] **Step 1: pip 제공 URL 우선 사용 실패 테스트 작성**

```ts
it('resolver가 제공한 URL을 메타데이터 재조회 없이 다운로드한다', async () => {
  const getMetadata = vi.spyOn(downloader, 'getPackageMetadata');
  const verifyChecksum = vi
    .spyOn(downloader as any, 'verifyChecksum')
    .mockResolvedValue(true);
  const downloadArtifactFile = vi
    .spyOn(downloader as any, 'downloadArtifactFile')
    .mockResolvedValue('/tmp/test/demo.whl');

  await downloader.downloadPackage({
    type: 'pip',
    name: 'demo',
    version: '1.0.0',
    metadata: {
      downloadUrl: 'https://files.example/demo-cp312.whl',
      checksum: { sha256: 'resolved-sha' },
    },
  }, '/tmp/test');

  expect(getMetadata).not.toHaveBeenCalled();
  expect(downloadArtifactFile).toHaveBeenCalledWith(
    '/tmp/test',
    expect.objectContaining({
      downloadUrl: 'https://files.example/demo-cp312.whl',
    }),
    undefined
  );

  const artifactOptions = downloadArtifactFile.mock.calls[0][1];
  await artifactOptions.verifyFile('/tmp/test/demo.whl');
  expect(verifyChecksum).toHaveBeenCalledWith(
    '/tmp/test/demo.whl',
    'resolved-sha'
  );
});
```

- [ ] **Step 2: 테스트를 실행해 현재 재조회 때문에 실패하는지 확인**

Run: `npx vitest run src/core/downloaders/pip.test.ts`

Expected: FAIL because `downloadPackage` always calls `getPackageMetadata`.

- [ ] **Step 3: pip URL 우선 및 폴백 구현**

```ts
let packageInfo = info;
let downloadUrl = info.metadata?.downloadUrl;

if (!downloadUrl) {
  const indexUrl = info.metadata?.indexUrl as string | undefined;
  packageInfo = await this.getPackageMetadata(info.name, info.version, indexUrl);
  downloadUrl = packageInfo.metadata?.downloadUrl;
}
```

체크섬은 최종 `packageInfo.metadata.checksum`을 사용하고 기존 오류/다운로드 로직은 유지한다.

- [ ] **Step 4: Conda URL 우선 사용 회귀 테스트 추가**

`CondaDownloader.downloadPackage`의 `getPackageMetadata`와 `downloadArtifactFile`을 spy하여 전달된 `metadata.downloadUrl`이 사용되고 재조회하지 않는지 확인한다. 프로덕션 변경이 필요 없으면 테스트만 추가한다.

- [ ] **Step 5: Maven classifier 실제 호출 assertion 강화**

기존 `classifier가 있는 패키지` 테스트에 다음 assertion을 추가한다.

```ts
expect(mockDownloadArtifact).toHaveBeenCalledWith(
  'com.example',
  'test',
  '1.0.0',
  expect.any(String),
  'jar',
  expect.any(Function),
  'natives'
);
```

실제 함수 시그니처에 맞춰 위치를 조정하되 classifier 값이 호출 인자로 전달되는 사실을 검증한다.

- [ ] **Step 6: downloader 테스트 통과 확인**

Run: `npx vitest run src/core/downloaders/pip.test.ts src/core/downloaders/conda.test.ts src/core/downloaders/maven-download.test.ts`

Expected: PASS.

- [ ] **Step 7: 커밋**

```bash
git add src/core/downloaders/pip.ts src/core/downloaders/pip.test.ts src/core/downloaders/conda.test.ts src/core/downloaders/maven-download.test.ts
git commit -m "fix: 선택된 패키지 아티팩트 다운로드"
```

### Task 5: 사용자 문서 업데이트

**Files:**
- Modify: `docs/cli.md`
- Modify: `README.md`

- [ ] **Step 1: CLI 옵션 표와 적용 규칙 추가**

`docs/cli.md`에 여섯 대상 환경 옵션, 허용 값, 기본값과 타입별 적용 범위를 추가한다. 기본값이 아닌 옵션을 적용할 수 없는 타입에 사용하면 오류가 발생한다는 규칙과 `major.minor` 버전 형식을 명시한다.

- [ ] **Step 2: 패키지 타입별 예시 추가**

```bash
depssmuggler download -t pip -p cryptography -V 43.0.0 \
  --target-os linux --python-version 3.12 --arch aarch64

depssmuggler download -t conda -p pytorch -V 2.5.0 \
  --target-os linux --python-version 3.12 --cuda-version 12.4 \
  --conda-channel pytorch --arch x86_64

depssmuggler download -t maven -p org.lwjgl:lwjgl -V 3.3.6 \
  --target-os linux --arch x86_64 --classifier natives-linux
```

- [ ] **Step 3: README의 CLI 빠른 시작 예시 보강**

README에는 위 세 유형의 간단한 단일 행 예시를 넣고 세부 규칙은 `docs/cli.md` 링크로 안내한다.

- [ ] **Step 4: 문서 diff 검증**

Run: `git diff --check`

Expected: no output and exit code 0.

- [ ] **Step 5: 커밋**

```bash
git add README.md docs/cli.md
git commit -m "docs: CLI 대상 환경 옵션 사용법 추가"
```

### Task 6: 통합 검증과 worktree-flow 인계

**Files:**
- Modify if absent: `scripts/verify-worktree.sh`

- [ ] **Step 1: worktree 표준 검증 스크립트 확보**

Run: `bash /Users/jonggeun/IdeaProjects/myskillrepo/skills/worktree-flow/scripts/ensure_verify_worktree.sh /Users/jonggeun/IdeaProjects/DepsSmuggler-worktrees/cli-download-environment`

Expected: existing script accepted or a Node `npm test` wrapper created.

- [ ] **Step 2: 관련 단위 테스트 재실행**

Run:

```bash
npx vitest run \
  src/cli/commands/download-environment.test.ts \
  src/cli/commands/download.test.ts \
  src/core/shared/dependency-resolver.test.ts \
  src/core/downloaders/pip.test.ts \
  src/core/downloaders/conda.test.ts \
  src/core/downloaders/maven-download.test.ts
```

Expected: all selected test files pass with zero failures.

- [ ] **Step 3: 저장소 표준 전체 테스트 실행**

Run: `bash scripts/verify-worktree.sh`

Expected: exit code 0 and zero failed tests.

- [ ] **Step 4: TypeScript 빌드 검증**

Run: `npm run build`

Expected: exit code 0.

- [ ] **Step 5: 최종 diff와 상태 확인**

Run:

```bash
git diff --check
git status --short
git log --oneline origin/main..HEAD
```

Expected: no whitespace errors; only intended tracked changes; design, implementation, tests and docs commits visible.

- [ ] **Step 6: 검증 중 생성된 표준 스크립트가 있으면 커밋**

```bash
git add scripts/verify-worktree.sh
git commit -m "test: worktree 검증 진입점 추가"
```

스크립트가 기존 파일이면 이 단계는 생략한다.

- [ ] **Step 7: `worktree-flow` 후속 단계 실행**

브랜치를 push하고 한글 PR을 생성한 뒤 skill helper로 라벨을 부착한다. 전체 PR 기록을 주입한 독립 리뷰 게이트가 PASS일 때만 CI를 기다리고 squash merge와 브랜치/worktree 정리를 수행한다.

### Task 7: 독립 코드 리뷰 후 정확도 보강

**Files:**
- Modify: `src/cli/commands/download-environment.ts`
- Modify: `src/cli/commands/download-environment.test.ts`
- Modify: `src/cli/commands/download.ts`
- Modify: `src/cli/commands/download.test.ts`
- Modify: `src/core/resolver/pip-resolver.ts`
- Create: `src/core/resolver/pip-resolver-download.test.ts`
- Modify: `docs/cli.md`

- [ ] pip와 Conda는 resolver가 실제 구분하는 `x86_64`, `amd64`, `arm64`, `aarch64`만 대상 아키텍처로 허용한다.
- [ ] `--file`에서 읽은 모든 루트 패키지에도 CLI의 `--arch` 값을 적용한다.
- [ ] pip/Conda의 `--no-deps`에서도 비기본 `--arch`를 명시하면 깊이 0으로 대상 루트 아티팩트를 해결한다.
- [ ] Maven의 비기본 OS/아키텍처에는 classifier를 요구하고 resolver에는 deprecated된 대상 OS/아키텍처 필드를 전달하지 않는다.
- [ ] pip resolver가 PyPI JSON 및 Simple API에서 선택한 URL·파일명·체크섬을 결과 메타데이터에 저장한다.
- [ ] pip의 ARM64/x86_64 별칭을 API 경로와 OS에 관계없이 정규화하고, `abi3` 최소 CPython 버전과 PEP 440 wildcard를 포함한 `Requires-Python` 제약을 평가한다.
- [ ] Simple API에 호환 wheel이 없으면 다른 아키텍처 wheel이 아니라 sdist로 폴백한다.
- [ ] resolver 결과를 Pip downloader에 직접 전달하는 테스트로 메타데이터 재조회 없이 같은 URL과 체크섬을 사용하는지 확인한다.
