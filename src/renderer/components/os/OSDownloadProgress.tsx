import React from 'react';
import type { OSDownloadProgress } from '../../../core/downloaders/os-shared/types';

interface OSDownloadProgressProps {
  progress: OSDownloadProgress | null;
  packageCount: number;
  outputDir: string;
}

const phaseLabels: Record<OSDownloadProgress['phase'], string> = {
  resolving: '의존성 확인',
  downloading: '다운로드',
  verifying: '검증',
  packaging: '패키징',
};

const formatBytes = (bytes: number): string => {
  if (bytes <= 0) return '0 B';
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
};

export const OSDownloadProgress: React.FC<OSDownloadProgressProps> = ({
  progress,
  packageCount,
  outputDir,
}) => {
  const currentPhase = progress ? phaseLabels[progress.phase] : '대기';
  const totalPackages = progress?.totalPackages || packageCount || 1;
  const completedPackages = progress?.phase === 'packaging'
    ? totalPackages
    : Math.max((progress?.currentIndex || 1) - 1, 0);
  const overallPercent = progress?.phase === 'packaging'
    ? 100
    : Math.min(100, Math.round((completedPackages / totalPackages) * 100));
  const currentPercent = progress?.totalBytes
    ? Math.min(100, Math.round((progress.bytesDownloaded / progress.totalBytes) * 100))
    : progress?.phase === 'packaging'
    ? 100
    : 0;

  return (
    <div className="os-download-progress">
      <div className="progress-header">
        <div>
          <h2>OS 패키지 다운로드</h2>
          <p>{currentPhase} 단계가 진행 중입니다.</p>
        </div>
        <span className="phase-badge">{currentPhase}</span>
      </div>

      <div className="metric-grid">
        <div className="metric-card">
          <span className="metric-label">전체 진행</span>
          <strong>{overallPercent}%</strong>
        </div>
        <div className="metric-card">
          <span className="metric-label">현재 패키지</span>
          <strong>{progress?.currentPackage || '대기 중'}</strong>
        </div>
        <div className="metric-card">
          <span className="metric-label">처리 패키지</span>
          <strong>{Math.min(progress?.currentIndex || 0, totalPackages)} / {totalPackages}</strong>
        </div>
      </div>

      <div className="progress-block">
        <div className="progress-row">
          <span>현재 단계</span>
          <span>{currentPhase}</span>
        </div>
        <div className="progress-track">
          <div className="progress-bar overall" style={{ width: `${overallPercent}%` }} />
        </div>
      </div>

      <div className="progress-block">
        <div className="progress-row">
          <span>{progress?.currentPackage || '현재 패키지'}</span>
          <span>
            {formatBytes(progress?.bytesDownloaded || 0)} / {formatBytes(progress?.totalBytes || 0)}
          </span>
        </div>
        <div className="progress-track">
          <div className="progress-bar current" style={{ width: `${currentPercent}%` }} />
        </div>
      </div>

      <div className="progress-footer">
        <div>
          <span className="footer-label">출력 위치</span>
          <code>{outputDir}</code>
        </div>
        <div>
          <span className="footer-label">속도</span>
          <strong>{formatBytes(progress?.speed || 0)}/s</strong>
        </div>
      </div>

      <style>{`
        .os-download-progress {
          background: #fff;
          border: 1px solid #e5e7eb;
          border-radius: 16px;
          padding: 24px;
          box-shadow: 0 20px 40px rgba(15, 23, 42, 0.06);
        }

        .progress-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 16px;
          margin-bottom: 24px;
        }

        .progress-header h2 {
          margin: 0 0 8px;
          font-size: 24px;
          color: #111827;
        }

        .progress-header p {
          margin: 0;
          color: #6b7280;
        }

        .phase-badge {
          padding: 8px 12px;
          border-radius: 999px;
          background: #eff6ff;
          color: #1d4ed8;
          font-size: 13px;
          font-weight: 600;
        }

        .metric-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
          gap: 12px;
          margin-bottom: 24px;
        }

        .metric-card {
          border-radius: 12px;
          background: #f8fafc;
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .metric-label,
        .footer-label {
          font-size: 12px;
          color: #6b7280;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }

        .progress-block {
          margin-bottom: 20px;
        }

        .progress-row {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 8px;
          color: #374151;
          font-size: 14px;
        }

        .progress-track {
          width: 100%;
          height: 12px;
          border-radius: 999px;
          background: #e5e7eb;
          overflow: hidden;
        }

        .progress-bar {
          height: 100%;
          border-radius: inherit;
          transition: width 0.2s ease;
        }

        .progress-bar.overall {
          background: linear-gradient(90deg, #0f766e, #14b8a6);
        }

        .progress-bar.current {
          background: linear-gradient(90deg, #1d4ed8, #60a5fa);
        }

        .progress-footer {
          display: flex;
          justify-content: space-between;
          gap: 16px;
          flex-wrap: wrap;
          padding-top: 8px;
          border-top: 1px solid #e5e7eb;
        }

        .progress-footer code {
          display: inline-block;
          margin-top: 4px;
          padding: 4px 8px;
          border-radius: 8px;
          background: #111827;
          color: #f9fafb;
          font-size: 12px;
        }
      `}</style>
    </div>
  );
};

export default OSDownloadProgress;
