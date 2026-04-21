import { describe, expect, it } from 'vitest';
import {
  createRegisteredDownloader,
  getRegisteredDownloaderTypes,
  isRegisteredDownloaderType,
} from './registry';

describe('downloaders registry', () => {
  it('기본 downloader 타입 목록을 단일 진실로 제공해야 함', () => {
    expect(getRegisteredDownloaderTypes()).toEqual([
      'pip',
      'conda',
      'maven',
      'npm',
      'docker',
    ]);
  });

  it.each(getRegisteredDownloaderTypes())(
    '%s creator가 해당 타입의 downloader를 생성해야 함',
    (type) => {
      const downloader = createRegisteredDownloader(type);

      expect(downloader.type).toBe(type);
    }
  );

  it('등록 여부를 타입 가드로 확인할 수 있어야 함', () => {
    expect(isRegisteredDownloaderType('pip')).toBe(true);
    expect(isRegisteredDownloaderType('apt')).toBe(false);
  });
});
