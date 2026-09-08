import { XMLParser } from 'fast-xml-parser';

export interface ParsedMavenPomDependency {
  name: string;
  version: string;
  metadata?: Record<string, unknown>;
}

/**
 * 장바구니 입력용 pom.xml 의존성을 파싱한다.
 * Maven artifact type은 다운로더가 확장자를 결정하는 데 사용하므로 보존한다.
 */
export function parseMavenPomDependencies(content: string): ParsedMavenPomDependency[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseTagValue: false,
  });
  const parsed = parser.parse(content);
  const dependencies =
    parsed.project?.dependencies?.dependency
    ?? parsed.dependencies?.dependency
    ?? parsed.dependency;
  const entries = Array.isArray(dependencies)
    ? dependencies
    : dependencies
      ? [dependencies]
      : [];

  return entries.flatMap((dependency: Record<string, unknown>) => {
    const groupId = typeof dependency.groupId === 'string' ? dependency.groupId.trim() : '';
    const artifactId = typeof dependency.artifactId === 'string' ? dependency.artifactId.trim() : '';

    if (!groupId || !artifactId) {
      return [];
    }

    const version = typeof dependency.version === 'string' && dependency.version.trim()
      ? dependency.version.trim()
      : 'latest';
    const type = typeof dependency.type === 'string' ? dependency.type.trim() : '';

    return [{
      name: `${groupId}:${artifactId}`,
      version,
      metadata: type ? { type } : undefined,
    }];
  });
}
