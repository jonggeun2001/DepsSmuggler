/**
 * Architecture Selector Component
 * CPU 아키텍처 선택
 */

import React from 'react';
import type { OSArchitecture, OSDistribution } from '../../../core/downloaders/os/types';

interface ArchitectureOption {
  id: OSArchitecture;
  name: string;
  description: string;
  aliases: string[];
}

const ARCHITECTURES: ArchitectureOption[] = [
  {
    id: 'x86_64',
    name: 'x86_64 / AMD64',
    description: '64비트 Intel/AMD 프로세서 (대부분의 데스크톱/서버)',
    aliases: ['amd64', 'x64'],
  },
  {
    id: 'aarch64',
    name: 'ARM64 / AArch64',
    description: '64비트 ARM 프로세서 (Apple Silicon, AWS Graviton 등)',
    aliases: ['arm64'],
  },
  {
    id: 'i686',
    name: 'i686 / x86',
    description: '32비트 Intel/AMD 프로세서 (레거시 시스템)',
    aliases: ['i386', 'x86'],
  },
  {
    id: 'armv7',
    name: 'ARMv7',
    description: '32비트 ARM 프로세서 (라즈베리파이 등)',
    aliases: ['armhf', 'arm'],
  },
];

interface ArchitectureSelectorProps {
  distribution: OSDistribution | null;
  value: OSArchitecture;
  onChange: (arch: OSArchitecture) => void;
}

export const ArchitectureSelector: React.FC<ArchitectureSelectorProps> = ({
  distribution,
  value,
  onChange,
}) => {
  const availableArchs = distribution?.architectures || ['x86_64', 'aarch64'];

  const isAvailable = (arch: OSArchitecture): boolean => {
    return availableArchs.includes(arch);
  };

  return (
    <div className="architecture-selector">
      <h3 className="selector-title">아키텍처 선택</h3>
      <p className="selector-description">
        설치 대상 시스템의 CPU 아키텍처를 선택하세요.
      </p>

      <div className="arch-list">
        {ARCHITECTURES.map((arch) => {
          const available = isAvailable(arch.id);
          const isSelected = value === arch.id;

          return (
            <div
              key={arch.id}
              className={`arch-item ${isSelected ? 'selected' : ''} ${!available ? 'disabled' : ''}`}
              onClick={() => available && onChange(arch.id)}
            >
              <div className="arch-radio">
                <div className={`radio-circle ${isSelected ? 'checked' : ''}`}>
                  {isSelected && <div className="radio-dot" />}
                </div>
              </div>

              <div className="arch-info">
                <div className="arch-name-row">
                  <span className="arch-name">{arch.name}</span>
                  {!available && (
                    <span className="badge unavailable">지원 안함</span>
                  )}
                </div>
                <p className="arch-desc">{arch.description}</p>
                <div className="arch-aliases">
                  {arch.aliases.map((alias) => (
                    <span key={alias} className="alias-tag">
                      {alias}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <style>{`
        .architecture-selector {
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

        .arch-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .arch-item {
          display: flex;
          align-items: flex-start;
          padding: 14px 16px;
          border: 1px solid #e0e0e0;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s ease;
          background: #fff;
        }

        .arch-item:hover:not(.disabled) {
          border-color: #4a90d9;
          background: #f8fafc;
        }

        .arch-item.selected {
          border-color: #4a90d9;
          background: #f0f7ff;
        }

        .arch-item.disabled {
          opacity: 0.5;
          cursor: not-allowed;
          background: #f5f5f5;
        }

        .arch-radio {
          margin-right: 12px;
          margin-top: 2px;
        }

        .radio-circle {
          width: 18px;
          height: 18px;
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
          width: 8px;
          height: 8px;
          background: #4a90d9;
          border-radius: 50%;
        }

        .arch-info {
          flex: 1;
        }

        .arch-name-row {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 4px;
        }

        .arch-name {
          font-size: 15px;
          font-weight: 500;
          color: #1a1a2e;
        }

        .badge.unavailable {
          font-size: 10px;
          padding: 2px 6px;
          border-radius: 4px;
          background: #f44336;
          color: white;
        }

        .arch-desc {
          font-size: 13px;
          color: #666;
          margin-bottom: 8px;
        }

        .arch-aliases {
          display: flex;
          gap: 6px;
        }

        .alias-tag {
          font-size: 11px;
          padding: 2px 6px;
          background: #e8e8e8;
          border-radius: 4px;
          color: #555;
          font-family: monospace;
        }
      `}</style>
    </div>
  );
};

export default ArchitectureSelector;
