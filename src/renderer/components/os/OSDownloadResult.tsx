/**
 * OS Download Result Component
 * OS 패키지 다운로드 완료 결과 표시 컴포넌트
 */

import React from 'react';
import type {
  OSPackageInfo,
  OSPackageOutputOptions,
  OSPackageManager,
} from '../../../core/downloaders/os/types';

interface OSDownloadResultProps {
  success: OSPackageInfo[];
  failed: Array<{ package: OSPackageInfo; error: string }>;
  skipped: OSPackageInfo[];
  outputPath: string;
  outputOptions: OSPackageOutputOptions;
  packageManager: OSPackageManager;
  onOpenFolder: () => void;
  onClose: () => void;
}

export const OSDownloadResult: React.FC<OSDownloadResultProps> = ({
  success,
  failed,
  skipped,
  outputPath,
  outputOptions,
  packageManager,
  onOpenFolder,
  onClose,
}) => {
  const totalSize = success.reduce((sum, pkg) => sum + (pkg.size || 0), 0);

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const getOutputTypeLabel = (): string => {
    switch (outputOptions.type) {
      case 'archive':
        return `압축 파일 (${outputOptions.archiveFormat?.toUpperCase() || 'ZIP'})`;
      case 'repository':
        return '로컬 저장소';
      case 'both':
        return `압축 파일 + 로컬 저장소`;
      default:
        return outputOptions.type;
    }
  };

  const getInstallCommand = (): string => {
    switch (packageManager) {
      case 'yum':
        return outputOptions.type === 'repository'
          ? 'yum install <패키지명>'
          : 'rpm -ivh <패키지.rpm>';
      case 'apt':
        return outputOptions.type === 'repository'
          ? 'apt install <패키지명>'
          : 'dpkg -i <패키지.deb>';
      case 'apk':
        return outputOptions.type === 'repository'
          ? 'apk add <패키지명>'
          : 'apk add --allow-untrusted <패키지.apk>';
      default:
        return '';
    }
  };

  const isSuccess = failed.length === 0;

  return (
    <div className="os-download-result">
      {/* 헤더 */}
      <div className={`result-header ${isSuccess ? 'success' : 'warning'}`}>
        <span className="result-icon">{isSuccess ? '✅' : '⚠️'}</span>
        <div className="result-title">
          <h2>{isSuccess ? '다운로드 완료!' : '다운로드 완료 (일부 실패)'}</h2>
          <p>
            {success.length}개 패키지 다운로드 성공
            {failed.length > 0 && `, ${failed.length}개 실패`}
            {skipped.length > 0 && `, ${skipped.length}개 건너뜀`}
          </p>
        </div>
      </div>

      {/* 요약 정보 */}
      <div className="result-summary">
        <div className="summary-card">
          <span className="summary-label">출력 경로</span>
          <span className="summary-value path">{outputPath}</span>
        </div>
        <div className="summary-card">
          <span className="summary-label">출력 형식</span>
          <span className="summary-value">{getOutputTypeLabel()}</span>
        </div>
        <div className="summary-card">
          <span className="summary-label">총 크기</span>
          <span className="summary-value">{formatSize(totalSize)}</span>
        </div>
      </div>

      {/* 포함된 파일 목록 */}
      <div className="result-section">
        <h3 className="section-title">포함된 파일</h3>
        <ul className="file-list">
          <li>
            <span className="file-icon">📦</span>
            패키지 파일 ({success.length}개)
          </li>
          {outputOptions.generateScripts && outputOptions.scriptTypes?.length > 0 && (
            <>
              {outputOptions.scriptTypes.includes('dependency-order') && (
                <li>
                  <span className="file-icon">📜</span>
                  install.sh - 의존성 순서 설치 스크립트
                </li>
              )}
              {outputOptions.scriptTypes.includes('local-repo') && (
                <li>
                  <span className="file-icon">📜</span>
                  setup-repo.sh - 로컬 저장소 설정 스크립트
                </li>
              )}
            </>
          )}
          <li>
            <span className="file-icon">📄</span>
            metadata.json - 패키지 메타데이터
          </li>
          <li>
            <span className="file-icon">📖</span>
            README.txt - 사용 안내
          </li>
        </ul>
      </div>

      {/* 설치 방법 안내 */}
      <div className="result-section">
        <h3 className="section-title">설치 방법</h3>
        <div className="install-guide">
          {outputOptions.type === 'repository' || outputOptions.type === 'both' ? (
            <>
              <p className="guide-step">
                <strong>1.</strong> 다운로드한 폴더를 폐쇄망 서버에 복사합니다.
              </p>
              <p className="guide-step">
                <strong>2.</strong> 로컬 저장소 설정 스크립트를 실행합니다:
              </p>
              <code className="guide-code">sudo bash setup-repo.sh</code>
              <p className="guide-step">
                <strong>3.</strong> 패키지를 설치합니다:
              </p>
              <code className="guide-code">{getInstallCommand()}</code>
            </>
          ) : (
            <>
              <p className="guide-step">
                <strong>1.</strong> 압축 파일을 폐쇄망 서버에 복사하고 압축을 풉니다.
              </p>
              <p className="guide-step">
                <strong>2.</strong> 설치 스크립트를 실행합니다:
              </p>
              <code className="guide-code">sudo bash install.sh</code>
            </>
          )}
        </div>
      </div>

      {/* 실패한 패키지 목록 */}
      {failed.length > 0 && (
        <div className="result-section failed">
          <h3 className="section-title">실패한 패키지</h3>
          <ul className="failed-list">
            {failed.map((item, index) => (
              <li key={index}>
                <span className="pkg-name">{item.package.name}</span>
                <span className="error-msg">{item.error}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 액션 버튼 */}
      <div className="result-actions">
        <button className="open-folder-btn" onClick={onOpenFolder}>
          📂 폴더 열기
        </button>
        <button className="close-btn" onClick={onClose}>
          닫기
        </button>
      </div>

      <style>{`
        .os-download-result {
          background: #fff;
          border-radius: 12px;
          overflow: hidden;
          max-width: 600px;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
        }

        .result-header {
          display: flex;
          align-items: center;
          padding: 24px;
          gap: 16px;
        }

        .result-header.success {
          background: linear-gradient(135deg, #e8f5e9, #c8e6c9);
        }

        .result-header.warning {
          background: linear-gradient(135deg, #fff3e0, #ffe0b2);
        }

        .result-icon {
          font-size: 40px;
        }

        .result-title h2 {
          margin: 0 0 4px;
          font-size: 20px;
          color: #1a1a2e;
        }

        .result-title p {
          margin: 0;
          font-size: 14px;
          color: #666;
        }

        .result-summary {
          padding: 20px 24px;
          display: flex;
          flex-direction: column;
          gap: 12px;
          background: #f8f9fa;
          border-bottom: 1px solid #e0e0e0;
        }

        .summary-card {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .summary-label {
          font-size: 13px;
          color: #666;
        }

        .summary-value {
          font-weight: 500;
          color: #1a1a2e;
        }

        .summary-value.path {
          font-family: monospace;
          font-size: 12px;
          max-width: 300px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .result-section {
          padding: 20px 24px;
          border-bottom: 1px solid #e0e0e0;
        }

        .result-section.failed {
          background: #fff5f5;
        }

        .section-title {
          font-size: 14px;
          font-weight: 600;
          color: #1a1a2e;
          margin: 0 0 12px;
        }

        .file-list {
          list-style: none;
          padding: 0;
          margin: 0;
        }

        .file-list li {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 0;
          font-size: 13px;
          color: #444;
        }

        .file-icon {
          font-size: 16px;
        }

        .install-guide {
          background: #f5f5f5;
          padding: 16px;
          border-radius: 8px;
        }

        .guide-step {
          margin: 0 0 12px;
          font-size: 13px;
          color: #444;
        }

        .guide-code {
          display: block;
          background: #1a1a2e;
          color: #4ade80;
          padding: 10px 14px;
          border-radius: 6px;
          font-family: monospace;
          font-size: 13px;
          margin: 8px 0 16px;
        }

        .failed-list {
          list-style: none;
          padding: 0;
          margin: 0;
        }

        .failed-list li {
          display: flex;
          justify-content: space-between;
          padding: 8px 12px;
          background: #fee;
          border-radius: 4px;
          margin-bottom: 8px;
          font-size: 13px;
        }

        .failed-list .pkg-name {
          font-weight: 500;
          color: #c62828;
        }

        .failed-list .error-msg {
          color: #888;
          font-size: 12px;
        }

        .result-actions {
          display: flex;
          gap: 12px;
          padding: 20px 24px;
        }

        .open-folder-btn {
          flex: 1;
          padding: 12px;
          background: #4a90d9;
          color: #fff;
          border: none;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: background 0.2s;
        }

        .open-folder-btn:hover {
          background: #3a7bc8;
        }

        .close-btn {
          padding: 12px 24px;
          background: #f5f5f5;
          color: #666;
          border: 1px solid #ddd;
          border-radius: 8px;
          font-size: 14px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .close-btn:hover {
          background: #eee;
        }
      `}</style>
    </div>
  );
};

export default OSDownloadResult;
