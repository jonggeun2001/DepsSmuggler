import { Readable } from 'stream';
import { PackageFetchPort, PackageHead, PackageRef } from './package-fetch-port';

type FetchLike = typeof fetch;

export interface FetchApiPackageFetchPortOptions {
  fetchImpl?: FetchLike;
  defaultHeaders?: Record<string, string>;
}

export class FetchApiPackageFetchPort implements PackageFetchPort {
  private readonly fetchImpl: FetchLike;
  private readonly defaultHeaders: Record<string, string>;

  constructor(options: FetchApiPackageFetchPortOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.defaultHeaders = options.defaultHeaders ?? {};
  }

  async fetchPackageFile(ref: PackageRef): Promise<NodeJS.ReadableStream> {
    const response = await this.fetchImpl(ref.url, {
      method: 'GET',
      headers: this.createHeaders(ref.headers),
      signal: ref.signal,
    });

    if (!response.ok) {
      throw new Error(`패키지 다운로드 스트림 조회 실패: ${response.status} ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error(`패키지 다운로드 스트림이 비어 있습니다: ${ref.url}`);
    }

    return Readable.fromWeb(response.body as globalThis.ReadableStream<Uint8Array>);
  }

  async headPackage(ref: PackageRef): Promise<PackageHead> {
    const response = await this.fetchImpl(ref.url, {
      method: 'HEAD',
      headers: this.createHeaders(ref.headers),
      signal: ref.signal,
    });

    if (!response.ok) {
      throw new Error(`패키지 HEAD 조회 실패: ${response.status} ${response.statusText}`);
    }

    return {
      url: ref.url,
      status: response.status,
      contentLength: this.parseContentLength(response.headers.get('content-length')),
      contentType: response.headers.get('content-type') ?? undefined,
      etag: response.headers.get('etag') ?? undefined,
      lastModified: response.headers.get('last-modified') ?? undefined,
      headers: this.toHeaderMap(response.headers),
    };
  }

  private createHeaders(headers?: Record<string, string>): Record<string, string> {
    return {
      ...this.defaultHeaders,
      ...(headers ?? {}),
    };
  }

  private parseContentLength(value: string | null): number | undefined {
    if (!value) {
      return undefined;
    }

    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  private toHeaderMap(headers: Headers): Record<string, string> {
    return Object.fromEntries(headers.entries());
  }
}
