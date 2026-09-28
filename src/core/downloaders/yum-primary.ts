import { XMLParser } from 'fast-xml-parser';
import { gunzipSync } from 'zlib';
import type {
  OSPackageInfo,
  PackageDependency,
  Repository,
  OSArchitecture,
  VersionOperator,
  Checksum,
  ChecksumType,
  RpmPrimaryFile,
} from './os-shared/types';

function parseNumericAttribute(value: unknown, fallback?: number): number | undefined {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
export function createYumXmlParser(): XMLParser {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    parseAttributeValue: false,
    trimValues: true,
    processEntities: {
      enabled: true,
      // Rocky primary XML의 표준 엔티티도 치환 횟수에 포함됩니다.
      maxTotalExpansions: 100_000,
      maxEntityCount: 100,
      maxEntitySize: 10_000,
      maxExpandedLength: 100_000,
    },
  });
}

/** Pure conversion, run only in the metadata worker for production primary XML. */
export class YumPrimaryParser {
  constructor(private readonly repository: Repository) {}
  parse(data: ArrayBuffer, compressed: boolean): OSPackageInfo[] {
    const bytes = Buffer.from(data);
    const xml = (compressed ? gunzipSync(bytes) : bytes).toString('utf-8');
    const metadata = createYumXmlParser().parse(xml).metadata;
    if (!metadata) throw new Error('Invalid primary.xml: missing metadata root element');
    const packages: OSPackageInfo[] = [];
    const elements = Array.isArray(metadata.package)
      ? metadata.package
      : metadata.package
        ? [metadata.package]
        : [];
    for (const element of elements) {
      try {
        packages.push(this.parsePackageElement(element));
      } catch (error) {
        console.warn(`Failed to parse package: ${(error as Error).message}`);
      }
    }
    return packages;
  }
  /**
   * 패키지 요소 파싱
   */
  private parsePackageElement(pkgEl: Record<string, unknown>): OSPackageInfo {
    const versionEl = pkgEl.version as Record<string, unknown> | undefined;
    const sizeEl = pkgEl.size as Record<string, unknown> | undefined;
    const locationEl = pkgEl.location as Record<string, unknown> | undefined;
    const checksumEl = pkgEl.checksum as Record<string, unknown> | undefined;
    const formatEl = pkgEl.format as Record<string, unknown> | undefined;

    // 기본 정보
    const name = (pkgEl.name as string) || '';
    const arch = ((pkgEl.arch as string) || 'noarch') as OSArchitecture;

    // 버전 정보
    const version = (versionEl?.['@_ver'] as string) || '';
    const release = (versionEl?.['@_rel'] as string) || undefined;
    const epoch = parseNumericAttribute(versionEl?.['@_epoch']);

    // 크기 정보
    const size = parseNumericAttribute(sizeEl?.['@_package'], 0) ?? 0;
    const installedSize = parseNumericAttribute(sizeEl?.['@_installed']);

    // 체크섬
    const checksum: Checksum = {
      type: ((checksumEl?.['@_type'] as string) || 'sha256') as ChecksumType,
      value: (checksumEl?.['#text'] as string) || '',
    };

    // 위치
    const locationHref = (locationEl?.['@_href'] as string) || '';

    // 설명 정보
    const description = (pkgEl.description as string) || undefined;
    const summary = (pkgEl.summary as string) || undefined;
    const license = formatEl?.['rpm:license'] as string | undefined;

    // 의존성 파싱
    const dependencies = this.parseRpmRequires(formatEl?.['rpm:requires']);
    const provides = this.parseRpmProvides(formatEl?.['rpm:provides']);
    const conflicts = this.parseRpmProvides(formatEl?.['rpm:conflicts']);
    const obsoletes = this.parseRpmProvides(formatEl?.['rpm:obsoletes']);
    const suggests = this.parseRpmProvides(formatEl?.['rpm:suggests']);
    const recommends = this.parseRpmProvides(formatEl?.['rpm:recommends']);
    const rpmPrimaryFiles = this.parseRpmPrimaryFiles(formatEl?.file);

    return {
      name,
      version,
      release,
      epoch,
      architecture: arch,
      size,
      installedSize,
      checksum,
      location: locationHref,
      repository: this.repository,
      description,
      summary,
      license,
      dependencies,
      provides: provides.length > 0 ? provides : undefined,
      rpmPrimaryFiles: rpmPrimaryFiles.length > 0 ? rpmPrimaryFiles : undefined,
      conflicts: conflicts.length > 0 ? conflicts : undefined,
      obsoletes: obsoletes.length > 0 ? obsoletes : undefined,
      suggests: suggests.length > 0 ? suggests : undefined,
      recommends: recommends.length > 0 ? recommends : undefined,
    };
  }

  private parseRpmPrimaryFiles(files: unknown): RpmPrimaryFile[] {
    const result: RpmPrimaryFile[] = [];
    const seen = new Set<string>();
    for (const entry of Array.isArray(files) ? files : [files]) {
      const record =
        entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : undefined;
      const filePath = typeof entry === 'string' ? entry : record?.['#text'];
      const type = record?.['@_type'] ?? 'file';
      if (
        typeof filePath !== 'string' ||
        !filePath ||
        (type !== 'file' && type !== 'dir' && type !== 'ghost')
      )
        continue;
      const key = JSON.stringify([filePath, type]);
      if (!seen.has(key)) {
        seen.add(key);
        result.push({ path: filePath, type });
      }
    }
    return result;
  }

  /**
   * RPM requires 파싱
   */
  private parseRpmRequires(requires: unknown): PackageDependency[] {
    if (!requires) return [];

    const requiresObj = requires as Record<string, unknown>;
    const entries = requiresObj['rpm:entry'];
    if (!entries) return [];

    const entryList = Array.isArray(entries) ? entries : [entries];
    const dependencies: PackageDependency[] = [];

    for (const entry of entryList) {
      if (!entry || typeof entry !== 'object') continue;

      const entryObj = entry as Record<string, unknown>;
      const name = (entryObj['@_name'] as string) || '';

      // 시스템 의존성 필터링 (rpmlib, config 등)
      if (this.isSystemDependency(name)) continue;

      const flags = entryObj['@_flags'] as string | undefined;
      const ver = entryObj['@_ver'] as string | undefined;

      dependencies.push({
        name,
        version: ver,
        operator: flags ? this.parseRpmFlags(flags) : undefined,
        // pre=1 describes installation ordering, not a weak/optional requirement.
        isOptional: false,
      });
    }

    return dependencies;
  }

  /**
   * 시스템 의존성 여부 확인
   */
  private isSystemDependency(name: string): boolean {
    // rpmlib, config, 파일 경로 등은 시스템 의존성으로 필터링
    return (
      name.startsWith('rpmlib(') ||
      name.startsWith('config(') ||
      name.startsWith('/') ||
      name.startsWith('libc.so') ||
      name.startsWith('libpthread.so') ||
      name.startsWith('libm.so') ||
      name.startsWith('libdl.so') ||
      name.startsWith('librt.so') ||
      name.startsWith('rtld(')
    );
  }

  /**
   * RPM provides/conflicts/obsoletes 파싱
   */
  private parseRpmProvides(provides: unknown): string[] {
    if (!provides) return [];

    const providesObj = provides as Record<string, unknown>;
    const entries = providesObj['rpm:entry'];
    if (!entries) return [];

    const entryList = Array.isArray(entries) ? entries : [entries];
    const result: string[] = [];

    for (const entry of entryList) {
      if (!entry || typeof entry !== 'object') continue;

      const entryObj = entry as Record<string, unknown>;
      const name = (entryObj['@_name'] as string) || '';
      if (name) {
        result.push(name);
      }
    }

    return result;
  }

  /**
   * RPM flags 파싱 (EQ, LT, GT 등)
   */
  private parseRpmFlags(flags: string): VersionOperator | undefined {
    const flagMap: Record<string, VersionOperator> = {
      EQ: '=',
      LT: '<',
      GT: '>',
      LE: '<=',
      GE: '>=',
    };

    return flagMap[flags.toUpperCase()];
  }
}
