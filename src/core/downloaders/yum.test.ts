import { describe, it, expect, beforeEach } from 'vitest';
import { getYumDownloader } from './yum';
import type { BaseDownloaderOptions } from './os-shared/base-downloader';

describe('yum downloader', () => {
  let downloader: ReturnType<typeof getYumDownloader>;
  let options: BaseDownloaderOptions;

  beforeEach(() => {
    options = {
      outputDir: '/tmp/test',
      distribution: {
        id: 'rocky',
        name: 'Rocky Linux',
        version: '9',
        codename: '',
        packageManager: 'yum',
        architectures: ['x86_64'],
        defaultRepos: [],
        extendedRepos: [],
      },
      architecture: 'x86_64',
      repositories: [{
        id: 'baseos',
        name: 'Rocky BaseOS',
        baseUrl: 'https://download.rockylinux.org/pub/rocky/9/BaseOS/x86_64/os/',
        enabled: true,
        gpgCheck: false,
        isOfficial: true,
      }],
      concurrency: 1,
    };
    downloader = getYumDownloader(options);
  });

  describe('getYumDownloader', () => {
    it('싱글톤 인스턴스 반환', () => {
      const instance1 = getYumDownloader(options);
      const instance2 = getYumDownloader();
      expect(instance1).toBe(instance2);
    });

    it('type이 yum', () => {
      expect(downloader.type).toBe('yum');
    });
  });

});
