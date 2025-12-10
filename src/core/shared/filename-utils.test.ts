/**
 * Windows 호환 파일명 처리 유틸리티 테스트
 */

import { describe, it, expect } from 'vitest';
import {
  sanitizeFilename,
  sanitizeCacheKey,
  sanitizeDockerTag,
  isPathLengthValid,
  getPathLengthWarning,
  toLongPath,
  getExtension,
  removeExtension,
} from './filename-utils';

describe('filename-utils', () => {
  describe('sanitizeFilename', () => {
    it('Windows 금지 문자 제거', () => {
      expect(sanitizeFilename('file<name')).toBe('file_name');
      expect(sanitizeFilename('file>name')).toBe('file_name');
      expect(sanitizeFilename('file:name')).toBe('file_name');
      expect(sanitizeFilename('file"name')).toBe('file_name');
      expect(sanitizeFilename('file/name')).toBe('file_name');
      expect(sanitizeFilename('file\\name')).toBe('file_name');
      expect(sanitizeFilename('file|name')).toBe('file_name');
      expect(sanitizeFilename('file?name')).toBe('file_name');
      expect(sanitizeFilename('file*name')).toBe('file_name');
    });

    it('여러 금지 문자가 포함된 경우', () => {
      expect(sanitizeFilename('file<>:"name')).toBe('file_name');
      expect(sanitizeFilename('a<b>c:d"e/f\\g|h?i*j')).toBe('a_b_c_d_e_f_g_h_i_j');
    });

    it('Windows 예약어 처리', () => {
      expect(sanitizeFilename('CON')).toBe('_CON');
      expect(sanitizeFilename('con')).toBe('_con');
      expect(sanitizeFilename('PRN')).toBe('_PRN');
      expect(sanitizeFilename('AUX')).toBe('_AUX');
      expect(sanitizeFilename('NUL')).toBe('_NUL');
      expect(sanitizeFilename('COM1')).toBe('_COM1');
      expect(sanitizeFilename('LPT1')).toBe('_LPT1');
    });

    it('확장자가 있는 예약어 처리', () => {
      expect(sanitizeFilename('CON.txt')).toBe('_CON.txt');
      expect(sanitizeFilename('nul.exe')).toBe('_nul.exe');
    });

    it('마침표로 끝나는 파일명 처리', () => {
      expect(sanitizeFilename('file.')).toBe('file');
      expect(sanitizeFilename('file...')).toBe('file');
      expect(sanitizeFilename('file. . .')).toBe('file');
    });

    it('공백으로 끝나는 파일명 처리', () => {
      expect(sanitizeFilename('file ')).toBe('file');
      expect(sanitizeFilename('file   ')).toBe('file');
    });

    it('긴 파일명 처리', () => {
      const longName = 'a'.repeat(300);
      expect(sanitizeFilename(longName).length).toBeLessThanOrEqual(200);
    });

    it('확장자 보존하며 길이 제한', () => {
      const longName = 'a'.repeat(300) + '.txt';
      const result = sanitizeFilename(longName);
      expect(result.length).toBeLessThanOrEqual(200);
      expect(result.endsWith('.txt')).toBe(true);
    });

    it('빈 문자열 처리', () => {
      expect(sanitizeFilename('')).toBe('_empty_');
    });

    it('금지 문자만 있는 경우', () => {
      expect(sanitizeFilename('<<<>>>')).toBe('_unnamed_');
    });

    it('실제 패키지명 변환', () => {
      // npm scoped package (@ is allowed in Windows filenames)
      expect(sanitizeFilename('@types/node')).toBe('@types_node');

      // Maven artifact
      expect(sanitizeFilename('org.springframework:spring-core:5.3.0')).toBe(
        'org.springframework_spring-core_5.3.0'
      );

      // Docker image
      expect(sanitizeFilename('library/nginx:latest')).toBe('library_nginx_latest');
    });

    it('한글 파일명 유지', () => {
      expect(sanitizeFilename('테스트파일.txt')).toBe('테스트파일.txt');
      expect(sanitizeFilename('한글<이름>.txt')).toBe('한글_이름_.txt');
    });

    it('숫자로 시작하는 파일명 유지', () => {
      expect(sanitizeFilename('123file.txt')).toBe('123file.txt');
    });
  });

  describe('sanitizeCacheKey', () => {
    it('알파벳, 숫자, 점, 대시, 언더스코어만 허용', () => {
      expect(sanitizeCacheKey('file-name_v1.0')).toBe('file-name_v1.0');
      expect(sanitizeCacheKey('file@name#v1')).toBe('file_name_v1');
    });

    it('한글 제거', () => {
      expect(sanitizeCacheKey('테스트file')).toBe('file');
    });

    it('최대 길이 기본값 100', () => {
      const longName = 'a'.repeat(150);
      expect(sanitizeCacheKey(longName).length).toBeLessThanOrEqual(100);
    });

    it('빈 문자열 처리', () => {
      expect(sanitizeCacheKey('')).toBe('_empty_');
    });
  });

  describe('sanitizeDockerTag', () => {
    it('Docker 태그 변환', () => {
      expect(sanitizeDockerTag('nginx:latest')).toBe('nginx_latest');
      expect(sanitizeDockerTag('library/nginx:1.25')).toBe('library_nginx_1.25');
      expect(sanitizeDockerTag('ghcr.io/owner/image:v1.0.0')).toBe('ghcr.io_owner_image_v1.0.0');
    });
  });

  describe('isPathLengthValid', () => {
    it('260자 이하 경로는 유효', () => {
      const shortPath = 'C:\\Users\\test\\' + 'a'.repeat(100);
      expect(isPathLengthValid(shortPath)).toBe(true);
    });

    it('260자 초과 경로는 무효', () => {
      const longPath = 'C:\\Users\\test\\' + 'a'.repeat(260);
      expect(isPathLengthValid(longPath)).toBe(false);
    });

    it('정확히 260자는 유효', () => {
      const exactPath = 'a'.repeat(260);
      expect(isPathLengthValid(exactPath)).toBe(true);
    });

    it('커스텀 최대 길이 지원', () => {
      expect(isPathLengthValid('a'.repeat(100), 50)).toBe(false);
      expect(isPathLengthValid('a'.repeat(50), 100)).toBe(true);
    });
  });

  describe('getPathLengthWarning', () => {
    it('200자 이하는 경고 없음', () => {
      expect(getPathLengthWarning('a'.repeat(200))).toBe(null);
    });

    it('200-260자는 경고', () => {
      const warning = getPathLengthWarning('a'.repeat(250));
      expect(warning).toContain('문제가 발생할 수 있습니다');
    });

    it('260자 초과는 오류 메시지', () => {
      const warning = getPathLengthWarning('a'.repeat(300));
      expect(warning).toContain('너무 깁니다');
      expect(warning).toContain('260자');
    });
  });

  describe('toLongPath', () => {
    it('짧은 경로는 그대로 반환', () => {
      const shortPath = 'C:\\Users\\test\\file.txt';
      expect(toLongPath(shortPath)).toBe(shortPath);
    });

    it('이미 UNC 경로인 경우 그대로 반환', () => {
      const uncPath = '\\\\?\\C:\\Users\\test\\file.txt';
      expect(toLongPath(uncPath)).toBe(uncPath);
    });

    // Windows에서만 테스트 가능
    if (process.platform === 'win32') {
      it('긴 경로에 UNC 접두사 추가 (Windows)', () => {
        const longPath = 'C:\\' + 'a'.repeat(300);
        expect(toLongPath(longPath)).toMatch(/^\\\\\?\\/);
      });
    }
  });

  describe('getExtension', () => {
    it('일반 확장자 추출', () => {
      expect(getExtension('file.txt')).toBe('.txt');
      expect(getExtension('file.tar.gz')).toBe('.gz');
      expect(getExtension('document.pdf')).toBe('.pdf');
    });

    it('확장자 없는 파일', () => {
      expect(getExtension('file')).toBe('');
      expect(getExtension('Makefile')).toBe('');
    });

    it('점으로 시작하는 파일', () => {
      expect(getExtension('.gitignore')).toBe('.gitignore');
      expect(getExtension('.env.local')).toBe('.local');
    });
  });

  describe('removeExtension', () => {
    it('확장자 제거', () => {
      expect(removeExtension('file.txt')).toBe('file');
      expect(removeExtension('file.tar.gz')).toBe('file.tar');
    });

    it('확장자 없는 파일', () => {
      expect(removeExtension('file')).toBe('file');
    });
  });
});
