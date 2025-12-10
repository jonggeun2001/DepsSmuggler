/**
 * 크로스 플랫폼 경로 처리 유틸리티 테스트
 */

import { describe, it, expect } from 'vitest';
import {
  normalizePath,
  toWindowsPath,
  toUnixPath,
  stripLeadingDotSlash,
  ensureForwardSlashForArchive,
  getRelativePath,
  joinAndNormalize,
  toPowerShellPath,
  psJoinPath,
  psQuotePath,
  toBashPath,
  toScriptPath,
  isWindows,
  isMac,
  isLinux,
  pathSeparator,
  getFileMode,
  getWriteOptions,
} from './path-utils';

describe('path-utils', () => {
  describe('normalizePath', () => {
    it('Windows 경로를 forward slash로 변환', () => {
      expect(normalizePath('C:\\Users\\test\\file.txt')).toBe('C:/Users/test/file.txt');
    });

    it('Unix 경로는 그대로 유지', () => {
      expect(normalizePath('/home/user/file.txt')).toBe('/home/user/file.txt');
    });

    it('혼합 경로를 정규화', () => {
      expect(normalizePath('C:\\Users/test\\file.txt')).toBe('C:/Users/test/file.txt');
    });

    it('상대 경로 정규화', () => {
      expect(normalizePath('./packages/file.txt')).toBe('packages/file.txt');
    });

    it('상위 디렉토리 참조 정규화', () => {
      expect(normalizePath('foo/../bar/file.txt')).toBe('bar/file.txt');
    });
  });

  describe('toWindowsPath', () => {
    it('슬래시를 백슬래시로 변환', () => {
      expect(toWindowsPath('/home/user/file.txt')).toBe('\\home\\user\\file.txt');
    });

    it('이미 Windows 경로면 그대로 유지', () => {
      expect(toWindowsPath('C:\\Users\\test')).toBe('C:\\Users\\test');
    });

    it('혼합 경로 변환', () => {
      expect(toWindowsPath('C:/Users/test')).toBe('C:\\Users\\test');
    });
  });

  describe('toUnixPath', () => {
    it('백슬래시를 슬래시로 변환', () => {
      expect(toUnixPath('C:\\Users\\test\\file.txt')).toBe('C:/Users/test/file.txt');
    });

    it('이미 Unix 경로면 그대로 유지', () => {
      expect(toUnixPath('/home/user/file.txt')).toBe('/home/user/file.txt');
    });
  });

  describe('stripLeadingDotSlash', () => {
    it('Unix 스타일 ./ 제거', () => {
      expect(stripLeadingDotSlash('./packages')).toBe('packages');
    });

    it('Windows 스타일 .\\ 제거', () => {
      expect(stripLeadingDotSlash('.\\packages')).toBe('packages');
    });

    it('선행 ./ 없으면 그대로 유지', () => {
      expect(stripLeadingDotSlash('packages')).toBe('packages');
    });

    it('절대 경로는 그대로 유지', () => {
      expect(stripLeadingDotSlash('/absolute/path')).toBe('/absolute/path');
      expect(stripLeadingDotSlash('C:\\absolute\\path')).toBe('C:\\absolute\\path');
    });

    it('중첩된 상대 경로는 첫 번째만 제거', () => {
      expect(stripLeadingDotSlash('./a/./b')).toBe('a/./b');
    });
  });

  describe('ensureForwardSlashForArchive', () => {
    it('ZIP 아카이브용 경로 변환', () => {
      expect(ensureForwardSlashForArchive('packages\\file.txt')).toBe('packages/file.txt');
    });

    it('이미 슬래시면 그대로', () => {
      expect(ensureForwardSlashForArchive('packages/file.txt')).toBe('packages/file.txt');
    });
  });

  describe('joinAndNormalize', () => {
    it('경로 결합 후 forward slash 정규화', () => {
      const result = joinAndNormalize('packages', 'pip', 'requests.whl');
      expect(result).toBe('packages/pip/requests.whl');
    });
  });

  describe('toPowerShellPath', () => {
    it('PowerShell용 경로 변환', () => {
      expect(toPowerShellPath('./packages/file.txt')).toBe('.\\packages\\file.txt');
    });
  });

  describe('psJoinPath', () => {
    it('PowerShell Join-Path 구문 생성', () => {
      expect(psJoinPath('$ScriptDir', 'packages')).toBe(
        "Join-Path -Path $ScriptDir -ChildPath 'packages'"
      );
    });

    it('작은따옴표 이스케이프', () => {
      expect(psJoinPath('$Dir', "it's a test")).toBe(
        "Join-Path -Path $Dir -ChildPath 'it''s a test'"
      );
    });
  });

  describe('psQuotePath', () => {
    it('경로를 작은따옴표로 감싸기', () => {
      expect(psQuotePath('C:\\Program Files\\App')).toBe("'C:\\Program Files\\App'");
    });

    it('내부 작은따옴표 이스케이프', () => {
      expect(psQuotePath("It's a test")).toBe("'It''s a test'");
    });
  });

  describe('toBashPath', () => {
    it('Bash용 경로 변환', () => {
      expect(toBashPath('.\\packages\\file.txt')).toBe('./packages/file.txt');
    });
  });

  describe('toScriptPath', () => {
    it('bash 스크립트용 경로', () => {
      expect(toScriptPath('.\\packages', 'bash')).toBe('./packages');
    });

    it('powershell 스크립트용 경로', () => {
      expect(toScriptPath('./packages', 'powershell')).toBe('.\\packages');
    });
  });

  describe('플랫폼 감지', () => {
    it('플랫폼 상수가 존재', () => {
      expect(typeof isWindows).toBe('boolean');
      expect(typeof isMac).toBe('boolean');
      expect(typeof isLinux).toBe('boolean');
    });

    it('하나의 플랫폼만 true이거나 모두 false (예: 기타 플랫폼)', () => {
      const platforms = [isWindows, isMac, isLinux].filter(Boolean);
      expect(platforms.length).toBeLessThanOrEqual(1);
    });

    it('pathSeparator가 / 또는 \\', () => {
      expect(['/', '\\']).toContain(pathSeparator);
    });
  });

  describe('엣지 케이스', () => {
    it('빈 문자열 처리', () => {
      expect(normalizePath('')).toBe('.');
      expect(toWindowsPath('')).toBe('');
      expect(toUnixPath('')).toBe('');
      expect(stripLeadingDotSlash('')).toBe('');
    });

    it('연속된 구분자 처리', () => {
      // path.normalize()는 Unix에서 연속 슬래시를 유지할 수 있음
      // 백슬래시는 슬래시로 변환됨
      const result = normalizePath('a//b\\\\c');
      expect(result).toMatch(/^a\/+b\/+c$/);
    });

    it('공백이 포함된 경로', () => {
      expect(toWindowsPath('/Program Files/My App')).toBe('\\Program Files\\My App');
      expect(toUnixPath('C:\\Program Files\\My App')).toBe('C:/Program Files/My App');
    });

    it('한글 경로', () => {
      expect(toUnixPath('C:\\사용자\\문서')).toBe('C:/사용자/문서');
      expect(toWindowsPath('/home/사용자/문서')).toBe('\\home\\사용자\\문서');
    });

    it('UNC 경로', () => {
      expect(toUnixPath('\\\\server\\share\\file.txt')).toBe('//server/share/file.txt');
    });
  });

  describe('플랫폼별 테스트', () => {
    it('isWindows, isMac, isLinux 상수가 올바름', () => {
      // 하나만 true이거나 모두 false (기타 플랫폼)
      const trueCount = [isWindows, isMac, isLinux].filter(Boolean).length;
      expect(trueCount).toBeLessThanOrEqual(1);

      // 현재 플랫폼과 일치하는지 확인
      if (process.platform === 'win32') {
        expect(isWindows).toBe(true);
      } else if (process.platform === 'darwin') {
        expect(isMac).toBe(true);
      } else if (process.platform === 'linux') {
        expect(isLinux).toBe(true);
      }
    });

    it('getFileMode가 플랫폼에 맞게 동작', () => {
      if (isWindows) {
        expect(getFileMode(true)).toBeUndefined();
        expect(getFileMode(false)).toBeUndefined();
      } else {
        expect(getFileMode(true)).toBe(0o755);
        expect(getFileMode(false)).toBe(0o644);
      }
    });

    it('getWriteOptions가 플랫폼에 맞게 동작', () => {
      const execOptions = getWriteOptions(true);
      const normalOptions = getWriteOptions(false);

      expect(execOptions.encoding).toBe('utf-8');
      expect(normalOptions.encoding).toBe('utf-8');

      if (isWindows) {
        expect(execOptions.mode).toBeUndefined();
        expect(normalOptions.mode).toBeUndefined();
      } else {
        expect(execOptions.mode).toBe(0o755);
        expect(normalOptions.mode).toBe(0o644);
      }
    });
  });
});
