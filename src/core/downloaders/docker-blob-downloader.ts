/**
 * Docker Blob Downloader
 *
 * Docker Registry에서 Blob(레이어, config) 다운로드 담당
 */

import axios from 'axios';
import * as fsNative from 'fs';
import * as fs from 'fs-extra';
import * as tar from 'tar';
import { pipeline } from 'stream/promises';
import type { Readable, Transform } from 'stream';
import { DockerAuthClient } from './docker-auth-client';
import type { DockerRequestControls } from './docker-types';
import { calculateSha256 } from './docker-utils';
import { createDownloadGate, waitForDownloadResume } from '../shared/download-control';

/**
 * Blob 다운로드 진행률 콜백
 */
export type BlobProgressCallback = (bytes: number) => void;

/**
 * Docker Blob 다운로더
 *
 * Registry에서 Blob 다운로드, 체크섬 검증, tar 패키징
 */
export class DockerBlobDownloader {
  constructor(private authClient: DockerAuthClient) {}

  /**
   * Blob 다운로드
   *
   * @param repository 저장소 (예: library/nginx)
   * @param digest 다이제스트 (sha256:xxx)
   * @param destPath 저장 경로
   * @param token 인증 토큰
   * @param registry 레지스트리 (기본값: docker.io)
   * @param onChunk 청크 콜백 (진행률 추적용)
   */
  async downloadBlob(
    repository: string,
    digest: string,
    destPath: string,
    token: string,
    registry: string = 'docker.io',
    onChunk?: BlobProgressCallback,
    options: DockerRequestControls = {}
  ): Promise<void> {
    await waitForDownloadResume(options);
    const activeToken = options.getAuthToken ? await options.getAuthToken() : token;
    const config = this.authClient.getRegistryConfig(registry);
    const headers: Record<string, string> = {};

    if (activeToken) {
      headers.Authorization = `Bearer ${activeToken}`;
    }

    let source: Readable | undefined;
    let gate: Transform | undefined;
    let ownsFile = false;
    try {
      const response = await axios({
        method: 'GET',
        url: `${config.registryUrl}/${repository}/blobs/${digest}`,
        responseType: 'stream',
        headers,
        ...(options.signal ? { signal: options.signal } : {}),
      });
      source = response.data as Readable;
      options.signal?.throwIfAborted();
      gate = createDownloadGate(options, chunk => onChunk?.(chunk.length));
      const writer = fsNative.createWriteStream(destPath);
      writer.once('open', () => { ownsFile = true; });
      await pipeline(source, gate, writer, { signal: options.signal });
      await waitForDownloadResume(options);
      const expectedHash = digest.replace('sha256:', '');
      if (!(await this.verifyChecksum(destPath, expectedHash))) {
        throw new Error(`Blob 체크섬 검증 실패: ${digest}`);
      }
      await waitForDownloadResume(options);
    } catch (error) {
      source?.destroy();
      if (ownsFile) await fs.remove(destPath);
      throw error;
    } finally {
      gate?.destroy();
    }
  }

  /**
   * 체크섬 검증
   *
   * @param filePath 파일 경로
   * @param expected 예상 해시 (sha256)
   */
  async verifyChecksum(filePath: string, expected: string): Promise<boolean> {
    const actual = await calculateSha256(filePath);
    return actual.toLowerCase() === expected.toLowerCase();
  }

  /**
   * 이미지 tar 파일 생성
   *
   * Docker load 형식의 tar 파일 생성
   *
   * @param sourceDir 소스 디렉토리 (config.json, 레이어들, manifest.json 포함)
   * @param tarPath 생성할 tar 파일 경로
   */
  async createImageTar(sourceDir: string, tarPath: string): Promise<void> {
    await tar.create(
      {
        file: tarPath,
        cwd: sourceDir,
      },
      await fs.readdir(sourceDir)
    );
  }

  /**
   * 여러 Blob 순차 다운로드
   *
   * @param repository 저장소
   * @param blobs 다운로드할 Blob 목록
   * @param destDir 저장 디렉토리
   * @param token 인증 토큰
   * @param registry 레지스트리
   * @param onProgress 전체 진행률 콜백
   */
  async downloadBlobs(
    repository: string,
    blobs: Array<{ digest: string; fileName: string }>,
    destDir: string,
    token: string,
    registry: string,
    onProgress?: (downloadedBytes: number, totalBytes: number) => void,
    options?: DockerRequestControls
  ): Promise<string[]> {
    const paths: string[] = [];

    for (const blob of blobs) {
      const destPath = `${destDir}/${blob.fileName}`;
      await this.downloadBlob(repository, blob.digest, destPath, token, registry, (bytes) => {
        if (onProgress) {
          // 개별 바이트 단위 진행률은 상위에서 관리
          onProgress(bytes, 0);
        }
      }, options);
      paths.push(destPath);
    }

    return paths;
  }
}
