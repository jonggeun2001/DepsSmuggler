/**
 * 민감 정보 마스킹 유틸리티 테스트 (CWE-532 대응)
 */

import { describe, it, expect } from 'vitest';
import {
  maskString,
  maskObject,
  maskSensitiveData,
  isSensitiveKey,
  mask,
} from './mask';

describe('mask 유틸리티', () => {
  describe('isSensitiveKey', () => {
    it('민감한 키를 감지해야 함', () => {
      expect(isSensitiveKey('password')).toBe(true);
      expect(isSensitiveKey('PASSWORD')).toBe(true);
      expect(isSensitiveKey('Password')).toBe(true);
      expect(isSensitiveKey('token')).toBe(true);
      expect(isSensitiveKey('secret')).toBe(true);
      expect(isSensitiveKey('apiKey')).toBe(true);
      expect(isSensitiveKey('api_key')).toBe(true);
      expect(isSensitiveKey('authorization')).toBe(true);
      expect(isSensitiveKey('credential')).toBe(true);
    });

    it('일반 키는 민감하지 않다고 판단해야 함', () => {
      expect(isSensitiveKey('username')).toBe(false);
      expect(isSensitiveKey('email')).toBe(false);
      expect(isSensitiveKey('name')).toBe(false);
      expect(isSensitiveKey('version')).toBe(false);
      expect(isSensitiveKey('id')).toBe(false);
    });

    it('잘못된 입력 처리', () => {
      expect(isSensitiveKey(null as unknown as string)).toBe(false);
      expect(isSensitiveKey(undefined as unknown as string)).toBe(false);
      expect(isSensitiveKey(123 as unknown as string)).toBe(false);
    });
  });

  describe('maskString', () => {
    it('Bearer 토큰을 마스킹해야 함', () => {
      const input = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
      const result = maskString(input);
      expect(result).toBe('Authorization: Bearer ***MASKED***');
    });

    it('URL 내 민감 파라미터를 마스킹해야 함', () => {
      const input = 'https://api.example.com?user=john&password=secret123&token=abc123';
      const result = maskString(input);
      expect(result).toContain('password=***MASKED***');
      expect(result).toContain('token=***MASKED***');
      expect(result).toContain('user=john');
    });

    it('문자열이 아닌 입력은 그대로 반환', () => {
      expect(maskString(null as unknown as string)).toBeNull();
      expect(maskString(123 as unknown as string)).toBe(123);
    });
  });

  describe('maskObject', () => {
    it('객체 내 민감 필드를 마스킹해야 함', () => {
      const input = {
        username: 'john',
        password: 'secret123',
        email: 'john@example.com',
      };
      const result = maskObject(input) as Record<string, unknown>;

      expect(result.username).toBe('john');
      expect(result.password).toBe('***MASKED***');
      expect(result.email).toBe('john@example.com');
    });

    it('중첩된 객체의 민감 필드를 마스킹해야 함', () => {
      const input = {
        user: {
          name: 'john',
          auth: {
            password: 'secret123',
            token: 'abc123',
          },
        },
      };
      const result = maskObject(input) as { user: { name: string; auth: { password: string; token: string } } };

      expect(result.user.name).toBe('john');
      expect(result.user.auth.password).toBe('***MASKED***');
      expect(result.user.auth.token).toBe('***MASKED***');
    });

    it('배열 내 객체를 처리해야 함', () => {
      const input = [
        { name: 'user1', password: 'pass1' },
        { name: 'user2', password: 'pass2' },
      ];
      const result = maskObject(input) as Array<{ name: string; password: string }>;

      expect(result[0].name).toBe('user1');
      expect(result[0].password).toBe('***MASKED***');
      expect(result[1].name).toBe('user2');
      expect(result[1].password).toBe('***MASKED***');
    });

    it('null과 undefined를 그대로 반환해야 함', () => {
      expect(maskObject(null)).toBeNull();
      expect(maskObject(undefined)).toBeUndefined();
    });

    it('기본 타입을 그대로 반환해야 함', () => {
      expect(maskObject(123)).toBe(123);
      expect(maskObject(true)).toBe(true);
      expect(maskObject('simple string')).toBe('simple string');
    });

    it('Error 객체를 적절히 처리해야 함', () => {
      const error = new Error('Connection failed with password=secret');
      const result = maskObject(error) as { name: string; message: string };

      expect(result.name).toBe('Error');
      expect(result.message).toContain('password=***MASKED***');
    });

    it('Date 객체를 그대로 유지해야 함', () => {
      const date = new Date('2024-01-01');
      const result = maskObject(date);
      expect(result).toEqual(date);
    });

    it('깊은 중첩에서 깊이 제한이 작동해야 함', () => {
      // 매우 깊게 중첩된 객체 생성
      let deepObj: Record<string, unknown> = { value: 'test' };
      for (let i = 0; i < 15; i++) {
        deepObj = { nested: deepObj };
      }

      const result = maskObject(deepObj);
      expect(result).toBeDefined();
    });
  });

  describe('maskSensitiveData', () => {
    it('여러 인자를 처리해야 함', () => {
      const args = ['message', { password: 'secret' }, 123];
      const [msg, obj, num] = maskSensitiveData(...args);

      expect(msg).toBe('message');
      expect((obj as Record<string, unknown>).password).toBe('***MASKED***');
      expect(num).toBe(123);
    });

    it('빈 인자 목록을 처리해야 함', () => {
      const result = maskSensitiveData();
      expect(result).toEqual([]);
    });
  });

  describe('mask', () => {
    it('단일 값을 마스킹해야 함', () => {
      const result = mask({ secret: 'value' }) as Record<string, unknown>;
      expect(result.secret).toBe('***MASKED***');
    });
  });

  describe('SMTP 설정 마스킹', () => {
    it('SMTP 설정의 인증 정보를 마스킹해야 함', () => {
      const smtpConfig = {
        host: 'smtp.example.com',
        port: 587,
        secure: true,
        auth: {
          user: 'admin@example.com',
          pass: 'smtp_password_123',
        },
      };

      const result = maskObject(smtpConfig) as {
        host: string;
        port: number;
        auth: { user: string; pass: string };
      };

      expect(result.host).toBe('smtp.example.com');
      expect(result.port).toBe(587);
      expect(result.auth.user).toBe('admin@example.com');
      expect(result.auth.pass).toBe('***MASKED***');
    });
  });

  describe('API 응답 마스킹', () => {
    it('API 응답의 토큰 정보를 마스킹해야 함', () => {
      const apiResponse = {
        status: 'success',
        data: {
          userId: 123,
          accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
          refreshToken: 'refresh_token_value',
        },
      };

      const result = maskObject(apiResponse) as {
        status: string;
        data: { userId: number; accessToken: string; refreshToken: string };
      };

      expect(result.status).toBe('success');
      expect(result.data.userId).toBe(123);
      expect(result.data.accessToken).toBe('***MASKED***');
      expect(result.data.refreshToken).toBe('***MASKED***');
    });
  });
});
