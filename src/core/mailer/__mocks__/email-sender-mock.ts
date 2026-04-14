import { vi } from 'vitest';
import type { EmailSender } from '../email-sender';

type EmailSenderPublicMethods = Pick<
  EmailSender,
  'sendEmail' | 'testConnection' | 'updateConfig' | 'setMaxAttachmentSize' | 'close'
>;

export type EmailSenderMock = EmailSenderPublicMethods;

export function createEmailSenderMock(
  overrides: Partial<EmailSenderMock> = {}
): EmailSenderMock {
  return {
    sendEmail: vi.fn().mockResolvedValue({
      success: true,
      messageId: 'mock-message-id',
      emailsSent: 1,
      attachmentsSent: 1,
      splitApplied: false,
    }),
    testConnection: vi.fn().mockResolvedValue(true),
    updateConfig: vi.fn(),
    setMaxAttachmentSize: vi.fn(),
    close: vi.fn(),
    ...overrides,
  } satisfies EmailSenderMock;
}
