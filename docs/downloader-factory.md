# Downloader Factory

## 개요
- 목적: 패키지 타입별 다운로더 인스턴스를 중앙에서 관리하는 레지스트리 패턴 구현
- 위치: `src/core/downloaders/factory.ts`
- 기본 downloader 정의 위치: `src/core/downloaders/registry.ts`

---

## 배경

기존에는 각 다운로더가 개별 싱글톤 패턴으로 구현되어 있었으나, 테스트 시 모킹이 어렵고 인스턴스 관리가 분산되어 있었음. Factory 패턴을 도입하여:
- 중앙 집중식 다운로더 관리
- 테스트 시 쉬운 모킹/오버라이드 지원
- downloader 등록의 단일 진실 유지

---

## DownloaderRegistry 클래스

### 속성

| 속성 | 타입 | 설명 |
|------|------|------|
| `instances` | `Map<PackageType, IDownloader>` | 생성된 다운로더 인스턴스 캐시 |
| `creators` | `Map<PackageType, DownloaderCreator>` | 다운로더 생성 함수 |
| `overrides` | `Map<PackageType, IDownloader>` | 테스트용 오버라이드 인스턴스 |

### 메서드

| 메서드 | 파라미터 | 반환값 | 설명 |
|--------|----------|--------|------|
| `registerCreator` | type, creator | void | 다운로더 생성자 등록 |
| `get` | type | IDownloader | 다운로더 인스턴스 가져오기 |
| `has` | type | boolean | 등록된 타입인지 확인 |
| `setOverride` | type, instance | void | 테스트용 오버라이드 설정 |
| `clearOverride` | type | void | 특정 오버라이드 제거 |
| `clearAllOverrides` | - | void | 모든 오버라이드 제거 |
| `clearInstance` | type | void | 캐시된 인스턴스 제거 |
| `clearAllInstances` | - | void | 모든 캐시된 인스턴스 제거 |
| `reset` | - | void | 인스턴스와 오버라이드 초기화 (creators 유지) |
| `fullReset` | - | void | 완전 초기화 (creators 포함) |
| `getRegisteredTypes` | - | PackageType[] | 등록된 패키지 타입 목록 |

### 인스턴스 조회 우선순위

1. **오버라이드된 인스턴스** (테스트용)
2. **기존 캐시된 인스턴스**
3. **새로 생성** (creator 사용)

---

## 편의 함수

| 함수 | 설명 |
|------|------|
| `getDownloaderRegistry()` | 레지스트리 싱글톤 인스턴스 반환 |
| `getDownloader(type)` | 동기적으로 다운로더 가져오기 |
| `getDownloaderAsync(type)` | 비동기적으로 다운로더 가져오기 (초기화 보장) |
| `registerDownloader(type, creator)` | 다운로더 생성자 등록 |
| `initializeDownloaders()` | 모든 기본 다운로더 등록 |
| `resetDownloaderRegistry()` | 레지스트리 초기화 |

### 기본 downloader registry

`src/core/downloaders/registry.ts`는 기본 downloader 타입과 creator를 한 곳에서 정의합니다.

- `getRegisteredDownloaderTypes()`는 등록 대상 타입 목록을 반환합니다.
- `createRegisteredDownloader(type)`는 registry에 정의된 creator로 downloader를 생성합니다.
- `registerDefaultDownloaderCreators(register)`는 factory가 기본 creator를 내부 레지스트리에 복사할 때 사용합니다.

### 테스트 헬퍼 함수

| 함수 | 설명 |
|------|------|
| `setTestDownloader(type, instance)` | 테스트용 다운로더 설정 |
| `clearTestDownloader(type)` | 특정 테스트 다운로더 제거 |
| `clearAllTestDownloaders()` | 모든 테스트 다운로더 제거 |

---

## 사용 예시

### 기본 사용

```typescript
import { getDownloader, initializeDownloaders } from './downloaders/factory';

// 초기화 (앱 시작 시 1회)
initializeDownloaders();

// 다운로더 사용
const pipDownloader = getDownloader('pip');
const results = await pipDownloader.searchPackages('requests');

const mavenDownloader = getDownloader('maven');
const versions = await mavenDownloader.getVersions('org.springframework:spring-core');
```

### 테스트에서 모킹

```typescript
import { setTestDownloader, clearAllTestDownloaders } from './downloaders/factory';

describe('DownloadManager', () => {
  beforeEach(() => {
    // 모킹된 다운로더 설정
    const mockPipDownloader = {
      searchPackages: vi.fn().mockResolvedValue([]),
      downloadPackage: vi.fn().mockResolvedValue({ success: true }),
      // ...
    };
    setTestDownloader('pip', mockPipDownloader as unknown as IDownloader);
  });

  afterEach(() => {
    // 테스트 후 정리
    clearAllTestDownloaders();
  });

  it('should download packages', async () => {
    const downloader = getDownloader('pip');
    // downloader는 mockPipDownloader를 반환함
    await downloader.downloadPackage(...);
    expect(downloader.downloadPackage).toHaveBeenCalled();
  });
});
```

### 비동기 초기화 보장

```typescript
import { getDownloaderAsync } from './downloaders/factory';

// 초기화되지 않았어도 자동으로 초기화 후 반환
const downloader = await getDownloaderAsync('npm');
```

---

## 등록되는 기본 다운로더

`initializeDownloaders()` 호출 시 `registry.ts`를 통해 등록되는 다운로더:

| 타입 | 다운로더 클래스 | 설명 |
|------|----------------|------|
| `pip` | PipDownloader | PyPI 패키지 |
| `conda` | CondaDownloader | Anaconda 패키지 |
| `maven` | MavenDownloader | Maven Central 아티팩트 |
| `npm` | NpmDownloader | npm 패키지 |
| `docker` | DockerDownloader | Docker 이미지 |

`yum`, `apt`, `apk`는 별도의 OS 패키지 downloader 경로에서 옵션과 함께 생성되므로 이 기본 registry에는 포함되지 않습니다.

---

## 관련 문서
- [Downloaders 문서](./downloaders.md)
- [아키텍처 개요](./architecture-overview.md)
- [테스트 구조](./testing.md)
