/**
 * OS Type Selector Component
 * OS 패키지 관리자 타입 선택 (yum/apt/apk)
 */

import React from 'react';
import type { OSPackageManager } from '../../../core/downloaders/os/types';

interface OSTypeOption {
  id: OSPackageManager;
  name: string;
  description: string;
  distributions: string[];
  icon: string;
}

const OS_TYPES: OSTypeOption[] = [
  {
    id: 'yum',
    name: 'RHEL/CentOS 계열',
    description: 'Red Hat Enterprise Linux, CentOS, Rocky Linux, AlmaLinux, Fedora',
    distributions: ['Rocky Linux', 'AlmaLinux', 'CentOS', 'RHEL', 'Fedora'],
    icon: '/icons/redhat.svg',
  },
  {
    id: 'apt',
    name: 'Ubuntu/Debian 계열',
    description: 'Ubuntu, Debian, Linux Mint, Pop!_OS',
    distributions: ['Ubuntu', 'Debian', 'Linux Mint'],
    icon: '/icons/ubuntu.svg',
  },
  {
    id: 'apk',
    name: 'Alpine Linux',
    description: '경량 컨테이너용 배포판',
    distributions: ['Alpine Linux'],
    icon: '/icons/alpine.svg',
  },
];

interface OSTypeSelectorProps {
  value: OSPackageManager | null;
  onChange: (type: OSPackageManager) => void;
}

export const OSTypeSelector: React.FC<OSTypeSelectorProps> = ({ value, onChange }) => {
  return (
    <div className="os-type-selector">
      <h3 className="selector-title">OS 타입 선택</h3>
      <p className="selector-description">
        패키지를 다운로드할 Linux 배포판 계열을 선택하세요.
      </p>

      <div className="os-type-cards">
        {OS_TYPES.map((osType) => (
          <div
            key={osType.id}
            className={`os-type-card ${value === osType.id ? 'selected' : ''}`}
            onClick={() => onChange(osType.id)}
          >
            <div className="os-type-icon">
              <img
                src={osType.icon}
                alt={osType.name}
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
              <span className="os-type-fallback-icon">
                {osType.id === 'yum' && '🎩'}
                {osType.id === 'apt' && '🐧'}
                {osType.id === 'apk' && '🏔️'}
              </span>
            </div>
            <div className="os-type-info">
              <h4 className="os-type-name">{osType.name}</h4>
              <p className="os-type-desc">{osType.description}</p>
              <div className="os-type-distros">
                {osType.distributions.slice(0, 3).map((distro) => (
                  <span key={distro} className="distro-tag">
                    {distro}
                  </span>
                ))}
                {osType.distributions.length > 3 && (
                  <span className="distro-tag more">
                    +{osType.distributions.length - 3}
                  </span>
                )}
              </div>
            </div>
            {value === osType.id && (
              <div className="os-type-check">✓</div>
            )}
          </div>
        ))}
      </div>

      <style>{`
        .os-type-selector {
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

        .os-type-cards {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .os-type-card {
          display: flex;
          align-items: center;
          padding: 16px;
          border: 2px solid #e0e0e0;
          border-radius: 12px;
          cursor: pointer;
          transition: all 0.2s ease;
          background: #fff;
        }

        .os-type-card:hover {
          border-color: #4a90d9;
          background: #f8fafc;
        }

        .os-type-card.selected {
          border-color: #4a90d9;
          background: #f0f7ff;
        }

        .os-type-icon {
          width: 48px;
          height: 48px;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-right: 16px;
          font-size: 32px;
        }

        .os-type-icon img {
          width: 48px;
          height: 48px;
          object-fit: contain;
        }

        .os-type-fallback-icon {
          font-size: 32px;
        }

        .os-type-info {
          flex: 1;
        }

        .os-type-name {
          font-size: 16px;
          font-weight: 600;
          margin-bottom: 4px;
          color: #1a1a2e;
        }

        .os-type-desc {
          font-size: 13px;
          color: #666;
          margin-bottom: 8px;
        }

        .os-type-distros {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }

        .distro-tag {
          font-size: 11px;
          padding: 2px 8px;
          background: #e8e8e8;
          border-radius: 4px;
          color: #555;
        }

        .distro-tag.more {
          background: #ddd;
        }

        .os-type-check {
          width: 28px;
          height: 28px;
          border-radius: 50%;
          background: #4a90d9;
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 16px;
          font-weight: bold;
        }
      `}</style>
    </div>
  );
};

export default OSTypeSelector;
