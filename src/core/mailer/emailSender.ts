/**
 * SMTP 메일 발송 기능
 * 설정된 SMTP 서버로 압축 파일을 첨부하여 메일 발송
 */

import * as nodemailer from 'nodemailer';
import * as fs from 'fs-extra';
import * as path from 'path';
import { PackageInfo } from '../../types';
import logger from '../../utils/logger';

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean; // true for 465, false for other ports
  auth: {
    user: string;
    pass: string;
  };
  from?: string; // 발신자 주소
}

export interface EmailOptions {
  to: string | string[];
  subject: string;
  body?: string;
  html?: string;
  attachments?: string[];
  packages?: PackageInfo[];
}

export interface SendResult {
  success: boolean;
  messageId?: string;
  error?: string;
  emailsSent?: number;
}

const DEFAULT_MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * 이메일 발송 클래스
 */
export class EmailSender {
  private transporter: nodemailer.Transporter | null = null;
  private config: SmtpConfig;
  private maxAttachmentSize: number;

  constructor(config: SmtpConfig, maxAttachmentSize: number = DEFAULT_MAX_ATTACHMENT_SIZE) {
    this.config = config;
    this.maxAttachmentSize = maxAttachmentSize;
  }

  /**
   * SMTP 연결 초기화
   */
  private async initTransporter(): Promise<void> {
    if (this.transporter) return;

    this.transporter = nodemailer.createTransport({
      host: this.config.host,
      port: this.config.port,
      secure: this.config.secure,
      auth: this.config.auth,
    });
  }

  /**
   * SMTP 연결 테스트
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.initTransporter();
      await this.transporter!.verify();
      logger.info('SMTP 연결 테스트 성공');
      return true;
    } catch (error) {
      logger.error('SMTP 연결 테스트 실패', { error });
      return false;
    }
  }

  /**
   * 이메일 발송
   */
  async sendEmail(options: EmailOptions): Promise<SendResult> {
    try {
      await this.initTransporter();

      const { to, subject, body, html, attachments = [], packages = [] } = options;

      // HTML 본문 생성
      const htmlContent = html || this.generateHtmlBody(body || '', packages);

      // 첨부 파일 처리
      const mailAttachments = await this.prepareAttachments(attachments);

      // 첨부 파일 크기 체크
      const totalSize = await this.calculateTotalSize(attachments);

      if (totalSize > this.maxAttachmentSize) {
        logger.warn('첨부 파일 크기가 설정 크기를 초과합니다', {
          totalSize,
          maxSize: this.maxAttachmentSize,
        });

        // 분할 발송
        return await this.sendSplitEmails(options, attachments);
      }

      // 단일 메일 발송
      const mailOptions: nodemailer.SendMailOptions = {
        from: this.config.from || this.config.auth.user,
        to: Array.isArray(to) ? to.join(', ') : to,
        subject,
        text: body,
        html: htmlContent,
        attachments: mailAttachments,
      };

      const info = await this.transporter!.sendMail(mailOptions);

      logger.info('이메일 발송 성공', { messageId: info.messageId, to });

      return {
        success: true,
        messageId: info.messageId,
        emailsSent: 1,
      };
    } catch (error) {
      const errorMessage = (error as Error).message;
      logger.error('이메일 발송 실패', { error: errorMessage });

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * 분할된 파일을 여러 메일로 발송
   */
  private async sendSplitEmails(
    options: EmailOptions,
    attachments: string[]
  ): Promise<SendResult> {
    const { to, subject, body, packages = [] } = options;
    const groups = await this.groupAttachmentsBySize(attachments);
    let emailsSent = 0;
    const messageIds: string[] = [];

    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      const partSubject = `${subject} (${i + 1}/${groups.length})`;
      const partBody = i === 0
        ? this.generateHtmlBody(body || '', packages, i + 1, groups.length)
        : this.generatePartBody(i + 1, groups.length);

      const mailAttachments = await this.prepareAttachments(group);

      const mailOptions: nodemailer.SendMailOptions = {
        from: this.config.from || this.config.auth.user,
        to: Array.isArray(to) ? to.join(', ') : to,
        subject: partSubject,
        html: partBody,
        attachments: mailAttachments,
      };

      const info = await this.transporter!.sendMail(mailOptions);
      messageIds.push(info.messageId);
      emailsSent++;

      logger.info(`분할 이메일 발송 (${i + 1}/${groups.length})`, {
        messageId: info.messageId,
      });
    }

    return {
      success: true,
      messageId: messageIds.join(', '),
      emailsSent,
    };
  }

  /**
   * 첨부 파일을 크기별로 그룹화
   */
  private async groupAttachmentsBySize(attachments: string[]): Promise<string[][]> {
    const groups: string[][] = [];
    let currentGroup: string[] = [];
    let currentSize = 0;

    for (const file of attachments) {
      const stat = await fs.stat(file);
      const fileSize = stat.size;

      if (currentSize + fileSize > this.maxAttachmentSize && currentGroup.length > 0) {
        groups.push(currentGroup);
        currentGroup = [];
        currentSize = 0;
      }

      currentGroup.push(file);
      currentSize += fileSize;
    }

    if (currentGroup.length > 0) {
      groups.push(currentGroup);
    }

    return groups;
  }

  /**
   * 첨부 파일 준비
   */
  private async prepareAttachments(
    filePaths: string[]
  ): Promise<nodemailer.SendMailOptions['attachments']> {
    const attachments: nodemailer.SendMailOptions['attachments'] = [];

    for (const filePath of filePaths) {
      if (await fs.pathExists(filePath)) {
        attachments.push({
          filename: path.basename(filePath),
          path: filePath,
        });
      }
    }

    return attachments;
  }

  /**
   * 총 첨부 파일 크기 계산
   */
  private async calculateTotalSize(filePaths: string[]): Promise<number> {
    let totalSize = 0;

    for (const filePath of filePaths) {
      if (await fs.pathExists(filePath)) {
        const stat = await fs.stat(filePath);
        totalSize += stat.size;
      }
    }

    return totalSize;
  }

  /**
   * HTML 이메일 본문 생성
   */
  private generateHtmlBody(
    customBody: string,
    packages: PackageInfo[],
    part?: number,
    totalParts?: number
  ): string {
    const partInfo = part && totalParts ? `<p style="color: #666;">(${part}/${totalParts} 파트)</p>` : '';

    // 패키지 목록 생성
    let packageList = '';
    if (packages.length > 0) {
      const grouped = this.groupPackagesByType(packages);
      packageList = '<h3>포함된 패키지</h3><ul>';

      for (const [type, pkgs] of grouped) {
        packageList += `<li><strong>${type.toUpperCase()}</strong><ul>`;
        for (const pkg of pkgs) {
          packageList += `<li>${pkg.name}@${pkg.version}${pkg.arch ? ` (${pkg.arch})` : ''}</li>`;
        }
        packageList += '</ul></li>';
      }
      packageList += '</ul>';
    }

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
    h1 { color: #2563eb; border-bottom: 2px solid #2563eb; padding-bottom: 10px; }
    h2 { color: #1e40af; }
    h3 { color: #1e3a8a; }
    ul { padding-left: 20px; }
    .info-box { background: #f0f9ff; border-left: 4px solid #2563eb; padding: 15px; margin: 20px 0; }
    .warning-box { background: #fff7ed; border-left: 4px solid #f97316; padding: 15px; margin: 20px 0; }
    code { background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-family: monospace; }
    .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #e2e8f0; color: #64748b; font-size: 12px; }
  </style>
</head>
<body>
  <h1>DepsSmuggler 패키지 전달</h1>
  ${partInfo}

  ${customBody ? `<p>${customBody}</p>` : ''}

  ${packageList}

  <div class="info-box">
    <h3>설치 방법</h3>
    <p><strong>Python (pip):</strong></p>
    <code>pip install --no-index --find-links=./packages &lt;패키지명&gt;</code>

    <p><strong>Maven:</strong></p>
    <code>mvn install -o</code>

    <p><strong>YUM/RPM:</strong></p>
    <code>yum localinstall -y ./packages/*.rpm</code>

    <p><strong>Docker:</strong></p>
    <code>docker load -i ./packages/&lt;이미지명&gt;.tar</code>
  </div>

  <div class="warning-box">
    <p><strong>주의:</strong> 첨부된 압축 파일을 먼저 압축 해제한 후 사용하세요.</p>
  </div>

  <div class="footer">
    <p>이 메일은 DepsSmuggler에 의해 자동 생성되었습니다.</p>
    <p>DepsSmuggler - 폐쇄망을 위한 패키지 다운로더</p>
  </div>
</body>
</html>
`;
  }

  /**
   * 분할 파트 본문 생성
   */
  private generatePartBody(part: number, totalParts: number): string {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
    h1 { color: #2563eb; }
    .info-box { background: #f0f9ff; border-left: 4px solid #2563eb; padding: 15px; margin: 20px 0; }
  </style>
</head>
<body>
  <h1>DepsSmuggler 패키지 전달 (${part}/${totalParts})</h1>

  <div class="info-box">
    <p>이 메일은 전체 ${totalParts}개 파트 중 ${part}번째 파트입니다.</p>
    <p>모든 파트를 받은 후 첨부 파일을 합쳐서 사용하세요.</p>
  </div>

  <p style="color: #64748b; font-size: 12px;">
    이 메일은 DepsSmuggler에 의해 자동 생성되었습니다.
  </p>
</body>
</html>
`;
  }

  /**
   * 패키지를 타입별로 그룹화
   */
  private groupPackagesByType(packages: PackageInfo[]): Map<string, PackageInfo[]> {
    const grouped = new Map<string, PackageInfo[]>();
    for (const pkg of packages) {
      const type = pkg.type;
      const group = grouped.get(type) || [];
      group.push(pkg);
      grouped.set(type, group);
    }
    return grouped;
  }

  /**
   * 발송 설정 변경
   */
  updateConfig(config: Partial<SmtpConfig>): void {
    this.config = { ...this.config, ...config };
    this.transporter = null; // 재연결 필요
  }

  /**
   * 최대 첨부 파일 크기 설정
   */
  setMaxAttachmentSize(sizeInBytes: number): void {
    this.maxAttachmentSize = sizeInBytes;
  }

  /**
   * 연결 종료
   */
  close(): void {
    if (this.transporter) {
      this.transporter.close();
      this.transporter = null;
    }
  }
}

// 싱글톤 인스턴스
let emailSenderInstance: EmailSender | null = null;

export function getEmailSender(config?: SmtpConfig): EmailSender {
  if (!emailSenderInstance && config) {
    emailSenderInstance = new EmailSender(config);
  }
  if (!emailSenderInstance) {
    throw new Error('EmailSender가 초기화되지 않았습니다. SMTP 설정을 제공하세요.');
  }
  return emailSenderInstance;
}

export function initializeEmailSender(config: SmtpConfig, maxAttachmentSize?: number): EmailSender {
  emailSenderInstance = new EmailSender(config, maxAttachmentSize);
  return emailSenderInstance;
}
