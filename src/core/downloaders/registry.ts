import { getCondaDownloader } from './conda';
import { getDockerDownloader } from './docker';
import { getMavenDownloader } from './maven';
import { getNpmDownloader } from './npm';
import { getPipDownloader } from './pip';
import type { IDownloader, PackageType } from '../../types';

export type DownloaderCreator = () => IDownloader;

export type RegisteredDownloaderType = Extract<
  PackageType,
  'pip' | 'conda' | 'maven' | 'npm' | 'docker'
>;

const defaultDownloaderCreators = new Map<RegisteredDownloaderType, DownloaderCreator>([
  ['pip', getPipDownloader],
  ['conda', getCondaDownloader],
  ['maven', getMavenDownloader],
  ['npm', getNpmDownloader],
  ['docker', getDockerDownloader],
]);

export function getRegisteredDownloaderTypes(): RegisteredDownloaderType[] {
  return Array.from(defaultDownloaderCreators.keys());
}

export function isRegisteredDownloaderType(type: PackageType): type is RegisteredDownloaderType {
  return defaultDownloaderCreators.has(type as RegisteredDownloaderType);
}

export function getRegisteredDownloaderCreator(type: RegisteredDownloaderType): DownloaderCreator {
  const creator = defaultDownloaderCreators.get(type);
  if (!creator) {
    throw new Error(`기본 다운로더가 등록되지 않았습니다: ${type}`);
  }

  return creator;
}

export function createRegisteredDownloader(type: RegisteredDownloaderType): IDownloader {
  return getRegisteredDownloaderCreator(type)();
}

export function registerDefaultDownloaderCreators(
  register: (type: RegisteredDownloaderType, creator: DownloaderCreator) => void
): void {
  for (const [type, creator] of defaultDownloaderCreators) {
    register(type, creator);
  }
}
