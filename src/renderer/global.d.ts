import type { ElectronAPI as PreloadElectronAPI } from '../types/electron';
import type {
  OSDistribution,
  OSPackageInfo,
  MatchType,
  OSArchitecture,
} from '../core/downloaders/os-shared/types';

export interface OSPackageOutputOptions {
  type: 'archive' | 'repository' | 'both';
  archiveFormat?: 'zip' | 'tar.gz';
  generateScripts: boolean;
  scriptTypes: Array<'dependency-order' | 'local-repo'>;
}

export type ElectronAPI = PreloadElectronAPI;
export { OSDistribution, OSPackageInfo, MatchType, OSArchitecture };
