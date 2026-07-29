import { isVersionCompatible } from './version-utils';

export interface Pep508MarkerEnvironment {
  python_version?: string;
  python_full_version?: string;
  os_name?: string;
  sys_platform?: string;
  platform_release?: string;
  platform_system?: string;
  platform_version?: string;
  platform_machine?: string;
  platform_python_implementation?: string;
  implementation_name?: string;
  implementation_version?: string;
  extra?: string;
}

type MarkerVariable = keyof Pep508MarkerEnvironment;
type IncompleteVersionVariable =
  | 'python_full_version'
  | 'implementation_version';
type MarkerEvaluation = boolean | undefined;

export interface Pep508MarkerEvaluationOptions {
  incompleteVersions?: Partial<
    Record<IncompleteVersionVariable, string>
  >;
  unknownResult?: boolean;
}

type ComparisonOperator =
  | '==='
  | '=='
  | '!='
  | '<='
  | '>='
  | '<'
  | '>'
  | '~='
  | 'in'
  | 'not in';

type Token =
  | { type: 'word'; value: string }
  | { type: 'string'; value: string }
  | { type: 'operator'; value: ComparisonOperator }
  | { type: 'leftParen' }
  | { type: 'rightParen' };

interface Operand {
  value?: string;
  variable?: MarkerVariable;
}

const MARKER_VARIABLES = new Set<MarkerVariable>([
  'python_version',
  'python_full_version',
  'os_name',
  'sys_platform',
  'platform_release',
  'platform_system',
  'platform_version',
  'platform_machine',
  'platform_python_implementation',
  'implementation_name',
  'implementation_version',
  'extra',
]);

const VERSION_VARIABLES = new Set<MarkerVariable>([
  'python_version',
  'python_full_version',
  'implementation_version',
]);

function tokenize(marker: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < marker.length) {
    const character = marker[index];
    if (/\s/.test(character)) {
      index += 1;
      continue;
    }

    if (character === '(') {
      tokens.push({ type: 'leftParen' });
      index += 1;
      continue;
    }
    if (character === ')') {
      tokens.push({ type: 'rightParen' });
      index += 1;
      continue;
    }

    if (character === '"' || character === "'") {
      const quote = character;
      let value = '';
      index += 1;
      let closed = false;
      while (index < marker.length) {
        const current = marker[index];
        if (current === quote) {
          closed = true;
          index += 1;
          break;
        }
        if (current === '\\' && index + 1 < marker.length) {
          value += marker[index + 1];
          index += 2;
          continue;
        }
        value += current;
        index += 1;
      }
      if (!closed) {
        throw new Error('종료되지 않은 문자열 리터럴');
      }
      tokens.push({ type: 'string', value });
      continue;
    }

    const operator = /^(===|==|!=|<=|>=|~=|<|>)/.exec(
      marker.slice(index),
    );
    if (operator) {
      tokens.push({
        type: 'operator',
        value: operator[1] as ComparisonOperator,
      });
      index += operator[1].length;
      continue;
    }

    const word = /^[A-Za-z_][A-Za-z0-9_.-]*/.exec(
      marker.slice(index),
    );
    if (word) {
      tokens.push({ type: 'word', value: word[0] });
      index += word[0].length;
      continue;
    }

    throw new Error(`지원하지 않는 마커 문자: ${character}`);
  }

  return tokens;
}

function normalizeMachine(value: string): string {
  const normalized = value.toLowerCase();
  if (normalized === 'amd64' || normalized === 'x86_64') {
    return 'x86_64';
  }
  if (normalized === 'arm64' || normalized === 'aarch64') {
    return 'aarch64';
  }
  return normalized;
}

export function normalizeExtraName(value: string): string {
  return value.trim().toLowerCase().replace(/[-_.]+/g, '-');
}

function invertOperator(operator: ComparisonOperator): ComparisonOperator {
  const inverted: Partial<Record<ComparisonOperator, ComparisonOperator>> = {
    '<': '>',
    '<=': '>=',
    '>': '<',
    '>=': '<=',
  };
  return inverted[operator] ?? operator;
}

function combineAnd(
  left: MarkerEvaluation,
  right: MarkerEvaluation,
): MarkerEvaluation {
  if (left === false || right === false) {
    return false;
  }
  if (left === true && right === true) {
    return true;
  }
  return undefined;
}

function combineOr(
  left: MarkerEvaluation,
  right: MarkerEvaluation,
): MarkerEvaluation {
  if (left === true || right === true) {
    return true;
  }
  if (left === false && right === false) {
    return false;
  }
  return undefined;
}

function compareIncompleteVersion(
  versionPrefix: string,
  operator: ComparisonOperator,
  target: string,
): MarkerEvaluation {
  if (operator === 'in' || operator === 'not in') {
    return undefined;
  }
  if (operator === '===') {
    // 임의 문자열 동등 비교는 불완전한 버전 prefix로 확정할 수 없다.
    return undefined;
  }

  const normalizedOperator = operator;
  const releasePrefix = /^(\d+)\.(\d+)$/.exec(versionPrefix);
  if (!releasePrefix) {
    return undefined;
  }

  const lowerVersion = `${versionPrefix}.0`;
  const upperProbeVersion = `${versionPrefix}.999999`;

  if (
    normalizedOperator === '==' ||
    normalizedOperator === '!='
  ) {
    const wildcardTarget = /^(\d+)\.(\d+)\.\*$/.exec(target);
    if (wildcardTarget) {
      const matchesPrefix =
        wildcardTarget[1] === releasePrefix[1] &&
        wildcardTarget[2] === releasePrefix[2];
      return normalizedOperator === '=='
        ? matchesPrefix
        : !matchesPrefix;
    }

    const exactTarget = /^(\d+)\.(\d+)(?:\.|$)/.exec(target);
    if (
      exactTarget?.[1] === releasePrefix[1] &&
      exactTarget?.[2] === releasePrefix[2]
    ) {
      return undefined;
    }
  }

  const lowerResult = isVersionCompatible(
    lowerVersion,
    `${normalizedOperator}${target}`,
  );
  const upperResult = isVersionCompatible(
    upperProbeVersion,
    `${normalizedOperator}${target}`,
  );
  return lowerResult === upperResult ? lowerResult : undefined;
}

class MarkerParser {
  private index = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly environment: Pep508MarkerEnvironment,
    private readonly options: Pep508MarkerEvaluationOptions,
  ) {}

  parse(): boolean {
    const result = this.parseOr();
    if (this.index !== this.tokens.length) {
      throw new Error('마커 표현식 뒤에 해석되지 않은 토큰이 있습니다.');
    }
    return result ?? this.options.unknownResult ?? false;
  }

  private parseOr(): MarkerEvaluation {
    let result = this.parseAnd();
    while (this.consumeWord('or')) {
      const right = this.parseAnd();
      result = combineOr(result, right);
    }
    return result;
  }

  private parseAnd(): MarkerEvaluation {
    let result = this.parsePrimary();
    while (this.consumeWord('and')) {
      const right = this.parsePrimary();
      result = combineAnd(result, right);
    }
    return result;
  }

  private parsePrimary(): MarkerEvaluation {
    if (this.consume('leftParen')) {
      const result = this.parseOr();
      if (!this.consume('rightParen')) {
        throw new Error('닫는 괄호가 없습니다.');
      }
      return result;
    }
    return this.parseComparison();
  }

  private parseComparison(): MarkerEvaluation {
    const left = this.parseOperand();
    const operator = this.parseOperator();
    const right = this.parseOperand();
    return this.compare(left, operator, right);
  }

  private parseOperand(): Operand {
    const token = this.tokens[this.index];
    if (!token) {
      throw new Error('마커 비교 피연산자가 없습니다.');
    }
    if (token.type === 'string') {
      this.index += 1;
      return { value: token.value };
    }
    if (token.type === 'word') {
      this.index += 1;
      if (!MARKER_VARIABLES.has(token.value as MarkerVariable)) {
        throw new Error(`지원하지 않는 마커 변수: ${token.value}`);
      }
      const variable = token.value as MarkerVariable;
      return {
        value: this.environment[variable],
        variable,
      };
    }
    throw new Error('마커 비교 피연산자 형식이 올바르지 않습니다.');
  }

  private parseOperator(): ComparisonOperator {
    const token = this.tokens[this.index];
    if (token?.type === 'operator') {
      this.index += 1;
      return token.value;
    }
    if (token?.type === 'word' && token.value === 'in') {
      this.index += 1;
      return 'in';
    }
    if (
      token?.type === 'word' &&
      token.value === 'not' &&
      this.tokens[this.index + 1]?.type === 'word' &&
      (this.tokens[this.index + 1] as { type: 'word'; value: string }).value === 'in'
    ) {
      this.index += 2;
      return 'not in';
    }
    throw new Error('지원하지 않는 마커 비교 연산자입니다.');
  }

  private compare(
    left: Operand,
    operator: ComparisonOperator,
    right: Operand,
  ): MarkerEvaluation {
    if (left.value === undefined || right.value === undefined) {
      return undefined;
    }

    const versionVariable = left.variable
      ? VERSION_VARIABLES.has(left.variable)
      : false;
    const reverseVersionVariable = right.variable
      ? VERSION_VARIABLES.has(right.variable)
      : false;

    const incompleteLeft = left.variable
      ? this.options.incompleteVersions?.[
          left.variable as IncompleteVersionVariable
        ]
      : undefined;
    if (incompleteLeft) {
      return compareIncompleteVersion(
        incompleteLeft,
        operator,
        right.value,
      );
    }

    const incompleteRight = right.variable
      ? this.options.incompleteVersions?.[
          right.variable as IncompleteVersionVariable
        ]
      : undefined;
    if (incompleteRight) {
      return compareIncompleteVersion(
        incompleteRight,
        invertOperator(operator),
        left.value,
      );
    }

    let leftValue = left.value;
    let rightValue = right.value;
    if (
      left.variable === 'extra' ||
      right.variable === 'extra'
    ) {
      leftValue = normalizeExtraName(leftValue);
      rightValue = normalizeExtraName(rightValue);
    }
    if (operator === '===') {
      return versionVariable || reverseVersionVariable
        ? leftValue.toLowerCase() === rightValue.toLowerCase()
        : leftValue === rightValue;
    }

    if (
      left.variable === 'platform_machine' ||
      right.variable === 'platform_machine'
    ) {
      leftValue = normalizeMachine(leftValue);
      rightValue = normalizeMachine(rightValue);
    }

    if (
      (versionVariable || reverseVersionVariable) &&
      !['in', 'not in'].includes(operator)
    ) {
      const version = versionVariable ? leftValue : rightValue;
      const target = versionVariable ? rightValue : leftValue;
      const rawVersionOperator = versionVariable
        ? operator
        : invertOperator(operator);
      return isVersionCompatible(
        version,
        `${rawVersionOperator}${target}`,
      );
    }

    switch (operator) {
      case '==':
        return leftValue === rightValue;
      case '!=':
        return leftValue !== rightValue;
      case '<':
        return leftValue < rightValue;
      case '<=':
        return leftValue <= rightValue;
      case '>':
        return leftValue > rightValue;
      case '>=':
        return leftValue >= rightValue;
      case '~=':
        return isVersionCompatible(leftValue, `~=${rightValue}`);
      case 'in':
        return rightValue.includes(leftValue);
      case 'not in':
        return !rightValue.includes(leftValue);
    }
  }

  private consume(type: Token['type']): boolean {
    if (this.tokens[this.index]?.type !== type) {
      return false;
    }
    this.index += 1;
    return true;
  }

  private consumeWord(value: string): boolean {
    const token = this.tokens[this.index];
    if (token?.type !== 'word' || token.value !== value) {
      return false;
    }
    this.index += 1;
    return true;
  }
}

export function evaluatePep508Marker(
  marker: string,
  environment: Pep508MarkerEnvironment,
  options: Pep508MarkerEvaluationOptions = {},
): boolean {
  try {
    return new MarkerParser(
      tokenize(marker),
      environment,
      options,
    ).parse();
  } catch {
    return options.unknownResult ?? false;
  }
}
