/**
 * OS Version Selector Component
 * OS 배포판 버전 선택
 */

import React, { useMemo } from 'react';
import type { OSDistribution, OSPackageManager, OSArchitecture } from '../../../core/downloaders/os/types';
import {
  OS_DISTRIBUTIONS,
  USE_CASE_RECOMMENDATIONS,
  getDistributionsByPackageManager,
  getRecommendedDistributions,
} from '../../../core/downloaders/os/repositories';

interface OSVersionSelectorProps {
  packageManager: OSPackageManager;
  value: OSDistribution | null;
  onChange: (distribution: OSDistribution) => void;
}

type UseCase = 'enterprise' | 'legacy' | 'container' | 'development';

export const OSVersionSelector: React.FC<OSVersionSelectorProps> = ({
  packageManager,
  value,
  onChange,
}) => {
  const distributions = useMemo(() => {
    return getDistributionsByPackageManager(packageManager);
  }, [packageManager]);

  const recommended = useMemo(() => {
    return getRecommendedDistributions('enterprise');
  }, []);

  const isRecommended = (distId: string): boolean => {
    return recommended.some((r) => r.id === distId);
  };

  const getUseCaseBadge = (distId: string): string | null => {
    for (const [useCase, rec] of Object.entries(USE_CASE_RECOMMENDATIONS)) {
      if (rec.distributions.includes(distId)) {
        switch (useCase) {
          case 'enterprise':
            return '엔터프라이즈';
          case 'legacy':
            return '레거시';
          case 'container':
            return '컨테이너';
          case 'development':
            return '개발';
        }
      }
    }
    return null;
  };

  return (
    <div className="os-version-selector">
      <h3 className="selector-title">OS 버전 선택</h3>
      <p className="selector-description">
        설치 대상 시스템의 배포판과 버전을 선택하세요.
      </p>

      <div className="version-list">
        {distributions.map((dist) => {
          const badge = getUseCaseBadge(dist.id);
          const isSelected = value?.id === dist.id;

          return (
            <div
              key={dist.id}
              className={`version-item ${isSelected ? 'selected' : ''}`}
              onClick={() => onChange(dist)}
            >
              <div className="version-radio">
                <div className={`radio-circle ${isSelected ? 'checked' : ''}`}>
                  {isSelected && <div className="radio-dot" />}
                </div>
              </div>

              <div className="version-info">
                <div className="version-name-row">
                  <span className="version-name">{dist.name}</span>
                  {isRecommended(dist.id) && (
                    <span className="badge recommended">추천</span>
                  )}
                  {badge && (
                    <span className="badge use-case">{badge}</span>
                  )}
                </div>
                <div className="version-meta">
                  <span className="version-id">{dist.id}</span>
                  <span className="version-archs">
                    {dist.architectures.join(', ')}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {distributions.length === 0 && (
        <div className="no-versions">
          선택한 OS 타입에 대한 배포판이 없습니다.
        </div>
      )}

      <style>{`
        .os-version-selector {
          padding: 16px 0;
        }

        .selector-title {
          font-size: 18px;
          font-weight: 600;
          margin-bottom: 8px;
          color: #1a1a2e;
        }

        .selector-description {
          color: #666;
          margin-bottom: 20px;
        }

        .version-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
          max-height: 400px;
          overflow-y: auto;
        }

        .version-item {
          display: flex;
          align-items: center;
          padding: 12px 16px;
          border: 1px solid #e0e0e0;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s ease;
          background: #fff;
        }

        .version-item:hover {
          border-color: #4a90d9;
          background: #f8fafc;
        }

        .version-item.selected {
          border-color: #4a90d9;
          background: #f0f7ff;
        }

        .version-radio {
          margin-right: 12px;
        }

        .radio-circle {
          width: 20px;
          height: 20px;
          border: 2px solid #ccc;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s ease;
        }

        .radio-circle.checked {
          border-color: #4a90d9;
        }

        .radio-dot {
          width: 10px;
          height: 10px;
          background: #4a90d9;
          border-radius: 50%;
        }

        .version-info {
          flex: 1;
        }

        .version-name-row {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 4px;
        }

        .version-name {
          font-size: 15px;
          font-weight: 500;
          color: #1a1a2e;
        }

        .badge {
          font-size: 10px;
          padding: 2px 6px;
          border-radius: 4px;
          font-weight: 500;
        }

        .badge.recommended {
          background: #4caf50;
          color: white;
        }

        .badge.use-case {
          background: #e3f2fd;
          color: #1976d2;
        }

        .version-meta {
          display: flex;
          gap: 16px;
          font-size: 12px;
          color: #888;
        }

        .version-id {
          font-family: monospace;
        }

        .no-versions {
          padding: 40px;
          text-align: center;
          color: #888;
          background: #f5f5f5;
          border-radius: 8px;
        }
      `}</style>
    </div>
  );
};

export default OSVersionSelector;
