type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

const positiveSafeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 && Number.isSafeInteger(value);

const positiveFinite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

const stringFields = new Set([
  'cachePath', 'defaultDownloadPath', 'smtpHost', 'smtpUser', 'smtpPassword', 'smtpFrom', 'smtpTo',
  'condaChannel', 'dockerRegistry', 'dockerCustomRegistry', 'dockerArchitecture',
  'dockerLayerCompression', 'dockerRetryStrategy', 'defaultTargetOS', 'defaultArchitecture',
]);

const booleanFields = new Set([
  'enableCache', 'cachingEnabled', 'cacheEnabled', 'includeDependencies', 'includeInstallScripts',
  'enableFileSplit', 'dockerIncludeLoadScript', 'autoUpdate', 'autoDownloadUpdate',
]);

const protectedKeys = new Set(['__proto__', 'constructor']);

function validateJsonData(value: unknown, path: string, seen: WeakSet<object>): string | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') return Number.isFinite(value) ? undefined : `${path}는 유한한 숫자여야 합니다`;
  if (typeof value !== 'object') return `${path}는 JSON 데이터여야 합니다`;
  if (!Array.isArray(value) && !isRecord(value)) return `${path}는 JSON 객체여야 합니다`;
  if (seen.has(value)) return `${path}에 순환 참조(circular)가 있습니다`;
  seen.add(value);
  const entries = Array.isArray(value)
    ? value.entries()
    : Object.entries(value);
  for (const [key, child] of entries) {
    if (protectedKeys.has(String(key))) return `${path}.${String(key)}는 허용되지 않습니다`;
    const error = validateJsonData(child, `${path}.${String(key)}`, seen);
    if (error) return error;
  }
  seen.delete(value);
  return undefined;
}

function validateNestedRecord(value: unknown, key: string, fields: string[]): string | undefined {
  if (!isRecord(value)) return `${key}는 객체여야 합니다`;
  for (const field of fields) {
    if (typeof value[field] !== 'string') return `${key}.${field}는 문자열이어야 합니다`;
  }
  return undefined;
}

/** Validate the persisted IPC payload without changing or migrating its data. */
export function validateSettingsForWrite(value: unknown):
  | { config: JsonRecord }
  | { error: string } {
  if (!isRecord(value)) return { error: '설정은 객체여야 합니다' };

  const jsonError = validateJsonData(value, '설정', new WeakSet<object>());
  if (jsonError) return { error: jsonError };

  for (const [key, fieldValue] of Object.entries(value)) {
    if (booleanFields.has(key) && typeof fieldValue !== 'boolean') {
      return { error: `${key}는 boolean이어야 합니다` };
    }
    if (stringFields.has(key) && typeof fieldValue !== 'string') {
      return { error: `${key}는 문자열이어야 합니다` };
    }
    if (key === 'concurrentDownloads' && !positiveSafeInteger(fieldValue)) {
      return { error: 'concurrentDownloads는 양의 안전한 정수여야 합니다' };
    }
    if ((key === 'maxFileSize' || key === 'fileSplitSizeMB') && !positiveFinite(fieldValue)) {
      return { error: `${key}는 양의 유한한 숫자여야 합니다` };
    }
    if (key === 'maxCacheSize' && !positiveSafeInteger(fieldValue)) {
      return { error: 'maxCacheSize는 양의 안전한 정수여야 합니다' };
    }
    if (key === 'smtpPort' && (!positiveSafeInteger(fieldValue) || fieldValue > 65535)) {
      return { error: 'smtpPort는 1부터 65535 사이의 안전한 정수여야 합니다' };
    }
    if (key === 'downloadRenderInterval' &&
        (typeof fieldValue !== 'number' || !Number.isFinite(fieldValue) || fieldValue < 0)) {
      return { error: 'downloadRenderInterval은 0 이상의 유한한 숫자여야 합니다' };
    }
    if (key === 'logLevel' &&
        (typeof fieldValue !== 'string' ||
          !['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'].includes(fieldValue))) {
      return { error: 'logLevel이 허용된 값이 아닙니다' };
    }
    if (key === 'defaultOutputFormat' &&
        (typeof fieldValue !== 'string' ||
          !['zip', 'tar.gz', 'archive', 'mirror', 'withScript'].includes(fieldValue))) {
      return { error: 'defaultOutputFormat이 허용된 값이 아닙니다' };
    }
    if (key === 'defaultArchiveType' &&
        (typeof fieldValue !== 'string' || !['zip', 'tar.gz'].includes(fieldValue))) {
      return { error: 'defaultArchiveType이 허용된 값이 아닙니다' };
    }
    if (key === 'cudaVersion' && fieldValue !== null && typeof fieldValue !== 'string') {
      return { error: 'cudaVersion은 null 또는 문자열이어야 합니다' };
    }
    if (key === 'customCondaChannels' &&
        (!Array.isArray(fieldValue) || !fieldValue.every(item => typeof item === 'string'))) {
      return { error: 'customCondaChannels는 문자열 배열이어야 합니다' };
    }
    if (key === 'customPipIndexUrls' &&
        (!Array.isArray(fieldValue) || fieldValue.some(item =>
          !isRecord(item) || typeof item.label !== 'string' || typeof item.url !== 'string'))) {
      return { error: 'customPipIndexUrls의 항목은 label과 url 문자열을 가져야 합니다' };
    }
    if (key === 'languageVersions') {
      const error = validateNestedRecord(fieldValue, key, ['python']);
      if (error) return { error };
    }
    if (key === 'pipTargetPlatform') {
      const error = validateNestedRecord(fieldValue, key, ['os', 'arch']);
      if (error) return { error };
      const platform = fieldValue as JsonRecord;
      for (const optional of ['pythonVersion', 'linuxDistro', 'glibcVersion', 'macosVersion']) {
        if (platform[optional] !== undefined && typeof platform[optional] !== 'string') {
          return { error: `${key}.${optional}는 문자열이어야 합니다` };
        }
      }
    }
    if (key === 'yumDistribution' || key === 'aptDistribution' || key === 'apkDistribution') {
      const error = validateNestedRecord(fieldValue, key, ['id', 'architecture']);
      if (error) return { error };
    }
  }

  let snapshot: string;
  try {
    snapshot = JSON.stringify(value);
  } catch (error) {
    return { error: `설정은 JSON으로 직렬화할 수 없습니다: ${String(error)}` };
  }
  return { config: JSON.parse(snapshot) as JsonRecord };
}
