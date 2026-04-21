import { Architecture } from '../../types';
import { calculateFileChecksum } from '../shared/integrity/checksum';

/**
 * Docker 플랫폼 정보 인터페이스
 */
export interface DockerPlatform {
  architecture: string;
  variant?: string;
}

/**
 * 아키텍처 매핑 (Docker manifest의 platform.architecture 값으로 변환)
 */
export const ARCH_MAP: Record<Architecture, DockerPlatform> = {
  x86_64: { architecture: 'amd64' },
  amd64: { architecture: 'amd64' },
  arm64: { architecture: 'arm64' },
  aarch64: { architecture: 'arm64' },
  i386: { architecture: '386' },
  i686: { architecture: '386' },
  '386': { architecture: '386' },
  'arm/v7': { architecture: 'arm', variant: 'v7' },
  noarch: { architecture: 'amd64' },
  all: { architecture: 'amd64' },
};

/**
 * 지원하는 레지스트리 타입
 */
export type RegistryType = 'docker.io' | 'ghcr.io' | 'ecr' | 'quay.io' | 'custom';

/**
 * 레지스트리 설정 인터페이스
 */
export interface RegistryConfig {
  authUrl: string;
  registryUrl: string;
  service: string;
  hubUrl?: string; // 검색용 Hub URL (Docker Hub만 해당)
}

/**
 * 레지스트리별 설정
 */
export const REGISTRY_CONFIGS: Record<string, RegistryConfig> = {
  'docker.io': {
    authUrl: 'https://auth.docker.io',
    registryUrl: 'https://registry-1.docker.io/v2',
    service: 'registry.docker.io',
    hubUrl: 'https://hub.docker.com/v2',
  },
  'ghcr.io': {
    authUrl: 'https://ghcr.io/token',
    registryUrl: 'https://ghcr.io/v2',
    service: 'ghcr.io',
  },
  ecr: {
    authUrl: 'https://public.ecr.aws/token',
    registryUrl: 'https://public.ecr.aws/v2',
    service: 'public.ecr.aws',
  },
  'quay.io': {
    authUrl: 'https://quay.io/v2/auth',
    registryUrl: 'https://quay.io/v2',
    service: 'quay.io',
  },
};

/**
 * 알려진 레지스트리 목록
 */
const KNOWN_REGISTRIES = ['docker.io', 'quay.io', 'ghcr.io', 'gcr.io', 'public.ecr.aws'];

/**
 * 레지스트리 URL에서 타입 추출
 */
export function getRegistryType(registry: string): RegistryType {
  if (registry === 'docker.io' || registry === 'registry-1.docker.io') {
    return 'docker.io';
  }
  if (registry === 'ghcr.io') {
    return 'ghcr.io';
  }
  if (registry === 'public.ecr.aws' || registry === 'ecr') {
    return 'ecr';
  }
  if (registry === 'quay.io') {
    return 'quay.io';
  }
  return 'custom';
}

/**
 * 커스텀 레지스트리 설정 생성
 */
export function createCustomRegistryConfig(registryUrl: string): RegistryConfig {
  const url = registryUrl.startsWith('http') ? registryUrl : `https://${registryUrl}`;
  const baseUrl = url.replace(/\/v2\/?$/, '');
  return {
    authUrl: `${baseUrl}/v2/auth`,
    registryUrl: `${baseUrl}/v2`,
    service: new URL(baseUrl).hostname,
  };
}

/**
 * 이미지 이름에서 레지스트리 추출
 */
export function extractRegistry(fullName: string): { registry: string | null; imageName: string } {
  const parts = fullName.split('/');

  if (parts.length > 1) {
    const firstPart = parts[0];
    // 알려진 레지스트리거나 점이 포함된 경우 레지스트리로 간주
    if (KNOWN_REGISTRIES.includes(firstPart) || firstPart.includes('.')) {
      return {
        registry: firstPart,
        imageName: parts.slice(1).join('/'),
      };
    }
  }

  return { registry: null, imageName: fullName };
}

/**
 * 이미지 이름 파싱 (네임스페이스/이름 분리)
 */
export function parseImageName(name: string): [string, string] {
  // 먼저 레지스트리 제거
  const { imageName } = extractRegistry(name);

  if (imageName.includes('/')) {
    const parts = imageName.split('/');
    if (parts.length === 2) {
      return [parts[0], parts[1]];
    }
    // 여러 depth인 경우 (예: coreos/etcd/subpath)
    return [parts.slice(0, -1).join('/'), parts[parts.length - 1]];
  }
  // library 이미지 (예: nginx, ubuntu)
  return ['library', imageName];
}

/**
 * 파일의 SHA256 해시 계산
 */
export function calculateSha256(filePath: string): Promise<string> {
  return calculateFileChecksum(filePath, 'sha256');
}
