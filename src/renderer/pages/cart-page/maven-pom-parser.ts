import { XMLParser } from 'fast-xml-parser';

export interface ParsedMavenPomDependency {
  name: string;
  version: string;
  metadata?: Record<string, unknown>;
}

function collectDependencyEntries(value: unknown): Record<string, unknown>[] {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap(collectDependencyEntries);

  return Object.entries(value).flatMap(([tag, child]) => {
    if (tag !== 'dependency') return collectDependencyEntries(child);
    const entries = Array.isArray(child) ? child : [child];
    return entries.filter((entry): entry is Record<string, unknown> =>
      entry !== null && typeof entry === 'object' && !Array.isArray(entry)
    );
  });
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
  // 기존 입력처럼 dependencyManagement/BOM 등 모든 dependency 선언을 가져온다.
  const entries = collectDependencyEntries(parsed);

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
