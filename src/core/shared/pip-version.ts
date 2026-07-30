/**
 * PEP 440 버전 비교와 specifier 평가에 필요한 최소 기능입니다.
 */

interface ParsedPep440Version {
  epoch: number;
  release: number[];
  prereleaseRank: number | null;
  prereleaseNumber: number;
  devrelease: number | null;
  postrelease: number | null;
}

const PRERELEASE_RANK: Record<string, number> = {
  a: 0,
  alpha: 0,
  b: 1,
  beta: 1,
  c: 2,
  rc: 2,
  pre: 2,
  preview: 2,
};

export function comparePep440Versions(leftRaw: string, rightRaw: string): number {
  const left = parsePep440Version(leftRaw);
  const right = parsePep440Version(rightRaw);

  if (!left || !right) return leftRaw.localeCompare(rightRaw, undefined, { numeric: true });
  return compareParsedPep440Versions(left, right);
}

export function isPep440PreRelease(version: string): boolean {
  const parsed = parsePep440Version(version);
  return parsed !== null && (parsed.prereleaseRank !== null || parsed.devrelease !== null);
}

export function specifierAllowsPep440PreRelease(specifier: string | undefined): boolean {
  if (!specifier) return false;

  return specifier.split(',').some((part) => {
    const match = /^(===|==|!=|~=|>=|<=|>|<)\s*(.+)$/.exec(part.trim());
    return match ? isPep440PreRelease(match[2].replace(/\.\*$/, '')) : false;
  });
}

export function isPep440VersionCompatible(versionRaw: string, specifier: string): boolean {
  const version = parsePep440Version(versionRaw);
  if (!version) return false;

  return specifier
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .every((part) => matchesPep440Specifier(version, versionRaw, part));
}

function matchesPep440Specifier(
  version: ParsedPep440Version,
  versionRaw: string,
  specifier: string
): boolean {
  const match = /^(===|==|!=|~=|>=|<=|>|<)\s*(.+)$/.exec(specifier);
  if (!match) return false;

  const [, operator, requirementRaw] = match;
  if (operator === '===') return versionRaw === requirementRaw;

  const hasWildcard = requirementRaw.endsWith('.*');
  const requirement = parsePep440Version(
    hasWildcard ? requirementRaw.slice(0, -2) : requirementRaw
  );
  if (!requirement) return false;

  if (hasWildcard) {
    if (operator !== '==' && operator !== '!=') return false;
    const matchesPrefix = requirement.release.every(
      (part, index) => version.release[index] === part
    );
    return operator === '==' ? matchesPrefix : !matchesPrefix;
  }

  const comparison = compareParsedPep440Versions(version, requirement);
  switch (operator) {
    case '==':
      return comparison === 0;
    case '!=':
      return comparison !== 0;
    case '>=':
      return comparison >= 0;
    case '<=':
      return comparison <= 0;
    case '>':
      return comparison > 0;
    case '<':
      return comparison < 0;
    case '~=':
      return requirement.release.length >= 2 &&
        comparison >= 0 &&
        compareParsedPep440Versions(version, compatibleReleaseUpperBound(requirement)) < 0;
    default:
      return false;
  }
}

function parsePep440Version(version: string): ParsedPep440Version | null {
  const match = /^(?:(\d+)!)?v?(\d+(?:\.\d+)*)(?:[-_.]?(a|b|c|rc|alpha|beta|pre|preview)(\d*)?)?(?:[-_.]?post(\d*)?)?(?:[-_.]?dev(\d*)?)?(?:\+[a-z0-9.-]+)?$/i.exec(
    version.trim()
  );
  if (!match) return null;

  const [, epoch = '0', release, prereleaseLabel, prereleaseNumber, postreleaseNumber, devreleaseNumber] = match;
  return {
    epoch: Number(epoch),
    release: release.split('.').map(Number),
    prereleaseRank: prereleaseLabel
      ? PRERELEASE_RANK[prereleaseLabel.toLowerCase()]
      : null,
    prereleaseNumber: prereleaseNumber ? Number(prereleaseNumber) : 0,
    devrelease: devreleaseNumber === undefined ? null : Number(devreleaseNumber || 0),
    postrelease: postreleaseNumber === undefined ? null : Number(postreleaseNumber || 0),
  };
}

function compareParsedPep440Versions(left: ParsedPep440Version, right: ParsedPep440Version): number {
  if (left.epoch !== right.epoch) return left.epoch - right.epoch;

  const releaseLength = Math.max(left.release.length, right.release.length);
  for (let index = 0; index < releaseLength; index += 1) {
    const difference = (left.release[index] ?? 0) - (right.release[index] ?? 0);
    if (difference !== 0) return difference;
  }

  const leftPrerelease = getPrereleaseSortRank(left);
  const rightPrerelease = getPrereleaseSortRank(right);
  if (leftPrerelease !== rightPrerelease) return leftPrerelease - rightPrerelease;
  if (left.prereleaseNumber !== right.prereleaseNumber) {
    return left.prereleaseNumber - right.prereleaseNumber;
  }

  const leftPostrelease = left.postrelease ?? -Infinity;
  const rightPostrelease = right.postrelease ?? -Infinity;
  if (leftPostrelease !== rightPostrelease) return leftPostrelease - rightPostrelease;

  const leftDevrelease = left.devrelease ?? Infinity;
  const rightDevrelease = right.devrelease ?? Infinity;
  if (leftDevrelease !== rightDevrelease) return leftDevrelease - rightDevrelease;
  return 0;
}

function getPrereleaseSortRank(version: ParsedPep440Version): number {
  if (version.prereleaseRank !== null) return version.prereleaseRank;
  if (version.postrelease === null && version.devrelease !== null) return -1;
  return 3;
}

function compatibleReleaseUpperBound(requirement: ParsedPep440Version): ParsedPep440Version {
  const upperRelease = requirement.release.slice(0, -1);
  upperRelease[upperRelease.length - 1] += 1;

  return {
    epoch: requirement.epoch,
    release: upperRelease,
    prereleaseRank: null,
    prereleaseNumber: 0,
    devrelease: null,
    postrelease: null,
  };
}
