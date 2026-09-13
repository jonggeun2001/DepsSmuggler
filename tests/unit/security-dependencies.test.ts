import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmailSender } from '../../src/core/mailer/email-sender';
import type { SendMailOptions } from 'nodemailer';

const capturedMessages: Buffer[] = [];

vi.mock('nodemailer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('nodemailer')>();

  return {
    ...actual,
    createTransport: vi.fn(() => {
      const transport = actual.createTransport({
        buffer: true,
        streamTransport: true,
      });
      const sendMail = transport.sendMail.bind(transport);

      vi.spyOn(transport, 'sendMail').mockImplementation(async (mail: SendMailOptions) => {
        const info = await sendMail(mail);
        if (!Buffer.isBuffer(info.message)) {
          throw new Error('Stream transport did not return a MIME buffer');
        }
        capturedMessages.push(info.message);
        return info;
      });
      return transport;
    }),
  };
});

vi.mock('../../src/utils/logger', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const temporaryDirectories: string[] = [];

afterEach(async () => {
  capturedMessages.length = 0;
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe('보안 의존성 업그레이드 호환성', () => {
  it('실제 Nodemailer stream transport가 EmailSender 첨부파일을 MIME base64로 생성한다', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'depssmuggler-nodemailer-'));
    temporaryDirectories.push(directory);
    const attachmentPath = path.join(directory, 'release-notes.txt');
    const attachmentContents = 'offline package payload\n';
    await writeFile(attachmentPath, attachmentContents, 'utf8');

    const sender = new EmailSender({
      host: 'smtp.example.test',
      port: 587,
      secure: false,
      from: 'sender@example.test',
    });

    try {
      const result = await sender.sendEmail({
        to: 'recipient@example.test',
        subject: 'DepsSmuggler security regression',
        body: 'The package is ready.',
        attachments: [attachmentPath],
      });

      expect(result).toMatchObject({
        success: true,
        attachmentsSent: 1,
        emailsSent: 1,
      });
      expect(capturedMessages).toHaveLength(1);

      const message = capturedMessages[0].toString('utf8');
      expect(message).toContain('Subject: DepsSmuggler security regression');
      expect(message).toContain('Content-Disposition: attachment; filename=release-notes.txt');
      expect(message).toContain(Buffer.from(attachmentContents, 'utf8').toString('base64'));
      expect(await readFile(attachmentPath, 'utf8')).toBe(attachmentContents);
    } finally {
      sender.close();
    }
  });

  it('실제 sharp가 추적 SVG를 임시 PNG로 resize하고 결과 metadata를 읽는다', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'depssmuggler-sharp-'));
    temporaryDirectories.push(directory);
    const outputPath = path.join(directory, 'icon-64.png');
    const sourcePath = path.resolve('assets/icons/icon.svg');

    await sharp(sourcePath).resize(64, 64).png().toFile(outputPath);

    const metadata = await sharp(outputPath).metadata();
    expect(metadata).toMatchObject({
      format: 'png',
      width: 64,
      height: 64,
    });
    expect((await stat(outputPath)).size).toBeGreaterThan(0);
  });
});
