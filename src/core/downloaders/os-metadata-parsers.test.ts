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

  const createYumRepomdXml = (): string => [
    '<repomd>',
    '  <revision>123</revision>',
    '  <data type="primary">',
    '    <checksum type="sha256">deadbeef</checksum>',
    '    <location href="repodata/primary.xml.gz" />',
    '  </data>',
    '</repomd>',
  ].join('');

  const createYumPrimaryXml = (description: string, summary: string): string => [
    '<metadata>',
    '  <package>',
    '    <name>zlib</name>',
    '    <arch>x86_64</arch>',
    '    <version epoch="0" ver="1.2.13" rel="1.el9" />',
    '    <checksum type="sha256">feedface</checksum>',
    `    <summary>${summary}</summary>`,
    `    <description>${description}</description>`,
    '    <size package="4096" installed="8192" />',
    '    <location href="Packages/z/zlib.rpm" />',
    '  </package>',
    '</metadata>',
  ].join('');

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

  it('APT parser는 원본 control fields와 multiline 의미를 JSON-safe record로 보존한다', async () => {
    const parser = new AptMetadataParser(
      { ...repo, baseUrl: 'https://archive.ubuntu.test/ubuntu/dists/jammy/main' },
      'main',
      'amd64'
    );
    const packagesContent = [
      'Package: raw-package',
      'Version: 1.0-1',
      'Architecture: amd64',
      'Size: 1234',
      'Installed-Size: 42',
      'Filename: pool/main/r/raw-package_1.0-1_amd64.deb',
      'MD5sum: stale-md5',
      'SHA1: stale-sha1',
      'SHA256: original-sha256',
      'SHA512: stale-sha512',
      'Depends: foo (>= 1.2) | bar',
      'Pre-Depends: init-system (>= 1.0)',
      'Provides: virtual-raw (= 1.0), plain-virtual',
      'Conflicts: old-package (<< 2.0)',
      'Breaks: broken-package',
      'Replaces: replaced-package',
      'Multi-Arch: same',
      'Description: Raw summary',
      ' continuation line',
      ' .',
      ' final line',
    ].join('\n');
    fetchMock.mockResolvedValue(
      new Response(gzipSync(packagesContent), { status: 200 })
    );

    const packages = await parser.parsePackages();
    const packageInfo = packages[0];

    expect(packageInfo.aptControlFields).toEqual(expect.objectContaining({
      Depends: 'foo (>= 1.2) | bar',
      'Pre-Depends': 'init-system (>= 1.0)',
      Provides: 'virtual-raw (= 1.0), plain-virtual',
      Conflicts: 'old-package (<< 2.0)',
      Breaks: 'broken-package',
      Replaces: 'replaced-package',
      'Multi-Arch': 'same',
      Description: 'Raw summary\ncontinuation line\n.\nfinal line',
    }));
    expect(packageInfo.aptControlFields).not.toBeInstanceOf(Map);
  });

  it('APK parser는 인덱스 아카이브의 capability 의존성과 provides를 보존한다', async () => {
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
        'D:so:libc.musl-x86_64.so.1=1.0 cmd:sh>=1.0 pc:bar=2.0 ssl-client>=1.0',
        'p:cmd:sh=1.0 so:libcrypto.so.3=3.0.0 pc:bar=2.0',
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
          { name: 'so:libc.musl-x86_64.so.1', operator: '=', version: '1.0' },
          { name: 'cmd:sh', operator: '>=', version: '1.0' },
          { name: 'pc:bar', operator: '=', version: '2.0' },
          expect.objectContaining({
            name: 'ssl-client',
            operator: '>=',
            version: '1.0',
          }),
        ],
        provides: ['cmd:sh=1.0', 'so:libcrypto.so.3=3.0.0', 'pc:bar=2.0'],
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
    expect(repomd.primary).toBeDefined();
    const packages = await parser.parsePrimary(repomd.primary?.location ?? '');

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

  it('YUM parser는 1000개를 초과하는 표준 entity와 amp entity를 보존해 파싱한다', async () => {
    const parser = new YumMetadataParser(
      {
        ...repo,
        id: 'rocky-9-baseos',
        baseUrl: 'https://mirror.example.test/$releasever/BaseOS/$basearch/os',
      },
      'x86_64'
    );
    const expandedDescription = '"'.repeat(1001);
    fetchMock
      .mockResolvedValueOnce(new Response(createYumRepomdXml()))
      .mockResolvedValueOnce(
        new Response(gzipSync(createYumPrimaryXml('&quot;'.repeat(1001), 'Rocky &amp; BaseOS')))
      );

    const repomd = await parser.parseRepomd();
    expect(repomd.primary).toBeDefined();
    const packages = await parser.parsePrimary(repomd.primary?.location ?? '');

    expect(packages).toEqual([
      expect.objectContaining({
        name: 'zlib',
        summary: 'Rocky & BaseOS',
        description: expandedDescription,
      }),
    ]);
  });

  it('YUM parser는 유한 entity expansion 한도를 초과하면 실패한다', async () => {
    const parser = new YumMetadataParser(
      {
        ...repo,
        id: 'rocky-9-baseos',
        baseUrl: 'https://mirror.example.test/$releasever/BaseOS/$basearch/os',
      },
      'x86_64'
    );
    fetchMock
      .mockResolvedValueOnce(new Response(createYumRepomdXml()))
      .mockResolvedValueOnce(
        new Response(gzipSync(createYumPrimaryXml('&quot;'.repeat(100001), 'Rocky &amp; BaseOS')))
      );

    const repomd = await parser.parseRepomd();
    expect(repomd.primary).toBeDefined();

    await expect(parser.parsePrimary(repomd.primary?.location ?? '')).rejects.toThrow(/100000/);
  });

  it.each(['repomd', 'primary'] as const)('YUM parser는 %s fetch의 AbortError identity를 보존한다', async (target) => {
    const parser = new YumMetadataParser(
      {
        ...repo,
        id: 'rocky-9-baseos',
        baseUrl: 'https://mirror.example.test/$releasever/BaseOS/$basearch/os',
      },
      'x86_64'
    );
    const abortError = new Error(`cancelled ${target}`);
    abortError.name = 'AbortError';
    fetchMock.mockRejectedValueOnce(abortError);

    const parse = target === 'repomd'
      ? parser.parseRepomd()
      : parser.parsePrimary('repodata/primary.xml.gz');

    await expect(parse).rejects.toBe(abortError);
  });
});
