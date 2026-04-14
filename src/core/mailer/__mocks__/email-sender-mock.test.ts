import { describe, expect, it } from 'vitest';
import { createEmailSenderMock } from './email-sender-mock';

describe('createEmailSenderMock', () => {
  it('EmailSender의 public 메서드를 모두 제공한다', async () => {
    const sender = createEmailSenderMock();

    await expect(sender.testConnection()).resolves.toBe(true);
    await expect(
      sender.sendEmail({
        to: 'offline@example.com',
        subject: 'test',
      })
    ).resolves.toEqual(
      expect.objectContaining({
        success: true,
        emailsSent: 1,
      })
    );

    sender.updateConfig({ host: 'smtp.example.com' });
    sender.setMaxAttachmentSize(1024);
    sender.close();

    expect(sender.testConnection).toHaveBeenCalledTimes(1);
    expect(sender.sendEmail).toHaveBeenCalledTimes(1);
    expect(sender.updateConfig).toHaveBeenCalledWith({ host: 'smtp.example.com' });
    expect(sender.setMaxAttachmentSize).toHaveBeenCalledWith(1024);
    expect(sender.close).toHaveBeenCalledTimes(1);
  });
});
