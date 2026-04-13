/**
 * EmailSender 테스트
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import * as nodemailer from 'nodemailer';
import { EmailSender, SmtpConfig, EmailOptions, initializeEmailSender, getEmailSender } from './email-sender';

// nodemailer 모킹
vi.mock('nodemailer', () => {
  const mockSendMail = vi.fn().mockResolvedValue({ messageId: 'test-message-id' });
  const mockVerify = vi.fn().mockResolvedValue(true);
  const mockClose = vi.fn();

  return {
    createTransport: vi.fn().mockReturnValue({
      sendMail: mockSendMail,
      verify: mockVerify,
      close: mockClose,
    }),
  };
});

describe('EmailSender', () => {
  let sender: EmailSender;
  let tempDir: string;
  const mockConfig: SmtpConfig = {
    host: 'smtp.example.com',
    port: 587,
    secure: false,
    auth: {
      user: 'test@example.com',
      pass: 'password123',
    },
    from: 'sender@example.com',
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    sender = new EmailSender(mockConfig);
    // 각 테스트마다 고유한 임시 디렉토리 생성
    tempDir = path.join(os.tmpdir(), `mailer-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.ensureDir(tempDir);
  });

  afterEach(async () => {
    sender.close();
    // 임시 디렉토리 정리
    if (tempDir && await fs.pathExists(tempDir)) {
      await fs.remove(tempDir);
    }
  });

  describe('constructor', () => {
    it('기본 설정으로 인스턴스를 생성해야 함', () => {
      const sender = new EmailSender(mockConfig);
      expect(sender).toBeInstanceOf(EmailSender);
    });

    it('커스텀 최대 첨부파일 크기로 인스턴스를 생성해야 함', () => {
      const customSize = 20 * 1024 * 1024;
      const sender = new EmailSender(mockConfig, customSize);
      expect(sender).toBeInstanceOf(EmailSender);
    });
  });

  describe('testConnection', () => {
    it('연결 테스트 성공 시 true를 반환해야 함', async () => {
      const result = await sender.testConnection();
      expect(result).toBe(true);
      expect(nodemailer.createTransport).toHaveBeenCalledWith({
        host: 'smtp.example.com',
        port: 587,
        secure: false,
        auth: mockConfig.auth,
      });
    });

    it('연결 테스트 실패 시 원본 오류를 던져야 함', async () => {
      const mockTransporter = nodemailer.createTransport({} as nodemailer.TransportOptions);
      vi.mocked(mockTransporter.verify).mockRejectedValueOnce(new Error('Connection failed'));

      await expect(sender.testConnection()).rejects.toThrow('Connection failed');
    });
  });

  describe('sendEmail', () => {
    it('단일 이메일을 성공적으로 발송해야 함', async () => {
      const options: EmailOptions = {
        to: 'recipient@example.com',
        subject: 'Test Email',
        body: 'This is a test email.',
      };

      const result = await sender.sendEmail(options);

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('test-message-id');
      expect(result.emailsSent).toBe(1);
      expect(result.attachmentsSent).toBe(0);
      expect(result.splitApplied).toBe(false);
    });

    it('여러 수신자에게 이메일을 발송해야 함', async () => {
      const options: EmailOptions = {
        to: ['recipient1@example.com', 'recipient2@example.com'],
        subject: 'Test Email',
        body: 'This is a test email.',
      };

      const result = await sender.sendEmail(options);

      expect(result.success).toBe(true);
      expect(result.attachmentsSent).toBe(0);
      expect(result.emailsSent).toBe(1);
    });

    it('HTML 본문으로 이메일을 발송해야 함', async () => {
      const options: EmailOptions = {
        to: 'recipient@example.com',
        subject: 'Test Email',
        html: '<h1>Test</h1><p>This is a test email.</p>',
      };

      const result = await sender.sendEmail(options);

      expect(result.success).toBe(true);
      expect(result.attachmentsSent).toBe(0);
    });

    it('첨부파일과 함께 이메일을 발송해야 함', async () => {
      // 테스트 파일 생성
      const testFile = path.join(tempDir, 'attachment.txt');
      await fs.writeFile(testFile, 'Test attachment content');

      const options: EmailOptions = {
        to: 'recipient@example.com',
        subject: 'Test Email with Attachment',
        body: 'Please see attachment.',
        attachments: [testFile],
      };

      const result = await sender.sendEmail(options);

      expect(result.success).toBe(true);
      expect(result.attachmentsSent).toBe(1);
    });

    it('패키지 정보와 함께 이메일을 발송해야 함', async () => {
      const options: EmailOptions = {
        to: 'recipient@example.com',
        subject: 'Package Delivery',
        body: 'Your packages are attached.',
        packages: [
          { name: 'requests', version: '2.28.0', type: 'pip' },
          { name: 'numpy', version: '1.23.0', type: 'pip' },
          { name: 'spring-core', version: '5.3.0', type: 'maven' },
        ],
      };

      const result = await sender.sendEmail(options);

      expect(result.success).toBe(true);
    });

    it('발송 실패 시 에러를 반환해야 함', async () => {
      const mockTransporter = nodemailer.createTransport({} as nodemailer.TransportOptions);
      vi.mocked(mockTransporter.sendMail).mockRejectedValueOnce(new Error('Send failed'));

      const options: EmailOptions = {
        to: 'recipient@example.com',
        subject: 'Test Email',
        body: 'This is a test email.',
      };

      const result = await sender.sendEmail(options);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Send failed');
    });

    it('존재하지 않는 첨부파일은 무시해야 함', async () => {
      const options: EmailOptions = {
        to: 'recipient@example.com',
        subject: 'Test Email',
        body: 'Test',
        attachments: ['/nonexistent/path/file.txt'],
      };

      const result = await sender.sendEmail(options);

      expect(result.success).toBe(true);
    });
  });

  describe('sendEmail - 분할 발송', () => {
    it('첨부파일 크기가 초과하면 분할 발송해야 함', async () => {
      // 작은 최대 크기 설정
      sender.setMaxAttachmentSize(1024); // 1KB

      // 여러 파일 생성 (총합이 1KB 초과)
      const file1 = path.join(tempDir, 'file1.txt');
      const file2 = path.join(tempDir, 'file2.txt');
      await fs.writeFile(file1, 'a'.repeat(600)); // 600 bytes
      await fs.writeFile(file2, 'b'.repeat(600)); // 600 bytes

      const options: EmailOptions = {
        to: 'recipient@example.com',
        subject: 'Large Files',
        body: 'Please see attachments.',
        attachments: [file1, file2],
      };

      const result = await sender.sendEmail(options);

      expect(result.success).toBe(true);
      expect(result.emailsSent).toBeGreaterThan(1);
      expect(result.attachmentsSent).toBe(2);
    });
  });

  describe('updateConfig', () => {
    it('설정을 업데이트해야 함', () => {
      sender.updateConfig({ host: 'new-smtp.example.com' });
      // 새 연결 시 변경된 설정이 사용되는지 확인
      expect(sender).toBeInstanceOf(EmailSender);
    });

    it('부분 설정만 업데이트해야 함', () => {
      sender.updateConfig({ port: 465, secure: true });
      expect(sender).toBeInstanceOf(EmailSender);
    });
  });

  describe('setMaxAttachmentSize', () => {
    it('최대 첨부파일 크기를 변경해야 함', () => {
      sender.setMaxAttachmentSize(5 * 1024 * 1024);
      expect(sender).toBeInstanceOf(EmailSender);
    });
  });

  describe('close', () => {
    it('연결을 종료해야 함', async () => {
      // 연결을 먼저 초기화
      await sender.testConnection();

      // 연결 종료
      sender.close();

      // 다시 연결 시도 시 새 transporter 생성
      await sender.testConnection();
      expect(nodemailer.createTransport).toHaveBeenCalledTimes(2);
    });

    it('연결이 없을 때 close를 호출해도 에러가 발생하지 않아야 함', () => {
      expect(() => sender.close()).not.toThrow();
    });
  });
});

describe('싱글톤 팩토리 함수', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 싱글톤 인스턴스 초기화를 위해 모듈 리셋
    vi.resetModules();
  });

  it('initializeEmailSender가 새 인스턴스를 생성해야 함', async () => {
    const { initializeEmailSender, EmailSender: ES } = await import('./email-sender');
    const config: SmtpConfig = {
      host: 'smtp.test.com',
      port: 587,
      secure: false,
      auth: { user: 'test@test.com', pass: 'pass' },
    };

    const sender = initializeEmailSender(config);
    expect(sender).toBeInstanceOf(ES);
    expect(sender.constructor.name).toBe('EmailSender');
  });

  it('initializeEmailSender가 커스텀 최대 크기로 인스턴스를 생성해야 함', async () => {
    const { initializeEmailSender, EmailSender: ES } = await import('./email-sender');
    const config: SmtpConfig = {
      host: 'smtp.test.com',
      port: 587,
      secure: false,
      auth: { user: 'test@test.com', pass: 'pass' },
    };

    const sender = initializeEmailSender(config, 25 * 1024 * 1024);
    expect(sender).toBeInstanceOf(ES);
  });

  it('getEmailSender가 초기화 없이 호출되면 에러를 발생시켜야 함', async () => {
    const { getEmailSender } = await import('./email-sender');
    expect(() => getEmailSender()).toThrow('EmailSender가 초기화되지 않았습니다');
  });

  it('getEmailSender가 config와 함께 호출되면 인스턴스를 생성해야 함', async () => {
    const { getEmailSender, EmailSender: ES } = await import('./email-sender');
    const config: SmtpConfig = {
      host: 'smtp.test.com',
      port: 587,
      secure: false,
      auth: { user: 'test@test.com', pass: 'pass' },
    };

    const sender = getEmailSender(config);
    expect(sender).toBeInstanceOf(ES);
  });

  it('getEmailSender가 동일한 싱글톤 인스턴스를 반환해야 함', async () => {
    const { getEmailSender, initializeEmailSender } = await import('./email-sender');
    const config: SmtpConfig = {
      host: 'smtp.test.com',
      port: 587,
      secure: false,
      auth: { user: 'test@test.com', pass: 'pass' },
    };

    initializeEmailSender(config);
    const sender1 = getEmailSender();
    const sender2 = getEmailSender();
    expect(sender1).toBe(sender2);
  });
});

describe('HTML 본문 생성', () => {
  let sender: EmailSender;
  const mockConfig: SmtpConfig = {
    host: 'smtp.example.com',
    port: 587,
    secure: false,
    auth: { user: 'test@example.com', pass: 'pass' },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    sender = new EmailSender(mockConfig);
  });

  afterEach(() => {
    sender.close();
  });

  it('다양한 패키지 타입을 포함한 HTML을 생성해야 함', async () => {
    const options: EmailOptions = {
      to: 'recipient@example.com',
      subject: 'Package Delivery',
      packages: [
        { name: 'requests', version: '2.28.0', type: 'pip' },
        { name: 'numpy', version: '1.23.0', type: 'pip', arch: 'x86_64' },
        { name: 'spring-core', version: '5.3.0', type: 'maven' },
        { name: 'nginx', version: 'latest', type: 'docker' },
        { name: 'httpd', version: '2.4.6', type: 'yum' },
      ],
    };

    const result = await sender.sendEmail(options);
    expect(result.success).toBe(true);
  });

  it('사용자 정의 본문을 포함한 HTML을 생성해야 함', async () => {
    const options: EmailOptions = {
      to: 'recipient@example.com',
      subject: 'Custom Message',
      body: 'This is a custom message with special instructions.',
      packages: [],
    };

    const result = await sender.sendEmail(options);
    expect(result.success).toBe(true);
  });

  it('패키지 없이도 HTML을 생성해야 함', async () => {
    const options: EmailOptions = {
      to: 'recipient@example.com',
      subject: 'No Packages',
      body: 'No packages attached.',
    };

    const result = await sender.sendEmail(options);
    expect(result.success).toBe(true);
  });
});

describe('첨부파일 처리', () => {
  let sender: EmailSender;
  let tempDir: string;
  const mockConfig: SmtpConfig = {
    host: 'smtp.example.com',
    port: 587,
    secure: false,
    auth: { user: 'test@example.com', pass: 'pass' },
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    sender = new EmailSender(mockConfig);
    tempDir = path.join(os.tmpdir(), `mailer-attach-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.ensureDir(tempDir);
  });

  afterEach(async () => {
    sender.close();
    if (tempDir && await fs.pathExists(tempDir)) {
      await fs.remove(tempDir);
    }
  });

  it('여러 첨부파일을 처리해야 함', async () => {
    const files: string[] = [];
    for (let i = 0; i < 3; i++) {
      const file = path.join(tempDir, `file${i}.txt`);
      await fs.writeFile(file, `Content ${i}`);
      files.push(file);
    }

    const options: EmailOptions = {
      to: 'recipient@example.com',
      subject: 'Multiple Attachments',
      body: 'See attached files.',
      attachments: files,
    };

    const result = await sender.sendEmail(options);
    expect(result.success).toBe(true);
  });

  it('존재하는 파일과 존재하지 않는 파일이 섞여 있을 때 처리해야 함', async () => {
    const existingFile = path.join(tempDir, 'existing.txt');
    await fs.writeFile(existingFile, 'Existing content');

    const options: EmailOptions = {
      to: 'recipient@example.com',
      subject: 'Mixed Attachments',
      body: 'See attached files.',
      attachments: [existingFile, '/nonexistent/file.txt'],
    };

    const result = await sender.sendEmail(options);
    expect(result.success).toBe(true);
  });

  it('빈 첨부파일 배열을 처리해야 함', async () => {
    const options: EmailOptions = {
      to: 'recipient@example.com',
      subject: 'No Attachments',
      body: 'No attachments.',
      attachments: [],
    };

    const result = await sender.sendEmail(options);
    expect(result.success).toBe(true);
  });
});

describe('발신자 주소', () => {
  it('from이 설정되지 않으면 auth.user를 발신자로 사용해야 함', async () => {
    const configWithoutFrom: SmtpConfig = {
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      auth: { user: 'sender@example.com', pass: 'pass' },
    };

    const sender = new EmailSender(configWithoutFrom);

    const options: EmailOptions = {
      to: 'recipient@example.com',
      subject: 'Test',
      body: 'Test',
    };

    const result = await sender.sendEmail(options);
    expect(result.success).toBe(true);

    sender.close();
  });

  it('auth 없이도 from 주소로 발송 설정을 구성할 수 있어야 함', async () => {
    const sender = new EmailSender({
      host: 'smtp.example.com',
      port: 25,
      secure: false,
      from: 'sender@example.com',
    });

    const result = await sender.sendEmail({
      to: 'recipient@example.com',
      subject: 'No Auth',
      body: 'Test',
    });

    expect(result.success).toBe(true);
    expect(result.attachmentsSent).toBe(0);

    sender.close();
  });
});
