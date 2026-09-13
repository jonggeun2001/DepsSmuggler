import { describe, expect, it } from 'vitest';
import { validateSettingsForWrite } from './settings-validation';

describe('validateSettingsForWrite', () => {
  it('accepts GUI and CLI legacy fields while preserving future data', () => {
    const config = {
      enableCache: false,
      cachingEnabled: false,
      cacheEnabled: false,
      concurrentDownloads: 3,
      maxFileSize: 25,
      fileSplitSizeMB: 25,
      maxCacheSize: 1024,
      logLevel: 'info',
      defaultOutputFormat: 'withScript',
      defaultArchiveType: 'tar.gz',
      futureSetting: { enabled: true },
      cache: { enabled: false },
    };

    expect(validateSettingsForWrite(config)).toEqual({ config });
  });

  it('returns a detached snapshot for a queued write', () => {
    const config = { futureSetting: { enabled: true } };
    const result = validateSettingsForWrite(config);
    config.futureSetting.enabled = false;
    expect(result).toEqual({ config: { futureSetting: { enabled: true } } });
  });

  it.each([
    ['concurrentDownloads', 0],
    ['maxFileSize', Number.NaN],
    ['fileSplitSizeMB', -1],
    ['maxCacheSize', 0],
    ['smtpPort', 65536],
    ['downloadRenderInterval', -1],
    ['enableCache', 'false'],
    ['logLevel', ['info']],
    ['defaultOutputFormat', ['zip']],
    ['customCondaChannels', [42]],
    ['customPipIndexUrls', [{ label: 'index' }]],
  ])('rejects malformed known field %s', (key, value) => {
    const result = validateSettingsForWrite({ [key]: value });
    expect(result).toMatchObject({ error: expect.stringContaining(key) });
  });

  it.each([null, [], 'settings', 42, true, new Date(), new Map(), new Set()])('rejects non-record root %j', (value) => {
    expect(validateSettingsForWrite(value)).toMatchObject({
      error: expect.stringContaining('객체'),
    });
  });

  it.each([new Date(), new Map([['enabled', true]]), new Set(['enabled'])])(
    'rejects non-plain JSON objects %j',
    (value) => {
      expect(validateSettingsForWrite({ futureSetting: value })).toMatchObject({
        error: expect.stringContaining('JSON'),
      });
    }
  );

  it('rejects non-JSON data before persistence', () => {
    const config: Record<string, unknown> = {};
    config.self = config;
    expect(validateSettingsForWrite(config)).toMatchObject({
      error: expect.stringContaining('순환'),
    });
  });
});
