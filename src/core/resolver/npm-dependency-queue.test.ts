import { describe, expect, it, vi } from 'vitest';
import { NpmDependencyQueue } from './npm-dependency-queue';
import type { DepsQueueItem } from '../shared/npm-types';

const item = (name: string, depth = 0, path = ''): DepsQueueItem => ({
  name,
  depth,
  path,
  parent: path,
  spec: '1.0.0',
  type: 'prod',
  edge: { from: path, to: null, name, spec: '1.0.0', type: 'prod', valid: false },
});
const compare = (a: DepsQueueItem, b: DepsQueueItem) =>
  a.depth - b.depth || a.path.localeCompare(b.path);

describe('npm dependency priority queue', () => {
  it('깊이와 부모 경로를 비교하고 같은 부모의 형제는 이름과 무관하게 삽입 순서를 유지한다', () => {
    const queue = new NpmDependencyQueue();
    const inputs = [
      item('deep', 2),
      item('z-sibling', 1, 'a'),
      item('a-sibling', 1, 'a'),
      item('root'),
      item('first-parent', 1, 'Z'),
    ];
    inputs.forEach((entry) => queue.push(entry));
    const expected = [...inputs].sort(compare);
    expect(Array.from({ length: inputs.length }, () => queue.pop())).toEqual(expected);
    expect(expected.indexOf(inputs[1])).toBeLessThan(expected.indexOf(inputs[2]));
    expect(queue.length).toBe(0);
    expect(queue.pop()).toBeUndefined();
  });

  it('추가와 소비가 교차해도 기존 stable sort + shift와 같은 객체를 반환한다', () => {
    const queue = new NpmDependencyQueue();
    const legacy: DepsQueueItem[] = [];
    const paths = [
      '',
      'node_modules/z',
      'node_modules/@scope/a',
      'node_modules/A',
      'node_modules/a',
      'node_modules/é',
      'node_modules/e\u0301',
    ];
    const take = () => {
      legacy.sort(compare);
      expect(queue.pop()).toBe(legacy.shift());
      expect(queue.length).toBe(legacy.length);
    };
    for (let i = 0; i < 500; i++) {
      const next = item(`reverse-name-${500 - i}`, (i * 37) % 11, paths[(i * 13) % paths.length]);
      legacy.push(next);
      queue.push(next);
      if (i % 3 === 0) take();
    }
    while (legacy.length) take();
  });

  it('clear 후 이전 대기 항목을 버리고 다시 사용할 수 있다', () => {
    const queue = new NpmDependencyQueue();
    queue.push(item('stale'));
    queue.clear();
    expect(queue.pop()).toBeUndefined();
    queue.push(item('new-z'));
    queue.push(item('new-a'));
    expect(queue.pop()?.name).toBe('new-z');
    expect(queue.pop()?.name).toBe('new-a');
    queue.push(item('single'));
    expect(queue.pop()?.name).toBe('single');
    expect(queue.length).toBe(0);
  });

  it('10,000개 동순위 항목의 비교 횟수는 이차 반복 정렬보다 작고 순서는 같다', () => {
    const queue = new NpmDependencyQueue();
    const compared = vi.spyOn(
      queue as unknown as { compare: (a: unknown, b: unknown) => number },
      'compare'
    );
    const count = 10_000;
    for (let i = 0; i < count; i++) queue.push(item(String(i)));
    for (let i = 0; i < count; i++) expect(queue.pop()?.name).toBe(String(i));
    expect(compared.mock.calls.length).toBeLessThan(count * 40);
    expect(compared.mock.calls.length).toBeLessThan((count * (count - 1)) / 2);
  });
});
