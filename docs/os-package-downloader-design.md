# OS 패키지 다운로더 설계 문서

## 1. 개요

OS 패키지(yum/rpm, apt/deb, apk) 다운로드를 위한 통합 모듈 설계.
폐쇄망 환경에 패키지와 의존성을 전달하기 위한 다운로드 및 패키징 기능 제공.

---

## 2. 지원 패키지 관리자

### 2.1 YUM/RPM (RHEL/CentOS/Fedora)
- **파일 형식**: `.rpm`
- **메타데이터**: `repodata/repomd.xml`, `primary.xml.gz`, `filelists.xml.gz`
- **공식 저장소**: CentOS Vault, Rocky Linux, AlmaLinux, Fedora
- **확장 저장소**: EPEL, RPMFusion

### 2.2 APT/DEB (Ubuntu/Debian)
- **파일 형식**: `.deb`
- **메타데이터**: `Packages.gz`, `Release`, `InRelease`
- **공식 저장소**: archive.ubuntu.com, deb.debian.org
- **확장 저장소**: universe, multiverse, backports

### 2.3 APK (Alpine Linux)
- **파일 형식**: `.apk`
- **메타데이터**: `APKINDEX.tar.gz`
- **공식 저장소**: dl-cdn.alpinelinux.org
- **확장 저장소**: community, testing

---

## 3. 아키텍처 설계

### 3.1 모듈 구조

```
src/core/downloaders/os/
├── index.ts                 # 통합 인터페이스 및 팩토리
├── types.ts                 # 공통 타입 정의
├── base.ts                  # 기본 추상 클래스
├── yum/
│   ├── index.ts             # YUM 다운로더
│   ├── metadata-parser.ts   # repodata 파싱
│   ├── dependency-resolver.ts
│   └── repositories.ts      # 저장소 프리셋
├── apt/
│   ├── index.ts             # APT 다운로더
│   ├── metadata-parser.ts   # Packages.gz 파싱
│   ├── dependency-resolver.ts
│   └── repositories.ts
├── apk/
│   ├── index.ts             # APK 다운로더
│   ├── metadata-parser.ts   # APKINDEX 파싱
│   ├── dependency-resolver.ts
│   └── repositories.ts
└── utils/
    ├── gpg-verifier.ts      # GPG 서명 검증
    ├── cache-manager.ts     # 메타데이터 캐시
    └── script-generator.ts  # 설치 스크립트 생성
```

### 3.2 공통 인터페이스

```typescript
// types.ts

/** 패키지 관리자 타입 */
export type OSPackageManager = 'yum' | 'apt' | 'apk';

/** 아키텍처 타입 */
export type Architecture =
  | 'x86_64' | 'amd64'      // 64비트 x86
  | 'aarch64' | 'arm64'     // 64비트 ARM
  | 'i686' | 'i386'         // 32비트 x86
  | 'armv7l' | 'armhf'      // 32비트 ARM
  | 'noarch' | 'all';       // 아키텍처 무관

/** OS 배포판 정보 */
export interface OSDistribution {
  id: string;               // 'centos', 'ubuntu', 'alpine'
  name: string;             // 'CentOS', 'Ubuntu', 'Alpine Linux'
  version: string;          // '7', '22.04', '3.18'
  codename?: string;        // 'jammy', 'bookworm'
  packageManager: OSPackageManager;
  architectures: Architecture[];
  defaultRepos: Repository[];
  extendedRepos: Repository[];
}

/** 저장소 정보 */
export interface Repository {
  id: string;
  name: string;
  baseUrl: string;
  enabled: boolean;
  gpgCheck: boolean;
  gpgKeyUrl?: string;
  priority?: number;
  isOfficial: boolean;
}

/** 패키지 정보 */
export interface OSPackageInfo {
  name: string;
  version: string;
  release?: string;         // RPM: 1.el7
  epoch?: number;           // RPM: epoch
  architecture: Architecture;
  size: number;
  installedSize?: number;
  checksum: {
    type: 'md5' | 'sha1' | 'sha256' | 'sha512';
    value: string;
  };
  location: string;         // 저장소 내 상대 경로
  repository: Repository;
  description?: string;
  summary?: string;
  license?: string;
  dependencies: PackageDependency[];
  provides?: string[];
  conflicts?: string[];
  obsoletes?: string[];
  suggests?: string[];      // DEB: Suggests
  recommends?: string[];    // DEB: Recommends
}

/** 패키지 의존성 */
export interface PackageDependency {
  name: string;
  version?: string;
  operator?: '=' | '<' | '>' | '<=' | '>=' | '<<' | '>>';
  isOptional?: boolean;     // Suggests, Recommends
}

/** 검색 옵션 */
export interface OSPackageSearchOptions {
  query: string;
  distribution: OSDistribution;
  architecture: Architecture;
  repositories?: Repository[];
  matchType: 'exact' | 'partial' | 'wildcard';
  includeVersions: boolean;
  limit?: number;
}

/** 검색 결과 */
export interface OSPackageSearchResult {
  packages: OSPackageInfo[];
  totalCount: number;
  hasMore: boolean;
}

/** 다운로드 옵션 */
export interface OSPackageDownloadOptions {
  packages: OSPackageInfo[];
  outputDir: string;
  resolveDependencies: boolean;
  includeOptionalDeps: boolean;  // Suggests, Recommends
  concurrency: number;
  verifyGPG: boolean;
  onProgress?: (progress: DownloadProgress) => void;
  onError?: (error: DownloadError) => Promise<ErrorAction>;
}

/** 다운로드 진행 상황 */
export interface DownloadProgress {
  currentPackage: string;
  currentIndex: number;
  totalPackages: number;
  bytesDownloaded: number;
  totalBytes: number;
  speed: number;            // bytes/sec
}

/** 에러 액션 */
export type ErrorAction = 'retry' | 'skip' | 'cancel';

/** 다운로드 에러 */
export interface DownloadError {
  package: OSPackageInfo;
  error: Error;
  retryCount: number;
}

/** 다운로드 결과 */
export interface OSPackageDownloadResult {
  success: OSPackageInfo[];
  failed: Array<{ package: OSPackageInfo; error: Error }>;
  skipped: OSPackageInfo[];
  totalSize: number;
  outputDir: string;
}

/** 출력 옵션 */
export interface OSPackageOutputOptions {
  type: 'archive' | 'repository' | 'both';
  archiveFormat?: 'zip' | 'tar.gz';
  generateScripts: boolean;
  scriptTypes: ('dependency-order' | 'local-repo')[];
}
```

---

## 4. OS 버전 프리셋

### 4.1 프리셋 정의

```typescript
// repositories.ts

export const OS_PRESETS: Record<string, OSDistribution[]> = {
  // RHEL 계열
  rhel: [
    {
      id: 'centos-7',
      name: 'CentOS 7',
      version: '7',
      packageManager: 'yum',
      architectures: ['x86_64', 'aarch64'],
      defaultRepos: [
        {
          id: 'base',
          name: 'CentOS 7 - Base',
          baseUrl: 'http://vault.centos.org/7.9.2009/os/$basearch/',
          enabled: true,
          gpgCheck: true,
          gpgKeyUrl: 'file:///etc/pki/rpm-gpg/RPM-GPG-KEY-CentOS-7',
          isOfficial: true,
        },
        {
          id: 'updates',
          name: 'CentOS 7 - Updates',
          baseUrl: 'http://vault.centos.org/7.9.2009/updates/$basearch/',
          enabled: true,
          gpgCheck: true,
          isOfficial: true,
        },
      ],
      extendedRepos: [
        {
          id: 'epel',
          name: 'EPEL 7',
          baseUrl: 'https://dl.fedoraproject.org/pub/epel/7/$basearch/',
          enabled: false,
          gpgCheck: true,
          gpgKeyUrl: 'https://dl.fedoraproject.org/pub/epel/RPM-GPG-KEY-EPEL-7',
          isOfficial: false,
        },
      ],
    },
    {
      id: 'rocky-8',
      name: 'Rocky Linux 8',
      version: '8',
      packageManager: 'yum',
      architectures: ['x86_64', 'aarch64'],
      defaultRepos: [
        {
          id: 'baseos',
          name: 'Rocky Linux 8 - BaseOS',
          baseUrl: 'https://dl.rockylinux.org/pub/rocky/8/BaseOS/$basearch/os/',
          enabled: true,
          gpgCheck: true,
          isOfficial: true,
        },
        {
          id: 'appstream',
          name: 'Rocky Linux 8 - AppStream',
          baseUrl: 'https://dl.rockylinux.org/pub/rocky/8/AppStream/$basearch/os/',
          enabled: true,
          gpgCheck: true,
          isOfficial: true,
        },
      ],
      extendedRepos: [
        {
          id: 'epel',
          name: 'EPEL 8',
          baseUrl: 'https://dl.fedoraproject.org/pub/epel/8/Everything/$basearch/',
          enabled: false,
          gpgCheck: true,
          isOfficial: false,
        },
        {
          id: 'powertools',
          name: 'Rocky Linux 8 - PowerTools',
          baseUrl: 'https://dl.rockylinux.org/pub/rocky/8/PowerTools/$basearch/os/',
          enabled: false,
          gpgCheck: true,
          isOfficial: true,
        },
      ],
    },
    {
      id: 'rocky-9',
      name: 'Rocky Linux 9',
      version: '9',
      packageManager: 'yum',
      architectures: ['x86_64', 'aarch64'],
      defaultRepos: [
        {
          id: 'baseos',
          name: 'Rocky Linux 9 - BaseOS',
          baseUrl: 'https://dl.rockylinux.org/pub/rocky/9/BaseOS/$basearch/os/',
          enabled: true,
          gpgCheck: true,
          isOfficial: true,
        },
        {
          id: 'appstream',
          name: 'Rocky Linux 9 - AppStream',
          baseUrl: 'https://dl.rockylinux.org/pub/rocky/9/AppStream/$basearch/os/',
          enabled: true,
          gpgCheck: true,
          isOfficial: true,
        },
      ],
      extendedRepos: [
        {
          id: 'epel',
          name: 'EPEL 9',
          baseUrl: 'https://dl.fedoraproject.org/pub/epel/9/Everything/$basearch/',
          enabled: false,
          gpgCheck: true,
          isOfficial: false,
        },
        {
          id: 'crb',
          name: 'Rocky Linux 9 - CRB',
          baseUrl: 'https://dl.rockylinux.org/pub/rocky/9/CRB/$basearch/os/',
          enabled: false,
          gpgCheck: true,
          isOfficial: true,
        },
      ],
    },
    {
      id: 'alma-8',
      name: 'AlmaLinux 8',
      version: '8',
      packageManager: 'yum',
      architectures: ['x86_64', 'aarch64'],
      defaultRepos: [
        {
          id: 'baseos',
          name: 'AlmaLinux 8 - BaseOS',
          baseUrl: 'https://repo.almalinux.org/almalinux/8/BaseOS/$basearch/os/',
          enabled: true,
          gpgCheck: true,
          isOfficial: true,
        },
      ],
      extendedRepos: [],
    },
    {
      id: 'alma-9',
      name: 'AlmaLinux 9',
      version: '9',
      packageManager: 'yum',
      architectures: ['x86_64', 'aarch64'],
      defaultRepos: [
        {
          id: 'baseos',
          name: 'AlmaLinux 9 - BaseOS',
          baseUrl: 'https://repo.almalinux.org/almalinux/9/BaseOS/$basearch/os/',
          enabled: true,
          gpgCheck: true,
          isOfficial: true,
        },
      ],
      extendedRepos: [],
    },
  ],

  // Debian 계열
  debian: [
    {
      id: 'ubuntu-20.04',
      name: 'Ubuntu 20.04 LTS (Focal Fossa)',
      version: '20.04',
      codename: 'focal',
      packageManager: 'apt',
      architectures: ['amd64', 'arm64', 'i386'],
      defaultRepos: [
        {
          id: 'main',
          name: 'Ubuntu Main',
          baseUrl: 'http://archive.ubuntu.com/ubuntu/dists/focal/main/',
          enabled: true,
          gpgCheck: true,
          isOfficial: true,
        },
        {
          id: 'updates',
          name: 'Ubuntu Updates',
          baseUrl: 'http://archive.ubuntu.com/ubuntu/dists/focal-updates/main/',
          enabled: true,
          gpgCheck: true,
          isOfficial: true,
        },
        {
          id: 'security',
          name: 'Ubuntu Security',
          baseUrl: 'http://security.ubuntu.com/ubuntu/dists/focal-security/main/',
          enabled: true,
          gpgCheck: true,
          isOfficial: true,
        },
      ],
      extendedRepos: [
        {
          id: 'universe',
          name: 'Ubuntu Universe',
          baseUrl: 'http://archive.ubuntu.com/ubuntu/dists/focal/universe/',
          enabled: false,
          gpgCheck: true,
          isOfficial: true,
        },
        {
          id: 'multiverse',
          name: 'Ubuntu Multiverse',
          baseUrl: 'http://archive.ubuntu.com/ubuntu/dists/focal/multiverse/',
          enabled: false,
          gpgCheck: true,
          isOfficial: true,
        },
      ],
    },
    {
      id: 'ubuntu-22.04',
      name: 'Ubuntu 22.04 LTS (Jammy Jellyfish)',
      version: '22.04',
      codename: 'jammy',
      packageManager: 'apt',
      architectures: ['amd64', 'arm64'],
      defaultRepos: [
        {
          id: 'main',
          name: 'Ubuntu Main',
          baseUrl: 'http://archive.ubuntu.com/ubuntu/dists/jammy/main/',
          enabled: true,
          gpgCheck: true,
          isOfficial: true,
        },
      ],
      extendedRepos: [
        {
          id: 'universe',
          name: 'Ubuntu Universe',
          baseUrl: 'http://archive.ubuntu.com/ubuntu/dists/jammy/universe/',
          enabled: false,
          gpgCheck: true,
          isOfficial: true,
        },
      ],
    },
    {
      id: 'ubuntu-24.04',
      name: 'Ubuntu 24.04 LTS (Noble Numbat)',
      version: '24.04',
      codename: 'noble',
      packageManager: 'apt',
      architectures: ['amd64', 'arm64'],
      defaultRepos: [
        {
          id: 'main',
          name: 'Ubuntu Main',
          baseUrl: 'http://archive.ubuntu.com/ubuntu/dists/noble/main/',
          enabled: true,
          gpgCheck: true,
          isOfficial: true,
        },
      ],
      extendedRepos: [],
    },
    {
      id: 'debian-11',
      name: 'Debian 11 (Bullseye)',
      version: '11',
      codename: 'bullseye',
      packageManager: 'apt',
      architectures: ['amd64', 'arm64', 'i386'],
      defaultRepos: [
        {
          id: 'main',
          name: 'Debian Main',
          baseUrl: 'http://deb.debian.org/debian/dists/bullseye/main/',
          enabled: true,
          gpgCheck: true,
          isOfficial: true,
        },
      ],
      extendedRepos: [],
    },
    {
      id: 'debian-12',
      name: 'Debian 12 (Bookworm)',
      version: '12',
      codename: 'bookworm',
      packageManager: 'apt',
      architectures: ['amd64', 'arm64', 'i386'],
      defaultRepos: [
        {
          id: 'main',
          name: 'Debian Main',
          baseUrl: 'http://deb.debian.org/debian/dists/bookworm/main/',
          enabled: true,
          gpgCheck: true,
          isOfficial: true,
        },
      ],
      extendedRepos: [],
    },
  ],

  // Alpine
  alpine: [
    {
      id: 'alpine-3.18',
      name: 'Alpine Linux 3.18',
      version: '3.18',
      packageManager: 'apk',
      architectures: ['x86_64', 'aarch64', 'x86'],
      defaultRepos: [
        {
          id: 'main',
          name: 'Alpine Main',
          baseUrl: 'https://dl-cdn.alpinelinux.org/alpine/v3.18/main/',
          enabled: true,
          gpgCheck: true,
          isOfficial: true,
        },
      ],
      extendedRepos: [
        {
          id: 'community',
          name: 'Alpine Community',
          baseUrl: 'https://dl-cdn.alpinelinux.org/alpine/v3.18/community/',
          enabled: false,
          gpgCheck: true,
          isOfficial: true,
        },
        {
          id: 'testing',
          name: 'Alpine Testing',
          baseUrl: 'https://dl-cdn.alpinelinux.org/alpine/edge/testing/',
          enabled: false,
          gpgCheck: false,
          isOfficial: false,
        },
      ],
    },
    {
      id: 'alpine-3.19',
      name: 'Alpine Linux 3.19',
      version: '3.19',
      packageManager: 'apk',
      architectures: ['x86_64', 'aarch64'],
      defaultRepos: [
        {
          id: 'main',
          name: 'Alpine Main',
          baseUrl: 'https://dl-cdn.alpinelinux.org/alpine/v3.19/main/',
          enabled: true,
          gpgCheck: true,
          isOfficial: true,
        },
      ],
      extendedRepos: [
        {
          id: 'community',
          name: 'Alpine Community',
          baseUrl: 'https://dl-cdn.alpinelinux.org/alpine/v3.19/community/',
          enabled: false,
          gpgCheck: true,
          isOfficial: true,
        },
      ],
    },
    {
      id: 'alpine-3.20',
      name: 'Alpine Linux 3.20',
      version: '3.20',
      packageManager: 'apk',
      architectures: ['x86_64', 'aarch64'],
      defaultRepos: [
        {
          id: 'main',
          name: 'Alpine Main',
          baseUrl: 'https://dl-cdn.alpinelinux.org/alpine/v3.20/main/',
          enabled: true,
          gpgCheck: true,
          isOfficial: true,
        },
      ],
      extendedRepos: [],
    },
  ],
};

/** 추천 OS 버전 (LTS 및 안정 버전) */
export const RECOMMENDED_DISTRIBUTIONS: string[] = [
  'rocky-9',      // RHEL 9 호환, 최신 LTS
  'rocky-8',      // RHEL 8 호환, 안정적
  'ubuntu-22.04', // Ubuntu 최신 LTS
  'ubuntu-24.04', // Ubuntu 최신 LTS
  'debian-12',    // Debian 최신 안정판
  'alpine-3.20',  // Alpine 최신 안정판
];

/** 용도별 추천 */
export const RECOMMENDATIONS_BY_USECASE: Record<string, string[]> = {
  // 엔터프라이즈/프로덕션 환경
  enterprise: ['rocky-9', 'alma-9', 'ubuntu-22.04'],

  // 레거시 시스템 호환
  legacy: ['centos-7', 'ubuntu-20.04', 'debian-11'],

  // 컨테이너/경량 환경
  container: ['alpine-3.20', 'alpine-3.19'],

  // 개발 환경
  development: ['ubuntu-24.04', 'debian-12', 'rocky-9'],
};
```

---

## 5. 의존성 해결

### 5.1 하이브리드 방식

```typescript
// dependency-resolver.ts

export interface DependencyResolverOptions {
  distribution: OSDistribution;
  repositories: Repository[];
  architecture: Architecture;
  cacheManager: CacheManager;
  includeOptional: boolean;
}

export abstract class BaseDependencyResolver {
  protected options: DependencyResolverOptions;
  protected metadataCache: Map<string, PackageMetadata>;

  constructor(options: DependencyResolverOptions) {
    this.options = options;
    this.metadataCache = new Map();
  }

  /**
   * 패키지의 모든 의존성을 해결
   * 하이브리드 방식: API 우선 시도, 실패 시 메타데이터 파싱
   */
  async resolveDependencies(packages: OSPackageInfo[]): Promise<DependencyTree> {
    const tree = new DependencyTree();
    const visited = new Set<string>();
    const queue = [...packages];

    while (queue.length > 0) {
      const pkg = queue.shift()!;
      const pkgKey = this.getPackageKey(pkg);

      if (visited.has(pkgKey)) continue;
      visited.add(pkgKey);

      tree.addNode(pkg);

      // 의존성 조회 (하이브리드)
      const deps = await this.fetchDependencies(pkg);

      for (const dep of deps) {
        // 의존성을 만족하는 패키지 찾기
        const candidates = await this.findPackagesForDependency(dep);

        if (candidates.length === 0) {
          tree.addMissingDependency(pkg, dep);
          continue;
        }

        // 모든 버전 다운로드 전략: 모든 후보 추가
        for (const candidate of candidates) {
          tree.addEdge(pkg, candidate, dep);
          queue.push(candidate);
        }
      }
    }

    return tree;
  }

  /**
   * 의존성 정보 조회 (하이브리드)
   */
  protected async fetchDependencies(pkg: OSPackageInfo): Promise<PackageDependency[]> {
    // 1. API 시도
    try {
      const apiDeps = await this.fetchDependenciesFromAPI(pkg);
      if (apiDeps) return apiDeps;
    } catch (error) {
      console.warn(`API fetch failed for ${pkg.name}, falling back to metadata`);
    }

    // 2. 메타데이터 파싱 폴백
    return await this.fetchDependenciesFromMetadata(pkg);
  }

  protected abstract fetchDependenciesFromAPI(pkg: OSPackageInfo): Promise<PackageDependency[] | null>;
  protected abstract fetchDependenciesFromMetadata(pkg: OSPackageInfo): Promise<PackageDependency[]>;
  protected abstract findPackagesForDependency(dep: PackageDependency): Promise<OSPackageInfo[]>;
  protected abstract getPackageKey(pkg: OSPackageInfo): string;
}
```

### 5.2 의존성 트리

```typescript
// dependency-tree.ts

export class DependencyTree {
  private nodes: Map<string, DependencyNode> = new Map();
  private edges: DependencyEdge[] = [];
  private missingDeps: MissingDependency[] = [];

  addNode(pkg: OSPackageInfo): void {
    const key = this.getKey(pkg);
    if (!this.nodes.has(key)) {
      this.nodes.set(key, {
        package: pkg,
        depth: 0,
        children: [],
        parents: [],
      });
    }
  }

  addEdge(parent: OSPackageInfo, child: OSPackageInfo, dependency: PackageDependency): void {
    const parentKey = this.getKey(parent);
    const childKey = this.getKey(child);

    this.addNode(parent);
    this.addNode(child);

    const parentNode = this.nodes.get(parentKey)!;
    const childNode = this.nodes.get(childKey)!;

    parentNode.children.push(childKey);
    childNode.parents.push(parentKey);
    childNode.depth = Math.max(childNode.depth, parentNode.depth + 1);

    this.edges.push({ parent: parentKey, child: childKey, dependency });
  }

  addMissingDependency(pkg: OSPackageInfo, dep: PackageDependency): void {
    this.missingDeps.push({ package: pkg, dependency: dep });
  }

  /**
   * 설치 순서대로 정렬된 패키지 목록 반환
   * (의존성이 없는 것부터 먼저)
   */
  getInstallOrder(): OSPackageInfo[] {
    return Array.from(this.nodes.values())
      .sort((a, b) => b.depth - a.depth) // 깊은 것(의존성)부터
      .map(node => node.package);
  }

  /**
   * 모든 고유 패키지 반환
   */
  getAllPackages(): OSPackageInfo[] {
    return Array.from(this.nodes.values()).map(node => node.package);
  }

  /**
   * 누락된 의존성 반환
   */
  getMissingDependencies(): MissingDependency[] {
    return this.missingDeps;
  }

  /**
   * 시각화용 데이터 반환
   */
  toVisualizationData(): VisualizationData {
    return {
      nodes: Array.from(this.nodes.entries()).map(([key, node]) => ({
        id: key,
        label: `${node.package.name}-${node.package.version}`,
        depth: node.depth,
      })),
      edges: this.edges.map(edge => ({
        source: edge.parent,
        target: edge.child,
        label: edge.dependency.name,
      })),
    };
  }

  private getKey(pkg: OSPackageInfo): string {
    return `${pkg.name}-${pkg.version}-${pkg.architecture}`;
  }
}

interface DependencyNode {
  package: OSPackageInfo;
  depth: number;
  children: string[];
  parents: string[];
}

interface DependencyEdge {
  parent: string;
  child: string;
  dependency: PackageDependency;
}

interface MissingDependency {
  package: OSPackageInfo;
  dependency: PackageDependency;
}
```

---

## 6. 메타데이터 파서

### 6.1 YUM (repomd.xml, primary.xml.gz)

```typescript
// yum/metadata-parser.ts

import { gunzipSync } from 'zlib';
import { parseXML } from '../utils/xml-parser';

export class YumMetadataParser {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  /**
   * repomd.xml 파싱하여 primary.xml 위치 찾기
   */
  async parseRepomd(): Promise<RepomdInfo> {
    const url = `${this.baseUrl}/repodata/repomd.xml`;
    const response = await fetch(url);
    const xml = await response.text();
    const parsed = parseXML(xml);

    const data: RepomdInfo = {
      revision: parsed.repomd.revision,
      primary: null,
      filelists: null,
      other: null,
    };

    for (const dataEntry of parsed.repomd.data) {
      const type = dataEntry['@_type'];
      const location = dataEntry.location['@_href'];
      const checksum = dataEntry.checksum['#text'];

      if (type === 'primary') {
        data.primary = { location, checksum };
      } else if (type === 'filelists') {
        data.filelists = { location, checksum };
      }
    }

    return data;
  }

  /**
   * primary.xml.gz 파싱하여 패키지 목록 추출
   */
  async parsePrimary(location: string): Promise<OSPackageInfo[]> {
    const url = `${this.baseUrl}/${location}`;
    const response = await fetch(url);
    const buffer = await response.arrayBuffer();

    // gzip 해제
    const decompressed = gunzipSync(Buffer.from(buffer));
    const xml = decompressed.toString('utf-8');
    const parsed = parseXML(xml);

    const packages: OSPackageInfo[] = [];

    for (const pkg of parsed.metadata.package) {
      packages.push({
        name: pkg.name,
        version: pkg.version['@_ver'],
        release: pkg.version['@_rel'],
        epoch: parseInt(pkg.version['@_epoch']) || 0,
        architecture: pkg.arch,
        size: parseInt(pkg.size['@_package']),
        installedSize: parseInt(pkg.size['@_installed']),
        checksum: {
          type: pkg.checksum['@_type'],
          value: pkg.checksum['#text'],
        },
        location: pkg.location['@_href'],
        description: pkg.description,
        summary: pkg.summary,
        license: pkg.format?.['rpm:license'],
        dependencies: this.parseRpmRequires(pkg.format?.['rpm:requires']),
        provides: this.parseRpmProvides(pkg.format?.['rpm:provides']),
        conflicts: this.parseRpmConflicts(pkg.format?.['rpm:conflicts']),
        repository: null as any, // 호출자가 설정
      });
    }

    return packages;
  }

  private parseRpmRequires(requires: any): PackageDependency[] {
    if (!requires?.entry) return [];

    const entries = Array.isArray(requires.entry) ? requires.entry : [requires.entry];
    return entries.map((entry: any) => ({
      name: entry['@_name'],
      version: entry['@_ver'],
      operator: this.parseRpmFlags(entry['@_flags']),
    }));
  }

  private parseRpmFlags(flags: string): string | undefined {
    const flagMap: Record<string, string> = {
      'EQ': '=',
      'LT': '<',
      'GT': '>',
      'LE': '<=',
      'GE': '>=',
    };
    return flagMap[flags];
  }
}
```

### 6.2 APT (Packages.gz)

```typescript
// apt/metadata-parser.ts

import { gunzipSync } from 'zlib';

export class AptMetadataParser {
  private baseUrl: string;
  private component: string;
  private architecture: string;

  constructor(baseUrl: string, component: string, architecture: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.component = component;
    this.architecture = architecture;
  }

  /**
   * Packages.gz 파싱
   */
  async parsePackages(): Promise<OSPackageInfo[]> {
    const url = `${this.baseUrl}/${this.component}/binary-${this.architecture}/Packages.gz`;
    const response = await fetch(url);
    const buffer = await response.arrayBuffer();

    const decompressed = gunzipSync(Buffer.from(buffer));
    const text = decompressed.toString('utf-8');

    return this.parsePackagesText(text);
  }

  private parsePackagesText(text: string): OSPackageInfo[] {
    const packages: OSPackageInfo[] = [];
    const entries = text.split('\n\n').filter(e => e.trim());

    for (const entry of entries) {
      const pkg = this.parsePackageEntry(entry);
      if (pkg) packages.push(pkg);
    }

    return packages;
  }

  private parsePackageEntry(entry: string): OSPackageInfo | null {
    const fields: Record<string, string> = {};
    let currentField = '';
    let currentValue = '';

    for (const line of entry.split('\n')) {
      if (line.startsWith(' ') || line.startsWith('\t')) {
        // 멀티라인 필드 계속
        currentValue += '\n' + line.trim();
      } else {
        if (currentField) {
          fields[currentField] = currentValue;
        }
        const colonIndex = line.indexOf(':');
        if (colonIndex > 0) {
          currentField = line.substring(0, colonIndex);
          currentValue = line.substring(colonIndex + 1).trim();
        }
      }
    }
    if (currentField) {
      fields[currentField] = currentValue;
    }

    if (!fields.Package) return null;

    return {
      name: fields.Package,
      version: fields.Version,
      architecture: fields.Architecture as Architecture,
      size: parseInt(fields.Size) || 0,
      installedSize: parseInt(fields['Installed-Size']) * 1024 || 0,
      checksum: {
        type: 'sha256',
        value: fields.SHA256 || fields.SHA1 || fields.MD5sum,
      },
      location: fields.Filename,
      description: fields.Description,
      summary: fields.Description?.split('\n')[0],
      dependencies: this.parseDebDepends(fields.Depends),
      suggests: this.parseDebDepends(fields.Suggests),
      recommends: this.parseDebDepends(fields.Recommends),
      conflicts: this.parseDebDepends(fields.Conflicts)?.map(d => d.name),
      provides: fields.Provides?.split(',').map(s => s.trim()),
      repository: null as any,
    };
  }

  private parseDebDepends(depends: string | undefined): PackageDependency[] {
    if (!depends) return [];

    const deps: PackageDependency[] = [];
    const parts = depends.split(',').map(s => s.trim());

    for (const part of parts) {
      // 대안 (|) 처리: 첫 번째만 사용
      const alternatives = part.split('|').map(s => s.trim());
      const first = alternatives[0];

      const match = first.match(/^([^\s(]+)(?:\s*\(([<>=]+)\s*([^)]+)\))?/);
      if (match) {
        deps.push({
          name: match[1],
          operator: match[2] as any,
          version: match[3],
        });
      }
    }

    return deps;
  }
}
```

### 6.3 APK (APKINDEX.tar.gz)

```typescript
// apk/metadata-parser.ts

import * as tar from 'tar';
import { gunzipSync } from 'zlib';

export class ApkMetadataParser {
  private baseUrl: string;
  private architecture: string;

  constructor(baseUrl: string, architecture: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.architecture = architecture;
  }

  /**
   * APKINDEX.tar.gz 파싱
   */
  async parseIndex(): Promise<OSPackageInfo[]> {
    const url = `${this.baseUrl}/${this.architecture}/APKINDEX.tar.gz`;
    const response = await fetch(url);
    const buffer = await response.arrayBuffer();

    // tar.gz 해제
    const decompressed = gunzipSync(Buffer.from(buffer));

    // APKINDEX 파일 추출
    let indexContent = '';
    // tar 파싱 로직...

    return this.parseApkIndex(indexContent);
  }

  private parseApkIndex(content: string): OSPackageInfo[] {
    const packages: OSPackageInfo[] = [];
    const entries = content.split('\n\n').filter(e => e.trim());

    for (const entry of entries) {
      const pkg = this.parseApkEntry(entry);
      if (pkg) packages.push(pkg);
    }

    return packages;
  }

  private parseApkEntry(entry: string): OSPackageInfo | null {
    const fields: Record<string, string> = {};

    for (const line of entry.split('\n')) {
      if (line.length >= 2) {
        const key = line[0];
        const value = line.substring(2);
        fields[key] = value;
      }
    }

    if (!fields.P) return null; // Package name

    return {
      name: fields.P,
      version: fields.V,
      architecture: fields.A as Architecture || this.architecture as Architecture,
      size: parseInt(fields.S) || 0,
      installedSize: parseInt(fields.I) || 0,
      checksum: {
        type: 'sha1',
        value: fields.C?.replace('Q1', ''), // APK checksum format
      },
      location: `${fields.P}-${fields.V}.apk`,
      description: fields.T,
      summary: fields.T,
      license: fields.L,
      dependencies: this.parseApkDepends(fields.D),
      provides: fields.p?.split(' '),
      repository: null as any,
    };
  }

  private parseApkDepends(depends: string | undefined): PackageDependency[] {
    if (!depends) return [];

    return depends.split(' ').filter(Boolean).map(dep => {
      // APK 의존성 형식: name, name=version, name>version 등
      const match = dep.match(/^([^<>=!]+)([<>=!]+)?(.+)?$/);
      if (match) {
        return {
          name: match[1],
          operator: match[2] as any,
          version: match[3],
        };
      }
      return { name: dep };
    });
  }
}
```

---

## 7. 캐시 관리

```typescript
// utils/cache-manager.ts

export interface CacheConfig {
  type: 'session' | 'persistent';
  ttl: number;        // 초 단위
  maxSize: number;    // 바이트
  directory?: string; // persistent일 때 저장 경로
}

export class CacheManager {
  private config: CacheConfig;
  private memoryCache: Map<string, CacheEntry>;
  private diskCachePath?: string;

  constructor(config: CacheConfig) {
    this.config = config;
    this.memoryCache = new Map();

    if (config.type === 'persistent') {
      this.diskCachePath = config.directory ||
        path.join(os.homedir(), '.depssmuggler', 'cache', 'os-packages');
    }
  }

  async get<T>(key: string): Promise<T | null> {
    // 메모리 캐시 확인
    const memEntry = this.memoryCache.get(key);
    if (memEntry && !this.isExpired(memEntry)) {
      return memEntry.data as T;
    }

    // 디스크 캐시 확인 (persistent 모드)
    if (this.config.type === 'persistent') {
      const diskEntry = await this.readFromDisk(key);
      if (diskEntry && !this.isExpired(diskEntry)) {
        this.memoryCache.set(key, diskEntry);
        return diskEntry.data as T;
      }
    }

    return null;
  }

  async set<T>(key: string, data: T): Promise<void> {
    const entry: CacheEntry = {
      data,
      timestamp: Date.now(),
      size: JSON.stringify(data).length,
    };

    this.memoryCache.set(key, entry);

    if (this.config.type === 'persistent') {
      await this.writeToDisk(key, entry);
    }

    this.enforceMaxSize();
  }

  async invalidate(pattern?: string): Promise<void> {
    if (pattern) {
      const regex = new RegExp(pattern);
      for (const key of this.memoryCache.keys()) {
        if (regex.test(key)) {
          this.memoryCache.delete(key);
        }
      }
    } else {
      this.memoryCache.clear();
    }

    if (this.config.type === 'persistent') {
      await this.clearDiskCache(pattern);
    }
  }

  private isExpired(entry: CacheEntry): boolean {
    return Date.now() - entry.timestamp > this.config.ttl * 1000;
  }

  private async readFromDisk(key: string): Promise<CacheEntry | null> {
    // 디스크 읽기 구현
  }

  private async writeToDisk(key: string, entry: CacheEntry): Promise<void> {
    // 디스크 쓰기 구현
  }

  private enforceMaxSize(): void {
    // 최대 크기 초과 시 오래된 항목 삭제
  }
}

interface CacheEntry {
  data: unknown;
  timestamp: number;
  size: number;
}
```

---

## 8. 설치 스크립트 생성

### 8.1 의존성 순서 스크립트

```typescript
// utils/script-generator.ts

export class ScriptGenerator {
  /**
   * 의존성 순서대로 설치하는 스크립트 생성
   */
  generateDependencyOrderScript(
    packages: OSPackageInfo[],
    packageManager: OSPackageManager
  ): GeneratedScripts {
    const bash = this.generateBashScript(packages, packageManager);
    const powershell = this.generatePowerShellScript(packages, packageManager);

    return { bash, powershell };
  }

  private generateBashScript(
    packages: OSPackageInfo[],
    pm: OSPackageManager
  ): string {
    const installCmd = this.getInstallCommand(pm);
    const extension = this.getExtension(pm);

    let script = `#!/bin/bash
# DepsSmuggler - OS 패키지 설치 스크립트
# 생성 시간: ${new Date().toISOString()}
# 패키지 관리자: ${pm}
# 총 패키지 수: ${packages.length}

set -e

SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_DIR="\${SCRIPT_DIR}/packages"

echo "패키지 설치를 시작합니다..."
echo "총 ${packages.length}개 패키지"
echo ""

`;

    for (let i = 0; i < packages.length; i++) {
      const pkg = packages[i];
      const filename = path.basename(pkg.location);
      script += `# [${i + 1}/${packages.length}] ${pkg.name}-${pkg.version}\n`;
      script += `echo "설치 중: ${pkg.name}-${pkg.version}"\n`;
      script += `${installCmd} "\${PACKAGE_DIR}/${filename}"\n\n`;
    }

    script += `
echo ""
echo "설치 완료!"
echo "설치된 패키지: ${packages.length}개"
`;

    return script;
  }

  private generatePowerShellScript(
    packages: OSPackageInfo[],
    pm: OSPackageManager
  ): string {
    // Windows에서는 WSL 사용 안내
    return `# DepsSmuggler - OS 패키지 설치 스크립트 (PowerShell)
# 생성 시간: ${new Date().toISOString()}
#
# 주의: Linux 패키지는 Windows에서 직접 설치할 수 없습니다.
# 이 스크립트는 WSL(Windows Subsystem for Linux)을 통해 실행하세요.
#
# 사용법:
# wsl bash ./install.sh

Write-Host "이 스크립트는 WSL을 통해 실행해야 합니다."
Write-Host "wsl bash ./install.sh"
`;
  }

  /**
   * 로컬 저장소 설정 스크립트 생성
   */
  generateLocalRepoScript(
    packages: OSPackageInfo[],
    packageManager: OSPackageManager,
    repoName: string
  ): GeneratedScripts {
    switch (packageManager) {
      case 'yum':
        return this.generateYumRepoScript(packages, repoName);
      case 'apt':
        return this.generateAptRepoScript(packages, repoName);
      case 'apk':
        return this.generateApkRepoScript(packages, repoName);
    }
  }

  private generateYumRepoScript(packages: OSPackageInfo[], repoName: string): GeneratedScripts {
    const bash = `#!/bin/bash
# DepsSmuggler - YUM 로컬 저장소 설정 스크립트
# 생성 시간: ${new Date().toISOString()}

set -e

SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="\${SCRIPT_DIR}/repo"
REPO_NAME="${repoName}"

echo "로컬 YUM 저장소를 설정합니다..."

# createrepo 설치 확인
if ! command -v createrepo &> /dev/null; then
    echo "createrepo가 설치되어 있지 않습니다."
    echo "먼저 createrepo-c 패키지를 설치해주세요."
    exit 1
fi

# 저장소 메타데이터 생성
echo "저장소 메타데이터 생성 중..."
createrepo "\${REPO_DIR}"

# YUM 저장소 설정 파일 생성
cat > /etc/yum.repos.d/\${REPO_NAME}.repo << EOF
[\${REPO_NAME}]
name=DepsSmuggler Local Repository
baseurl=file://\${REPO_DIR}
enabled=1
gpgcheck=0
EOF

echo ""
echo "로컬 저장소 설정 완료!"
echo "이제 'yum install <패키지명>'으로 설치할 수 있습니다."
`;

    return { bash, powershell: this.getWslNotice() };
  }

  private generateAptRepoScript(packages: OSPackageInfo[], repoName: string): GeneratedScripts {
    const bash = `#!/bin/bash
# DepsSmuggler - APT 로컬 저장소 설정 스크립트
# 생성 시간: ${new Date().toISOString()}

set -e

SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="\${SCRIPT_DIR}/repo"
REPO_NAME="${repoName}"

echo "로컬 APT 저장소를 설정합니다..."

# dpkg-scanpackages 설치 확인
if ! command -v dpkg-scanpackages &> /dev/null; then
    echo "dpkg-dev가 설치되어 있지 않습니다."
    echo "먼저 dpkg-dev 패키지를 설치해주세요."
    exit 1
fi

# Packages 파일 생성
echo "패키지 인덱스 생성 중..."
cd "\${REPO_DIR}"
dpkg-scanpackages . /dev/null | gzip -9c > Packages.gz

# APT 소스 설정
echo "deb [trusted=yes] file://\${REPO_DIR} ./" | sudo tee /etc/apt/sources.list.d/\${REPO_NAME}.list

# 패키지 목록 갱신
sudo apt-get update

echo ""
echo "로컬 저장소 설정 완료!"
echo "이제 'apt install <패키지명>'으로 설치할 수 있습니다."
`;

    return { bash, powershell: this.getWslNotice() };
  }

  private generateApkRepoScript(packages: OSPackageInfo[], repoName: string): GeneratedScripts {
    const bash = `#!/bin/bash
# DepsSmuggler - APK 로컬 저장소 설정 스크립트
# 생성 시간: ${new Date().toISOString()}

set -e

SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="\${SCRIPT_DIR}/repo"

echo "로컬 APK 저장소를 설정합니다..."

# 로컬 저장소 추가
echo "\${REPO_DIR}" >> /etc/apk/repositories

# 인덱스 갱신
apk update --allow-untrusted

echo ""
echo "로컬 저장소 설정 완료!"
echo "이제 'apk add <패키지명>'으로 설치할 수 있습니다."
`;

    return { bash, powershell: this.getWslNotice() };
  }

  private getInstallCommand(pm: OSPackageManager): string {
    switch (pm) {
      case 'yum': return 'rpm -ivh --nodeps';
      case 'apt': return 'dpkg -i';
      case 'apk': return 'apk add --allow-untrusted';
    }
  }

  private getExtension(pm: OSPackageManager): string {
    switch (pm) {
      case 'yum': return 'rpm';
      case 'apt': return 'deb';
      case 'apk': return 'apk';
    }
  }

  private getWslNotice(): string {
    return `# Windows에서는 WSL을 통해 실행하세요.\nWrite-Host "wsl bash ./setup-repo.sh"`;
  }
}

interface GeneratedScripts {
  bash: string;
  powershell: string;
}
```

---

## 9. 출력 형식

### 9.1 아카이브 출력

```typescript
// packager/archive-packager.ts

export class ArchivePackager {
  async createArchive(
    packages: OSPackageInfo[],
    downloadedFiles: Map<string, string>,
    options: ArchiveOptions
  ): Promise<string> {
    const tempDir = await this.prepareDirectory(packages, downloadedFiles);

    if (options.format === 'zip') {
      return await this.createZip(tempDir, options.outputPath);
    } else {
      return await this.createTarGz(tempDir, options.outputPath);
    }
  }

  private async prepareDirectory(
    packages: OSPackageInfo[],
    downloadedFiles: Map<string, string>
  ): Promise<string> {
    const tempDir = path.join(os.tmpdir(), `depssmuggler-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });

    // packages 디렉토리
    const packagesDir = path.join(tempDir, 'packages');
    await fs.mkdir(packagesDir);

    // 패키지 파일 복사
    for (const [pkgKey, filePath] of downloadedFiles) {
      const filename = path.basename(filePath);
      await fs.copyFile(filePath, path.join(packagesDir, filename));
    }

    // 메타데이터 파일
    const metadata = {
      createdAt: new Date().toISOString(),
      generator: 'DepsSmuggler',
      packages: packages.map(p => ({
        name: p.name,
        version: p.version,
        architecture: p.architecture,
        filename: path.basename(p.location),
      })),
    };
    await fs.writeFile(
      path.join(tempDir, 'metadata.json'),
      JSON.stringify(metadata, null, 2)
    );

    return tempDir;
  }
}
```

### 9.2 로컬 저장소 출력

```typescript
// packager/repo-packager.ts

export class RepoPackager {
  async createLocalRepo(
    packages: OSPackageInfo[],
    downloadedFiles: Map<string, string>,
    options: RepoOptions
  ): Promise<string> {
    const repoDir = options.outputPath;
    await fs.mkdir(repoDir, { recursive: true });

    // 패키지 파일 복사
    for (const [, filePath] of downloadedFiles) {
      const filename = path.basename(filePath);
      await fs.copyFile(filePath, path.join(repoDir, filename));
    }

    // 저장소 메타데이터 생성
    switch (options.packageManager) {
      case 'yum':
        await this.createYumRepoMetadata(repoDir);
        break;
      case 'apt':
        await this.createAptRepoMetadata(repoDir);
        break;
      case 'apk':
        await this.createApkRepoMetadata(repoDir);
        break;
    }

    return repoDir;
  }

  private async createYumRepoMetadata(repoDir: string): Promise<void> {
    // createrepo 명령 실행 또는 수동 생성
    // repodata/repomd.xml, primary.xml.gz 등 생성
  }

  private async createAptRepoMetadata(repoDir: string): Promise<void> {
    // Packages.gz, Release 파일 생성
  }

  private async createApkRepoMetadata(repoDir: string): Promise<void> {
    // APKINDEX.tar.gz 생성
  }
}
```

---

## 10. GPG 검증

```typescript
// utils/gpg-verifier.ts

export class GPGVerifier {
  private keyring: Map<string, GPGKey> = new Map();

  /**
   * GPG 키 가져오기
   */
  async importKey(keyUrl: string): Promise<void> {
    const response = await fetch(keyUrl);
    const keyData = await response.text();
    // GPG 키 파싱 및 저장
  }

  /**
   * 패키지 서명 검증 (공식 저장소만)
   */
  async verifyPackage(
    pkg: OSPackageInfo,
    filePath: string
  ): Promise<VerificationResult> {
    // 공식 저장소가 아니면 검증 건너뛰기
    if (!pkg.repository.isOfficial) {
      return { verified: true, skipped: true, reason: 'non-official-repo' };
    }

    if (!pkg.repository.gpgCheck) {
      return { verified: true, skipped: true, reason: 'gpg-disabled' };
    }

    // 실제 GPG 검증 로직
    try {
      // RPM: rpm -K 또는 직접 서명 검증
      // DEB: dpkg-sig --verify 또는 직접 검증
      // APK: APK 서명 검증

      return { verified: true, skipped: false };
    } catch (error) {
      return {
        verified: false,
        skipped: false,
        error: error as Error
      };
    }
  }
}

interface VerificationResult {
  verified: boolean;
  skipped: boolean;
  reason?: string;
  error?: Error;
}
```

---

## 11. 다운로더 통합

```typescript
// index.ts

export class OSPackageDownloader {
  private yumDownloader: YumDownloader;
  private aptDownloader: AptDownloader;
  private apkDownloader: ApkDownloader;
  private cacheManager: CacheManager;
  private gpgVerifier: GPGVerifier;
  private scriptGenerator: ScriptGenerator;

  constructor(options: OSDownloaderOptions) {
    this.cacheManager = new CacheManager(options.cacheConfig);
    this.gpgVerifier = new GPGVerifier();
    this.scriptGenerator = new ScriptGenerator();

    this.yumDownloader = new YumDownloader(this.cacheManager, this.gpgVerifier);
    this.aptDownloader = new AptDownloader(this.cacheManager, this.gpgVerifier);
    this.apkDownloader = new ApkDownloader(this.cacheManager, this.gpgVerifier);
  }

  /**
   * 패키지 검색
   */
  async search(options: OSPackageSearchOptions): Promise<OSPackageSearchResult> {
    const downloader = this.getDownloader(options.distribution.packageManager);
    return await downloader.search(options);
  }

  /**
   * 의존성 해결
   */
  async resolveDependencies(
    packages: OSPackageInfo[],
    distribution: OSDistribution
  ): Promise<DependencyTree> {
    const downloader = this.getDownloader(distribution.packageManager);
    return await downloader.resolveDependencies(packages);
  }

  /**
   * 패키지 다운로드
   */
  async download(options: OSPackageDownloadOptions): Promise<OSPackageDownloadResult> {
    const pm = options.packages[0]?.repository?.packageManager;
    if (!pm) throw new Error('패키지 관리자를 확인할 수 없습니다.');

    const downloader = this.getDownloader(pm);
    return await downloader.download(options);
  }

  /**
   * 출력 생성
   */
  async createOutput(
    result: OSPackageDownloadResult,
    options: OSPackageOutputOptions
  ): Promise<OutputResult> {
    // 아카이브 및 저장소 생성
    // 스크립트 생성
  }

  private getDownloader(pm: OSPackageManager): BaseDownloader {
    switch (pm) {
      case 'yum': return this.yumDownloader;
      case 'apt': return this.aptDownloader;
      case 'apk': return this.apkDownloader;
    }
  }
}
```

---

## 12. 에러 처리

```typescript
// types.ts

export interface DownloadErrorHandler {
  onError: (error: DownloadError) => Promise<ErrorAction>;
}

export class InteractiveErrorHandler implements DownloadErrorHandler {
  constructor(private ui: UserInterface) {}

  async onError(error: DownloadError): Promise<ErrorAction> {
    // UI를 통해 사용자에게 선택 요청
    const choice = await this.ui.showErrorDialog({
      title: '다운로드 오류',
      message: `${error.package.name} 다운로드 중 오류가 발생했습니다.`,
      error: error.error.message,
      retryCount: error.retryCount,
      options: ['재시도', '건너뛰기', '취소'],
    });

    switch (choice) {
      case '재시도': return 'retry';
      case '건너뛰기': return 'skip';
      case '취소': return 'cancel';
      default: return 'skip';
    }
  }
}
```

---

## 13. UI 흐름

```
1. OS 타입 선택
   ├── RHEL/CentOS 계열 (yum)
   ├── Ubuntu/Debian 계열 (apt)
   └── Alpine (apk)

2. OS 버전 선택
   ├── [추천] Rocky Linux 9
   ├── [추천] Ubuntu 22.04 LTS
   ├── 기타 프리셋...
   └── 용도별 추천 보기
       ├── 엔터프라이즈/프로덕션
       ├── 레거시 시스템
       ├── 컨테이너/경량
       └── 개발 환경

3. 아키텍처 선택
   ├── x86_64 / amd64
   ├── aarch64 / arm64
   └── 기타...

4. 저장소 선택
   ├── ✅ 기본 저장소
   ├── ☐ EPEL / Universe
   └── + 사용자 정의 저장소 추가

5. 패키지 검색
   ├── 검색어 입력 (부분 일치, 와일드카드 지원)
   └── 검색 결과에서 선택

6. 버전 선택
   └── 사용 가능한 버전 목록에서 선택

7. 장바구니에 추가
   └── 여러 패키지 선택 가능

8. 의존성 확인
   ├── 의존성 트리 표시
   └── 충돌 시 모든 버전 포함

9. 다운로드 옵션
   ├── 출력 형식 (아카이브/저장소/둘 다)
   └── 스크립트 포함 여부

10. 다운로드 실행
    ├── 진행 상황 표시
    └── 오류 시 사용자 선택 (재시도/건너뛰기/취소)

11. 완료
    └── 출력 파일 경로 표시
```

---

## 14. 다음 단계

1. **Phase 1**: YUM/RPM 다운로더 구현 (MVP)
2. **Phase 2**: APT/DEB 다운로더 구현
3. **Phase 3**: APK 다운로더 구현
4. **Phase 4**: UI 통합 및 테스트
