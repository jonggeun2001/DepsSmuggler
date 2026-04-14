import { gzipSync } from 'zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApkMetadataParser } from './apk';
import { AptMetadataParser } from './apt';
import { YumMetadataParser } from './yum';
import type { Repository } from './os-shared/types';

describe('OS metadata parsers', () => {
  const fetchMock = vi.fn();
  const repo: Repository = {
    id: 'repo',
    name: 'Main Repo',
    baseUrl: 'https://example.test/repo',
    enabled: true,
    gpgCheck: false,
    isOfficial: true,
  };

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('APT parser는 component 포함 baseUrl과 대체 의존성을 처리한다', async () => {
    const parser = new AptMetadataParser(
      {
        ...repo,
        baseUrl: 'https://archive.ubuntu.test/ubuntu/dists/jammy/main',
      },
      'main',
      'amd64'
    );
    const packagesContent = [
      'Package: libc6',
      'Version: 2.35-0ubuntu3',
      'Architecture: amd64',
      'Size: 1024',
      'Filename: pool/main/g/glibc/libc6_2.35_amd64.deb',
      'SHA256: deadbeef',
      'Depends: libgcc-s1 (>= 3.0) | libgcc1',
      'Suggests: glibc-doc',
      'Recommends: locales',
      'Provides: libc6-abi',
      'Description: GNU C Library',
      ' More details',
    ].join('\n');
    fetchMock.mockResolvedValue(
      new Response(gzipSync(packagesContent), {
        status: 200,
        headers: { 'content-type': 'application/gzip' },
      })
    );

    const packages = await parser.parsePackages();

    expect(fetchMock).toHaveBeenCalledWith(
      'https://archive.ubuntu.test/ubuntu/dists/jammy/main/binary-amd64/Packages.gz',
      expect.anything()
    );
    expect(packages).toEqual([
      expect.objectContaining({
        name: 'libc6',
        summary: 'GNU C Library',
        provides: ['libc6-abi'],
        suggests: ['glibc-doc'],
        recommends: ['locales'],
        dependencies: [
          expect.objectContaining({
            name: 'libgcc-s1',
            operator: '>=',
            version: '3.0',
          }),
        ],
      }),
    ]);
  });

  it('APK parser는 인덱스 아카이브를 읽고 시스템 의존성을 제외한다', async () => {
    const parser = new ApkMetadataParser(repo, 'x86_64');
    vi.spyOn(parser as never, 'extractApkIndex').mockResolvedValue(
      [
        'P:busybox',
        'V:1.36.1-r0',
        'A:x86_64',
        'S:1024',
        'I:2048',
        'T:Busybox utilities',
        'L:GPL-2.0-only',
        'C:Q1YWJjZA==',
        'D:so:libc.musl-x86_64.so.1 cmd:sh ssl-client>=1.0',
        'p:cmd:sh so:libcrypto.so.3=3.0.0',
      ].join('\n')
    );
    fetchMock.mockResolvedValue(new Response(gzipSync('placeholder')));

    const packages = await parser.parseIndex();

    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.test/repo/x86_64/APKINDEX.tar.gz',
      expect.anything()
    );
    expect(packages).toEqual([
      expect.objectContaining({
        name: 'busybox',
        location: 'x86_64/busybox-1.36.1-r0.apk',
        checksum: { type: 'sha1', value: 'YWJjZA==' },
        dependencies: [
          expect.objectContaining({
            name: 'ssl-client',
            operator: '>=',
            version: '1.0',
          }),
        ],
        provides: ['cmd:sh', 'so:libcrypto.so.3=3.0.0'],
      }),
    ]);
  });

  it('YUM parser는 repomd와 primary.xml.gz를 읽어 시스템 requires를 제외한다', async () => {
    const parser = new YumMetadataParser(
      {
        ...repo,
        id: 'rocky-9-baseos',
        baseUrl: 'https://mirror.example.test/$releasever/BaseOS/$basearch/os',
      },
      'x86_64'
    );
    const repomdXml = [
      '<repomd>',
      '  <revision>123</revision>',
      '  <data type="primary">',
      '    <checksum type="sha256">deadbeef</checksum>',
      '    <location href="repodata/primary.xml.gz" />',
      '  </data>',
      '  <data type="filelists">',
      '    <checksum type="sha256">f1</checksum>',
      '    <location href="repodata/filelists.xml.gz" />',
      '  </data>',
      '</repomd>',
    ].join('');
    const primaryXml = [
      '<metadata>',
      '  <package>',
      '    <name>openssl-libs</name>',
      '    <arch>x86_64</arch>',
      '    <version epoch="1" ver="3.0.0" rel="1.el9" />',
      '    <checksum type="sha256">feedface</checksum>',
      '    <summary>OpenSSL libraries</summary>',
      '    <description>Crypto libs</description>',
      '    <size package="4096" installed="8192" />',
      '    <location href="Packages/o/openssl-libs.rpm" />',
      '    <format>',
      '      <rpm:license>OpenSSL</rpm:license>',
      '      <rpm:requires>',
      '        <rpm:entry name="rpmlib(CompressedFileNames)" flags="EQ" ver="3.0.4-1" />',
      '        <rpm:entry name="libcrypto.so.3()(64bit)" flags="GE" ver="3.0.0" />',
      '        <rpm:entry name="openssl" flags="EQ" ver="3.0.0" pre="1" />',
      '      </rpm:requires>',
      '      <rpm:provides>',
      '        <rpm:entry name="libcrypto.so.3()(64bit)" />',
      '      </rpm:provides>',
      '    </format>',
      '  </package>',
      '</metadata>',
    ].join('');
    fetchMock
      .mockResolvedValueOnce(new Response(repomdXml))
      .mockResolvedValueOnce(new Response(gzipSync(primaryXml)));

    const repomd = await parser.parseRepomd();
    const packages = await parser.parsePrimary(repomd.primary!.location);

    expect(repomd).toEqual(
      expect.objectContaining({
        revision: '123',
        primary: expect.objectContaining({
          location: 'repodata/primary.xml.gz',
          checksum: { type: 'sha256', value: 'deadbeef' },
        }),
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://mirror.example.test/9/BaseOS/x86_64/os/repodata/repomd.xml',
      expect.anything()
    );
    expect(packages).toEqual([
      expect.objectContaining({
        name: 'openssl-libs',
        epoch: 1,
        release: '1.el9',
        provides: ['libcrypto.so.3()(64bit)'],
        dependencies: [
          expect.objectContaining({
            name: 'libcrypto.so.3()(64bit)',
            operator: '>=',
            version: '3.0.0',
            isOptional: false,
          }),
          expect.objectContaining({
            name: 'openssl',
            operator: '=',
            version: '3.0.0',
            isOptional: true,
          }),
        ],
      }),
    ]);
  });
});
