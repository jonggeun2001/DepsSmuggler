import * as path from 'path';
import * as fs from 'fs-extra';
import * as nodemailer from 'nodemailer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmailSender } from './email-sender';

const transport = vi.hoisted(() => ({ sendMail: vi.fn(), verify: vi.fn(), close: vi.fn() }));
const pathExists = vi.hoisted(() => vi.fn<(path: string) => Promise<boolean>>());
vi.mock('nodemailer', () => ({ createTransport: vi.fn() }));
vi.mock('fs-extra', () => ({ pathExists, stat: vi.fn() }));
vi.mock('../../utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe('메일 전달 오류 및 첨부 크기 경계', () => {
  let sender: EmailSender;
  const options = { to: 'recipient@example.test', subject: '패키지 전달' };

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(nodemailer.createTransport).mockReturnValue(transport as never);
    transport.sendMail.mockResolvedValue({ messageId: 'sent' });
    pathExists.mockResolvedValue(true);
    sender = new EmailSender(
      { host: 'smtp.example.test', port: 587, secure: false, from: 'sender@example.test' },
      10
    );
  });
  afterEach(() => sender.close());

  it.each(['pathExists', 'stat'] as const)(
    '첨부파일 %s 권한 오류가 나면 발송하지 않는다',
    async (operation) => {
      vi.mocked(fs[operation]).mockRejectedValue(
        Object.assign(new Error('EACCES: attachment'), { code: 'EACCES' })
      );
      await expect(
        sender.sendEmail({ ...options, attachments: [path.join('restricted', 'package.zip')] })
      ).resolves.toEqual({ success: false, error: 'EACCES: attachment' });
      expect(transport.sendMail).not.toHaveBeenCalled();
    }
  );

  it('첨부 크기가 제한과 정확히 같으면 단일 메일로 발송한다', async () => {
    vi.mocked(fs.stat).mockResolvedValue({ size: 5 } as never);
    const attachments = [path.join('packages', 'one.zip'), path.join('packages', 'two.zip')];
    await expect(sender.sendEmail({ ...options, attachments })).resolves.toMatchObject({
      success: true,
      emailsSent: 1,
      attachmentsSent: 2,
    });
    expect(transport.sendMail).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        subject: options.subject,
        attachments: attachments.map((file) => ({ filename: path.basename(file), path: file })),
      })
    );
  });

  it('합계가 제한을 넘으면 순서를 유지하면서 그룹별 첨부와 제목을 발송한다', async () => {
    const sizes = new Map([
      ['one.zip', 5],
      ['two.zip', 5],
      ['three.zip', 1],
    ]);
    vi.mocked(fs.stat).mockImplementation(
      async (file) => ({ size: sizes.get(String(file)) }) as never
    );
    transport.sendMail
      .mockResolvedValueOnce({ messageId: 'first' })
      .mockResolvedValueOnce({ messageId: 'second' });
    await expect(
      sender.sendEmail({ ...options, attachments: [...sizes.keys()] })
    ).resolves.toMatchObject({
      success: true,
      messageId: 'first, second',
      emailsSent: 2,
      attachmentsSent: 3,
    });
    expect(
      transport.sendMail.mock.calls.map(([mail]) => ({
        subject: mail.subject,
        files: mail.attachments.map((entry: { path: string }) => entry.path),
      }))
    ).toEqual([
      { subject: '패키지 전달 (1/2)', files: ['one.zip', 'two.zip'] },
      { subject: '패키지 전달 (2/2)', files: ['three.zip'] },
    ]);
  });

  it('첫 그룹에서 인증이 거부되면 나머지 그룹을 보내지 않는다', async () => {
    vi.mocked(fs.stat).mockResolvedValue({ size: 6 } as never);
    transport.sendMail.mockRejectedValue(
      Object.assign(new Error('535 Authentication failed'), { code: 'EAUTH' })
    );
    await expect(
      sender.sendEmail({ ...options, attachments: ['one.zip', 'two.zip'] })
    ).resolves.toMatchObject({
      success: false,
      error: '535 Authentication failed',
      emailsSent: 0,
      attachmentsSent: 0,
    });
    expect(transport.sendMail).toHaveBeenCalledOnce();
  });

  it('수신자 입력을 SMTP가 거부하면 실패 결과를 반환한다', async () => {
    transport.sendMail.mockRejectedValue(
      Object.assign(new Error('No recipients defined'), { code: 'EENVELOPE' })
    );
    await expect(sender.sendEmail({ ...options, to: '' })).resolves.toEqual({
      success: false,
      error: 'No recipients defined',
    });
  });

  it('전송기 생성 실패는 첨부를 읽거나 발송하기 전에 반환한다', async () => {
    vi.mocked(nodemailer.createTransport).mockImplementation(() => {
      throw new Error('invalid SMTP configuration');
    });
    await expect(sender.sendEmail({ ...options, attachments: ['one.zip'] })).resolves.toEqual({
      success: false,
      error: 'invalid SMTP configuration',
    });
    expect(fs.pathExists).not.toHaveBeenCalled();
    expect(transport.sendMail).not.toHaveBeenCalled();
  });

  it('SMTP 검증 실패 뒤 재시도할 수 있으며 메일은 발송하지 않는다', async () => {
    const failure = Object.assign(new Error('535 Authentication failed'), { code: 'EAUTH' });
    transport.verify.mockRejectedValueOnce(failure).mockResolvedValueOnce(true);
    await expect(sender.testConnection()).rejects.toBe(failure);
    await expect(sender.testConnection()).resolves.toBe(true);
    expect(nodemailer.createTransport).toHaveBeenCalledOnce();
    expect(transport.sendMail).not.toHaveBeenCalled();
  });
});
