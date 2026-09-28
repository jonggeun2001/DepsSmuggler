import type { DepsQueueItem } from '../shared/npm-types';

interface QueueEntry {
  item: DepsQueueItem;
  sequence: number;
}

/** npm BFS 순서(depth, parentPath, 삽입 순서)를 보존하는 최소 힙. */
export class NpmDependencyQueue {
  private entries: QueueEntry[] = [];
  private sequence = 0;

  get length(): number {
    return this.entries.length;
  }

  clear(): void {
    this.entries = [];
    this.sequence = 0;
  }

  push(item: DepsQueueItem): void {
    const entry = { item, sequence: this.sequence++ };
    let index = this.entries.length;
    this.entries.push(entry);
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.compare(this.entries[parent], entry) <= 0) break;
      this.entries[index] = this.entries[parent];
      index = parent;
    }
    this.entries[index] = entry;
  }

  pop(): DepsQueueItem | undefined {
    const first = this.entries[0];
    const last = this.entries.pop();
    if (!first || !last) return undefined;
    if (this.entries.length > 0) {
      let index = 0;
      while (index * 2 + 1 < this.entries.length) {
        let child = index * 2 + 1;
        const right = child + 1;
        if (
          right < this.entries.length &&
          this.compare(this.entries[right], this.entries[child]) < 0
        ) {
          child = right;
        }
        if (this.compare(last, this.entries[child]) <= 0) break;
        this.entries[index] = this.entries[child];
        index = child;
      }
      this.entries[index] = last;
    }
    return first.item;
  }

  private compare(a: QueueEntry, b: QueueEntry): number {
    // path는 패키지명/최종 설치 경로가 아닌 enqueue 시점의 parentPath다.
    return (
      a.item.depth - b.item.depth ||
      a.item.path.localeCompare(b.item.path) ||
      a.sequence - b.sequence
    );
  }
}
