/**
 * OS Package Cart Component
 * OS 패키지 장바구니 컴포넌트 - 선택된 패키지 목록과 출력 옵션
 */

import React, { useState, useMemo } from 'react';
import { OSOutputOptions } from './OSOutputOptions';
import type {
  OSPackageInfo,
  OSDistribution,
  OSPackageOutputOptions,
  OSPackageManager,
} from '../../../core/downloaders/os/types';

interface OSPackageCartProps {
  packages: OSPackageInfo[];
  distribution: OSDistribution | null;
  onRemovePackage: (pkg: OSPackageInfo) => void;
  onClearAll: () => void;
  onStartDownload: (outputOptions: OSPackageOutputOptions) => void;
  isDownloading?: boolean;
}

const DEFAULT_OUTPUT_OPTIONS: OSPackageOutputOptions = {
  type: 'archive',
  archiveFormat: 'zip',
  generateScripts: true,
  scriptTypes: ['dependency-order'],
};

export const OSPackageCart: React.FC<OSPackageCartProps> = ({
  packages,
  distribution,
  onRemovePackage,
  onClearAll,
  onStartDownload,
  isDownloading = false,
}) => {
  const [outputOptions, setOutputOptions] = useState<OSPackageOutputOptions>(DEFAULT_OUTPUT_OPTIONS);
  const [showOutputOptions, setShowOutputOptions] = useState(false);

  const totalSize = useMemo(() => {
    return packages.reduce((sum, pkg) => sum + (pkg.size || 0), 0);
  }, [packages]);

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const handleStartDownload = () => {
    onStartDownload(outputOptions);
  };

  if (packages.length === 0) {
    return (
      <div className="os-package-cart empty">
        <div className="empty-cart">
          <span className="empty-icon">🛒</span>
          <p className="empty-text">장바구니가 비어있습니다</p>
          <p className="empty-hint">패키지를 검색하고 장바구니에 추가하세요</p>
        </div>
        <style>{cartStyles}</style>
      </div>
    );
  }

  return (
    <div className="os-package-cart">
      <div className="cart-header">
        <h3 className="cart-title">
          장바구니
          <span className="package-count">{packages.length}개</span>
        </h3>
        <button className="clear-btn" onClick={onClearAll} disabled={isDownloading}>
          전체 삭제
        </button>
      </div>

      {/* 배포판 정보 */}
      {distribution && (
        <div className="distribution-info">
          <span className="distro-badge">
            {distribution.packageManager === 'yum' && '🎩'}
            {distribution.packageManager === 'apt' && '📦'}
            {distribution.packageManager === 'apk' && '🏔️'}
            {distribution.name}
          </span>
        </div>
      )}

      {/* 패키지 목록 */}
      <div className="package-list">
        {packages.map((pkg, index) => (
          <div key={`${pkg.name}-${pkg.version}-${index}`} className="package-item">
            <div className="package-info">
              <span className="package-name">{pkg.name}</span>
              <span className="package-version">{pkg.version}</span>
              <span className="package-arch">{pkg.architecture}</span>
            </div>
            <div className="package-actions">
              <span className="package-size">{formatSize(pkg.size)}</span>
              <button
                className="remove-btn"
                onClick={() => onRemovePackage(pkg)}
                disabled={isDownloading}
                title="삭제"
              >
                ×
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* 요약 */}
      <div className="cart-summary">
        <div className="summary-row">
          <span>총 패키지</span>
          <span>{packages.length}개</span>
        </div>
        <div className="summary-row">
          <span>예상 크기</span>
          <span>{formatSize(totalSize)}</span>
        </div>
        <p className="summary-note">
          * 의존성 패키지는 다운로드 시 자동으로 추가됩니다.
        </p>
      </div>

      {/* 출력 옵션 토글 */}
      <div className="output-options-toggle">
        <button
          className="toggle-btn"
          onClick={() => setShowOutputOptions(!showOutputOptions)}
        >
          출력 옵션 {showOutputOptions ? '▲' : '▼'}
        </button>
      </div>

      {/* 출력 옵션 */}
      {showOutputOptions && (
        <div className="output-options-section">
          <OSOutputOptions
            value={outputOptions}
            onChange={setOutputOptions}
            packageManager={distribution?.packageManager || null}
          />
        </div>
      )}

      {/* 다운로드 버튼 */}
      <div className="cart-actions">
        <button
          className="download-btn"
          onClick={handleStartDownload}
          disabled={isDownloading || packages.length === 0}
        >
          {isDownloading ? (
            <>
              <span className="loading-spinner"></span>
              다운로드 중...
            </>
          ) : (
            <>다운로드 시작</>
          )}
        </button>
      </div>

      <style>{cartStyles}</style>
    </div>
  );
};

const cartStyles = `
  .os-package-cart {
    background: #fff;
    border: 1px solid #e0e0e0;
    border-radius: 8px;
    overflow: hidden;
  }

  .os-package-cart.empty {
    padding: 40px 20px;
  }

  .empty-cart {
    text-align: center;
  }

  .empty-icon {
    font-size: 48px;
    display: block;
    margin-bottom: 16px;
  }

  .empty-text {
    font-size: 16px;
    color: #666;
    margin-bottom: 8px;
  }

  .empty-hint {
    font-size: 14px;
    color: #999;
  }

  .cart-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 20px;
    background: #f5f5f5;
    border-bottom: 1px solid #e0e0e0;
  }

  .cart-title {
    font-size: 16px;
    font-weight: 600;
    margin: 0;
    color: #1a1a2e;
  }

  .package-count {
    margin-left: 8px;
    padding: 2px 8px;
    background: #4a90d9;
    color: #fff;
    border-radius: 12px;
    font-size: 12px;
    font-weight: 500;
  }

  .clear-btn {
    padding: 6px 12px;
    background: none;
    border: 1px solid #ccc;
    border-radius: 4px;
    font-size: 13px;
    color: #666;
    cursor: pointer;
    transition: all 0.2s;
  }

  .clear-btn:hover:not(:disabled) {
    border-color: #e74c3c;
    color: #e74c3c;
  }

  .clear-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .distribution-info {
    padding: 12px 20px;
    background: #f8f9fa;
    border-bottom: 1px solid #e0e0e0;
  }

  .distro-badge {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    background: #e8f4fd;
    border-radius: 4px;
    font-size: 13px;
    color: #1976d2;
  }

  .package-list {
    max-height: 300px;
    overflow-y: auto;
  }

  .package-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 20px;
    border-bottom: 1px solid #f0f0f0;
    transition: background 0.2s;
  }

  .package-item:hover {
    background: #f8f9fa;
  }

  .package-info {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .package-name {
    font-weight: 500;
    color: #1a1a2e;
  }

  .package-version {
    font-family: monospace;
    font-size: 12px;
    color: #666;
    background: #f0f0f0;
    padding: 2px 6px;
    border-radius: 3px;
  }

  .package-arch {
    font-size: 12px;
    color: #888;
  }

  .package-actions {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .package-size {
    font-size: 12px;
    color: #888;
  }

  .remove-btn {
    width: 24px;
    height: 24px;
    border: none;
    background: none;
    color: #999;
    font-size: 18px;
    cursor: pointer;
    border-radius: 4px;
    transition: all 0.2s;
  }

  .remove-btn:hover:not(:disabled) {
    background: #fee;
    color: #e74c3c;
  }

  .remove-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .cart-summary {
    padding: 16px 20px;
    background: #f8f9fa;
    border-top: 1px solid #e0e0e0;
    border-bottom: 1px solid #e0e0e0;
  }

  .summary-row {
    display: flex;
    justify-content: space-between;
    font-size: 14px;
    color: #444;
    margin-bottom: 8px;
  }

  .summary-row:last-of-type {
    margin-bottom: 0;
  }

  .summary-note {
    font-size: 12px;
    color: #888;
    margin-top: 12px;
    margin-bottom: 0;
  }

  .output-options-toggle {
    padding: 12px 20px;
    border-bottom: 1px solid #e0e0e0;
  }

  .toggle-btn {
    width: 100%;
    padding: 10px;
    background: #f5f5f5;
    border: 1px solid #e0e0e0;
    border-radius: 6px;
    font-size: 14px;
    color: #666;
    cursor: pointer;
    transition: all 0.2s;
  }

  .toggle-btn:hover {
    background: #eee;
  }

  .output-options-section {
    padding: 0 20px 16px;
    border-bottom: 1px solid #e0e0e0;
  }

  .cart-actions {
    padding: 16px 20px;
  }

  .download-btn {
    width: 100%;
    padding: 14px;
    background: #4a90d9;
    color: #fff;
    border: none;
    border-radius: 8px;
    font-size: 16px;
    font-weight: 500;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    transition: background 0.2s;
  }

  .download-btn:hover:not(:disabled) {
    background: #3a7bc8;
  }

  .download-btn:disabled {
    background: #ccc;
    cursor: not-allowed;
  }

  .loading-spinner {
    width: 18px;
    height: 18px;
    border: 2px solid transparent;
    border-top-color: #fff;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
`;

export default OSPackageCart;
