import { describe, it, expect, beforeEach } from 'vitest';
import { getArchivePackager } from './archivePackager';
import { getFileSplitter } from './fileSplitter';
import { getScriptGenerator } from './scriptGenerator';

describe('archivePackager', () => {
  let packager: ReturnType<typeof getArchivePackager>;

  beforeEach(() => {
    packager = getArchivePackager();
  });

  describe('getArchivePackager', () => {
    it('싱글톤 인스턴스 반환', () => {
      const instance1 = getArchivePackager();
      const instance2 = getArchivePackager();
      expect(instance1).toBe(instance2);
    });
  });
});

describe('fileSplitter', () => {
  let splitter: ReturnType<typeof getFileSplitter>;

  beforeEach(() => {
    splitter = getFileSplitter();
  });

  describe('getFileSplitter', () => {
    it('싱글톤 인스턴스 반환', () => {
      const instance1 = getFileSplitter();
      const instance2 = getFileSplitter();
      expect(instance1).toBe(instance2);
    });

    it('needsSplit 메서드 존재', () => {
      expect(typeof splitter.needsSplit).toBe('function');
    });

    it('estimatePartCount 메서드 존재', () => {
      expect(typeof splitter.estimatePartCount).toBe('function');
    });
  });
});

describe('scriptGenerator', () => {
  let generator: ReturnType<typeof getScriptGenerator>;

  beforeEach(() => {
    generator = getScriptGenerator();
  });

  describe('getScriptGenerator', () => {
    it('싱글톤 인스턴스 반환', () => {
      const instance1 = getScriptGenerator();
      const instance2 = getScriptGenerator();
      expect(instance1).toBe(instance2);
    });
  });
});

// 패키저 유틸리티 로직 테스트
describe('packager utilities', () => {
  describe('file split utilities', () => {
    const DEFAULT_CHUNK_SIZE_MB = 25;

    const needsSplit = (fileSize: number, maxSizeMB: number = DEFAULT_CHUNK_SIZE_MB): boolean => {
      return fileSize > maxSizeMB * 1024 * 1024;
    };

    const estimatePartCount = (
      fileSize: number,
      maxSizeMB: number = DEFAULT_CHUNK_SIZE_MB
    ): number => {
      const maxSizeBytes = maxSizeMB * 1024 * 1024;
      return Math.ceil(fileSize / maxSizeBytes);
    };

    it('기본 청크 크기보다 큰 파일은 분할 필요', () => {
      expect(needsSplit(30 * 1024 * 1024)).toBe(true);
    });

    it('기본 청크 크기보다 작은 파일은 분할 불필요', () => {
      expect(needsSplit(10 * 1024 * 1024)).toBe(false);
    });

    it('커스텀 청크 크기로 분할 필요 여부 확인', () => {
      expect(needsSplit(15 * 1024 * 1024, 10)).toBe(true);
    });

    it('파일 크기에 따른 분할 파트 수 계산', () => {
      expect(estimatePartCount(50 * 1024 * 1024)).toBe(2);
    });

    it('나누어 떨어지지 않으면 올림', () => {
      expect(estimatePartCount(60 * 1024 * 1024)).toBe(3);
    });

    it('커스텀 청크 크기로 파트 수 계산', () => {
      expect(estimatePartCount(100 * 1024 * 1024, 10)).toBe(10);
    });
  });

  describe('archive format detection', () => {
    const getExtension = (filename: string): string => {
      const match = filename.match(/\.(tar\.gz|tar\.bz2|tar\.xz|zip|tar|gz|bz2|xz)$/i);
      return match ? match[1].toLowerCase() : '';
    };

    const isValidArchiveFormat = (format: string): boolean => {
      const validFormats = ['zip', 'tar.gz', 'tar.bz2', 'tar.xz', 'tar', 'gz'];
      return validFormats.includes(format.toLowerCase());
    };

    it('zip 확장자 감지', () => {
      expect(getExtension('archive.zip')).toBe('zip');
    });

    it('tar.gz 확장자 감지', () => {
      expect(getExtension('archive.tar.gz')).toBe('tar.gz');
    });

    it('tar.bz2 확장자 감지', () => {
      expect(getExtension('archive.tar.bz2')).toBe('tar.bz2');
    });

    it('대소문자 무시', () => {
      expect(getExtension('archive.ZIP')).toBe('zip');
      expect(getExtension('archive.TAR.GZ')).toBe('tar.gz');
    });

    it('알 수 없는 확장자', () => {
      expect(getExtension('archive.rar')).toBe('');
      expect(getExtension('archive.7z')).toBe('');
    });

    it('유효한 아카이브 형식 검증', () => {
      expect(isValidArchiveFormat('zip')).toBe(true);
      expect(isValidArchiveFormat('tar.gz')).toBe(true);
      expect(isValidArchiveFormat('tar.bz2')).toBe(true);
    });

    it('유효하지 않은 아카이브 형식', () => {
      expect(isValidArchiveFormat('rar')).toBe(false);
      expect(isValidArchiveFormat('7z')).toBe(false);
    });
  });

  describe('file size formatting', () => {
    const formatFileSize = (bytes: number): string => {
      if (bytes === 0) return '0 B';
      const units = ['B', 'KB', 'MB', 'GB', 'TB'];
      const k = 1024;
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      const size = bytes / Math.pow(k, i);
      return `${size.toFixed(i > 0 ? 2 : 0)} ${units[i]}`;
    };

    it('바이트 포맷팅', () => {
      expect(formatFileSize(500)).toBe('500 B');
    });

    it('킬로바이트 포맷팅', () => {
      expect(formatFileSize(1536)).toBe('1.50 KB');
    });

    it('메가바이트 포맷팅', () => {
      expect(formatFileSize(1048576)).toBe('1.00 MB');
    });

    it('기가바이트 포맷팅', () => {
      expect(formatFileSize(1073741824)).toBe('1.00 GB');
    });

    it('0바이트 포맷팅', () => {
      expect(formatFileSize(0)).toBe('0 B');
    });
  });

  describe('checksum calculation helpers', () => {
    const isValidSha256 = (hash: string): boolean => {
      return /^[a-f0-9]{64}$/i.test(hash);
    };

    const isValidMd5 = (hash: string): boolean => {
      return /^[a-f0-9]{32}$/i.test(hash);
    };

    it('유효한 SHA256 해시', () => {
      expect(isValidSha256('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')).toBe(
        true
      );
    });

    it('유효하지 않은 SHA256 해시 - 길이 오류', () => {
      expect(isValidSha256('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b')).toBe(
        false
      );
    });

    it('유효하지 않은 SHA256 해시 - 잘못된 문자', () => {
      expect(isValidSha256('g3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')).toBe(
        false
      );
    });

    it('유효한 MD5 해시', () => {
      expect(isValidMd5('d41d8cd98f00b204e9800998ecf8427e')).toBe(true);
    });

    it('유효하지 않은 MD5 해시', () => {
      expect(isValidMd5('d41d8cd98f00b204e9800998ecf842')).toBe(false);
    });
  });

  describe('manifest structure', () => {
    interface PackageManifest {
      version: string;
      createdAt: string;
      packages: Array<{
        name: string;
        version: string;
        type: string;
        filename: string;
        checksum?: string;
      }>;
      totalSize: number;
    }

    const createManifest = (
      packages: Array<{ name: string; version: string; type: string; filename: string; size: number }>
    ): PackageManifest => {
      return {
        version: '1.0',
        createdAt: new Date().toISOString(),
        packages: packages.map((p) => ({
          name: p.name,
          version: p.version,
          type: p.type,
          filename: p.filename,
        })),
        totalSize: packages.reduce((sum, p) => sum + p.size, 0),
      };
    };

    const validateManifest = (manifest: PackageManifest): boolean => {
      if (!manifest.version || !manifest.createdAt || !manifest.packages) return false;
      if (!Array.isArray(manifest.packages)) return false;
      return manifest.packages.every(
        (p) => p.name && p.version && p.type && p.filename
      );
    };

    it('매니페스트 생성', () => {
      const manifest = createManifest([
        { name: 'requests', version: '2.28.0', type: 'pip', filename: 'requests-2.28.0.whl', size: 1000 },
      ]);
      expect(manifest.version).toBe('1.0');
      expect(manifest.packages.length).toBe(1);
      expect(manifest.totalSize).toBe(1000);
    });

    it('여러 패키지 매니페스트', () => {
      const manifest = createManifest([
        { name: 'requests', version: '2.28.0', type: 'pip', filename: 'requests-2.28.0.whl', size: 1000 },
        { name: 'numpy', version: '1.23.0', type: 'pip', filename: 'numpy-1.23.0.whl', size: 2000 },
      ]);
      expect(manifest.packages.length).toBe(2);
      expect(manifest.totalSize).toBe(3000);
    });

    it('매니페스트 검증 - 유효', () => {
      const manifest: PackageManifest = {
        version: '1.0',
        createdAt: '2024-01-01T00:00:00.000Z',
        packages: [{ name: 'test', version: '1.0', type: 'pip', filename: 'test-1.0.whl' }],
        totalSize: 1000,
      };
      expect(validateManifest(manifest)).toBe(true);
    });

    it('매니페스트 검증 - 버전 누락', () => {
      const manifest = {
        createdAt: '2024-01-01T00:00:00.000Z',
        packages: [],
        totalSize: 0,
      } as unknown as PackageManifest;
      expect(validateManifest(manifest)).toBe(false);
    });
  });

  describe('split file naming', () => {
    const generatePartName = (baseName: string, partNumber: number, totalParts: number): string => {
      const paddedNum = String(partNumber).padStart(String(totalParts).length, '0');
      const extension = baseName.match(/\.[^.]+$/)?.[0] || '';
      const nameWithoutExt = baseName.replace(/\.[^.]+$/, '');
      return `${nameWithoutExt}.part${paddedNum}${extension}`;
    };

    const parsePartName = (
      filename: string
    ): { baseName: string; partNumber: number } | null => {
      const match = filename.match(/^(.+)\.part(\d+)(\.[^.]+)?$/);
      if (!match) return null;
      return {
        baseName: match[1] + (match[3] || ''),
        partNumber: parseInt(match[2], 10),
      };
    };

    it('파트 파일명 생성 - 단일 자리', () => {
      expect(generatePartName('archive.zip', 1, 5)).toBe('archive.part1.zip');
    });

    it('파트 파일명 생성 - 패딩', () => {
      expect(generatePartName('archive.zip', 1, 100)).toBe('archive.part001.zip');
      expect(generatePartName('archive.zip', 99, 100)).toBe('archive.part099.zip');
    });

    it('파트 파일명 파싱', () => {
      const result = parsePartName('archive.part01.zip');
      expect(result).not.toBeNull();
      expect(result!.baseName).toBe('archive.zip');
      expect(result!.partNumber).toBe(1);
    });

    it('일반 파일명 파싱 - null 반환', () => {
      const result = parsePartName('archive.zip');
      expect(result).toBeNull();
    });
  });

  describe('script type detection', () => {
    const SCRIPT_EXTENSIONS: Record<string, string> = {
      bash: '.sh',
      powershell: '.ps1',
      batch: '.bat',
      python: '.py',
    };

    const getScriptExtension = (type: string): string => {
      return SCRIPT_EXTENSIONS[type.toLowerCase()] || '';
    };

    const detectScriptType = (filename: string): string | null => {
      const ext = filename.toLowerCase().match(/\.[^.]+$/)?.[0];
      for (const [type, extension] of Object.entries(SCRIPT_EXTENSIONS)) {
        if (extension === ext) return type;
      }
      return null;
    };

    it('bash 스크립트 확장자', () => {
      expect(getScriptExtension('bash')).toBe('.sh');
    });

    it('powershell 스크립트 확장자', () => {
      expect(getScriptExtension('powershell')).toBe('.ps1');
    });

    it('batch 스크립트 확장자', () => {
      expect(getScriptExtension('batch')).toBe('.bat');
    });

    it('알 수 없는 스크립트 타입', () => {
      expect(getScriptExtension('unknown')).toBe('');
    });

    it('파일명에서 스크립트 타입 감지', () => {
      expect(detectScriptType('install.sh')).toBe('bash');
      expect(detectScriptType('install.ps1')).toBe('powershell');
      expect(detectScriptType('install.bat')).toBe('batch');
    });

    it('알 수 없는 확장자', () => {
      expect(detectScriptType('install.exe')).toBeNull();
    });
  });

  describe('package type grouping', () => {
    interface Package {
      name: string;
      type: string;
    }

    const groupByType = (packages: Package[]): Record<string, Package[]> => {
      return packages.reduce(
        (groups, pkg) => {
          const type = pkg.type;
          if (!groups[type]) {
            groups[type] = [];
          }
          groups[type].push(pkg);
          return groups;
        },
        {} as Record<string, Package[]>
      );
    };

    it('패키지 타입별 그룹화', () => {
      const packages: Package[] = [
        { name: 'requests', type: 'pip' },
        { name: 'numpy', type: 'pip' },
        { name: 'express', type: 'npm' },
        { name: 'spring-core', type: 'maven' },
      ];
      const groups = groupByType(packages);
      expect(groups['pip'].length).toBe(2);
      expect(groups['npm'].length).toBe(1);
      expect(groups['maven'].length).toBe(1);
    });

    it('빈 배열 그룹화', () => {
      const groups = groupByType([]);
      expect(Object.keys(groups).length).toBe(0);
    });

    it('단일 타입만 있는 경우', () => {
      const packages: Package[] = [
        { name: 'requests', type: 'pip' },
        { name: 'numpy', type: 'pip' },
      ];
      const groups = groupByType(packages);
      expect(Object.keys(groups).length).toBe(1);
      expect(groups['pip'].length).toBe(2);
    });
  });
});
