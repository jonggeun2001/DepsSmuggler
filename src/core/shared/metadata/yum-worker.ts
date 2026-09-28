import { parentPort } from 'worker_threads';
import { YumPrimaryParser } from '../../downloaders/yum-primary';
import type { Repository } from '../../downloaders/os-shared/types';

parentPort!.on(
  'message',
  (message: { kind: string; data: ArrayBuffer; compressed: boolean; repository: Repository }) => {
    if (message.kind !== 'parse') return;
    try {
      const result = new YumPrimaryParser(message.repository).parse(
        message.data,
        message.compressed
      );
      parentPort!.postMessage({ kind: 'result', result });
    } catch (error) {
      const caught = error as Error;
      parentPort!.postMessage({
        kind: 'result',
        error: { name: caught.name, message: caught.message },
      });
    }
  }
);
