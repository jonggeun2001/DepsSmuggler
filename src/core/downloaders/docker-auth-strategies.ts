/**
 * Docker Registry 인증 전략 패턴 구현
 *
 * 각 레지스트리별 인증 로직을 개별 전략 클래스로 분리
 * OCP(개방-폐쇄 원칙) 준수: 새 레지스트리 추가 시 기존 코드 수정 없이 확장 가능
 */

import axios from 'axios';
import logger from '../../utils/logger';
import { RegistryConfig, RegistryType, REGISTRY_CONFIGS, createCustomRegistryConfig } from './docker-utils';

/**
 * 토큰 응답 인터페이스
 */
export interface TokenResponse {
  token: string;
  expires_in?: number;
}

/**
 * 인증 결과 인터페이스
 */
export interface AuthResult {
  token: string;
  expiresIn: number; // 초 단위
}

/**
 * Registry 인증 전략 인터페이스
 */
export interface RegistryAuthStrategy {
  /** 이 전략이 적용 가능한 레지스트리 타입인지 확인 */
  isApplicable(registryType: RegistryType): boolean;

  /** 토큰 획득 */
  getToken(config: RegistryConfig, repository: string): Promise<AuthResult>;
}

/**
 * Docker Hub 인증 전략
 */
export class DockerHubAuthStrategy implements RegistryAuthStrategy {
  isApplicable(registryType: RegistryType): boolean {
    return registryType === 'docker.io';
  }

  async getToken(config: RegistryConfig, repository: string): Promise<AuthResult> {
    const response = await axios.get<TokenResponse>(`${config.authUrl}/token`, {
      params: {
        service: config.service,
        scope: repository ? `repository:${repository}:pull` : '',
      },
    });

    return {
      token: response.data.token,
      expiresIn: response.data.expires_in || 300,
    };
  }
}

/**
 * GitHub Container Registry (ghcr.io) 인증 전략
 */
export class GHCRAuthStrategy implements RegistryAuthStrategy {
  isApplicable(registryType: RegistryType): boolean {
    return registryType === 'ghcr.io';
  }

  async getToken(config: RegistryConfig, repository: string): Promise<AuthResult> {
    const response = await axios.get<TokenResponse>(config.authUrl, {
      params: {
        service: config.service,
        scope: repository ? `repository:${repository}:pull` : '',
      },
    });

    return {
      token: response.data.token,
      expiresIn: response.data.expires_in || 300,
    };
  }
}

/**
 * AWS ECR Public 인증 전략
 */
export class ECRAuthStrategy implements RegistryAuthStrategy {
  isApplicable(registryType: RegistryType): boolean {
    return registryType === 'ecr';
  }

  async getToken(config: RegistryConfig, repository: string): Promise<AuthResult> {
    const response = await axios.get<TokenResponse>(config.authUrl, {
      params: {
        service: config.service,
        scope: repository ? `repository:${repository}:pull` : '',
      },
    });

    return {
      token: response.data.token,
      expiresIn: response.data.expires_in || 300,
    };
  }
}

/**
 * Quay.io 인증 전략
 * WWW-Authenticate 헤더에서 토큰 URL을 동적으로 파싱
 */
export class QuayAuthStrategy implements RegistryAuthStrategy {
  isApplicable(registryType: RegistryType): boolean {
    return registryType === 'quay.io';
  }

  async getToken(config: RegistryConfig, repository: string): Promise<AuthResult> {
    try {
      // 401 응답에서 WWW-Authenticate 헤더 파싱
      const authResponse = await axios.get(`${config.registryUrl}/`, {
        validateStatus: (status) => status === 401,
      });

      const wwwAuth = authResponse.headers['www-authenticate'];
      if (wwwAuth) {
        const realmMatch = wwwAuth.match(/realm="([^"]+)"/);
        const serviceMatch = wwwAuth.match(/service="([^"]+)"/);

        if (realmMatch) {
          const realm = realmMatch[1];
          const service = serviceMatch?.[1] || config.service;

          const tokenResponse = await axios.get<TokenResponse>(realm, {
            params: {
              service,
              scope: repository ? `repository:${repository}:pull` : '',
            },
          });

          return {
            token: tokenResponse.data.token,
            expiresIn: tokenResponse.data.expires_in || 300,
          };
        }
      }

      // Public 이미지의 경우 토큰 없이 접근 가능
      return { token: '', expiresIn: 300 };
    } catch (error) {
      logger.debug('Quay.io 토큰 획득 실패, anonymous 접근 시도', { error });
      return { token: '', expiresIn: 300 };
    }
  }
}

/**
 * 커스텀 레지스트리 인증 전략 (기본/폴백)
 */
export class CustomRegistryAuthStrategy implements RegistryAuthStrategy {
  isApplicable(registryType: RegistryType): boolean {
    return registryType === 'custom';
  }

  async getToken(config: RegistryConfig, repository: string): Promise<AuthResult> {
    try {
      const response = await axios.get<TokenResponse>(config.authUrl, {
        params: {
          service: config.service,
          scope: repository ? `repository:${repository}:pull` : '',
        },
      });

      return {
        token: response.data.token,
        expiresIn: response.data.expires_in || 300,
      };
    } catch (error) {
      // 인증 없이 접근 시도 (private registry에서 anonymous 허용 시)
      logger.debug('커스텀 레지스트리 토큰 획득 실패, anonymous 접근 시도', { error });
      return { token: '', expiresIn: 300 };
    }
  }
}

/**
 * 기본 전략 목록 (우선순위 순)
 */
const DEFAULT_STRATEGIES: RegistryAuthStrategy[] = [
  new DockerHubAuthStrategy(),
  new GHCRAuthStrategy(),
  new ECRAuthStrategy(),
  new QuayAuthStrategy(),
  new CustomRegistryAuthStrategy(), // 폴백으로 항상 마지막
];

/**
 * 전략 레지스트리: 레지스트리 타입에 맞는 전략 선택
 */
export class AuthStrategyRegistry {
  private strategies: RegistryAuthStrategy[];

  constructor(strategies?: RegistryAuthStrategy[]) {
    this.strategies = strategies || [...DEFAULT_STRATEGIES];
  }

  /**
   * 새 전략 추가 (맨 앞에 추가하여 우선순위 부여)
   */
  registerStrategy(strategy: RegistryAuthStrategy): void {
    this.strategies.unshift(strategy);
  }

  /**
   * 레지스트리 타입에 맞는 전략 선택
   */
  getStrategy(registryType: RegistryType): RegistryAuthStrategy {
    const strategy = this.strategies.find((s) => s.isApplicable(registryType));
    if (!strategy) {
      // CustomRegistryAuthStrategy가 항상 폴백으로 존재하므로 도달하지 않음
      throw new Error(`No auth strategy found for registry type: ${registryType}`);
    }
    return strategy;
  }

  /**
   * 현재 등록된 전략 목록
   */
  getStrategies(): readonly RegistryAuthStrategy[] {
    return this.strategies;
  }
}

/**
 * 기본 전략 레지스트리 인스턴스
 */
export const defaultAuthStrategyRegistry = new AuthStrategyRegistry();
