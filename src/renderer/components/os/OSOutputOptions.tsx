/**
 * OS Package Output Options Component
 * OS 패키지 다운로드 출력 옵션 선택 컴포넌트
 */

import React from 'react';
import type {
  OSPackageOutputOptions,
  OutputType,
  ArchiveFormat,
  ScriptType,
  OSPackageManager,
} from '../../../core/downloaders/os/types';

interface OSOutputOptionsProps {
  value: OSPackageOutputOptions;
  onChange: (options: OSPackageOutputOptions) => void;
  packageManager: OSPackageManager | null;
}

const OUTPUT_TYPE_OPTIONS: Array<{ value: OutputType; label: string; description: string }> = [
  {
    value: 'archive',
    label: '압축 파일',
    description: 'ZIP 또는 tar.gz 형식으로 패키지를 압축합니다.',
  },
  {
    value: 'repository',
    label: '로컬 저장소',
    description: '패키지 관리자에서 바로 사용할 수 있는 저장소 구조를 생성합니다.',
  },
  {
    value: 'both',
    label: '둘 다',
    description: '압축 파일과 로컬 저장소 구조를 모두 생성합니다.',
  },
];

const ARCHIVE_FORMAT_OPTIONS: Array<{ value: ArchiveFormat; label: string }> = [
  { value: 'zip', label: 'ZIP' },
  { value: 'tar.gz', label: 'tar.gz' },
];

const SCRIPT_TYPE_OPTIONS: Array<{ value: ScriptType; label: string; description: string }> = [
  {
    value: 'dependency-order',
    label: '의존성 순서 설치 스크립트',
    description: '의존성 순서대로 패키지를 하나씩 설치합니다.',
  },
  {
    value: 'local-repo',
    label: '로컬 저장소 설정 스크립트',
    description: '로컬 저장소를 구성하고 패키지 관리자 명령으로 설치합니다.',
  },
];

export const OSOutputOptions: React.FC<OSOutputOptionsProps> = ({
  value,
  onChange,
  packageManager,
}) => {
  const handleTypeChange = (type: OutputType) => {
    onChange({
      ...value,
      type,
    });
  };

  const handleArchiveFormatChange = (archiveFormat: ArchiveFormat) => {
    onChange({
      ...value,
      archiveFormat,
    });
  };

  const handleGenerateScriptsChange = (generateScripts: boolean) => {
    onChange({
      ...value,
      generateScripts,
      scriptTypes: generateScripts ? ['dependency-order'] : [],
    });
  };

  const handleScriptTypeToggle = (scriptType: ScriptType) => {
    const currentTypes = value.scriptTypes || [];
    const newTypes = currentTypes.includes(scriptType)
      ? currentTypes.filter((t) => t !== scriptType)
      : [...currentTypes, scriptType];

    onChange({
      ...value,
      scriptTypes: newTypes,
    });
  };

  const getPackageManagerLabel = (pm: OSPackageManager): string => {
    switch (pm) {
      case 'yum':
        return 'yum/dnf';
      case 'apt':
        return 'apt';
      case 'apk':
        return 'apk';
      default:
        return pm;
    }
  };

  const showArchiveFormat = value.type === 'archive' || value.type === 'both';

  return (
    <div className="os-output-options">
      <h3 className="section-title">출력 옵션</h3>
      <p className="section-description">
        다운로드한 패키지의 출력 형식을 선택하세요.
      </p>

      {/* 출력 형식 선택 */}
      <div className="option-group">
        <label className="option-label">출력 형식</label>
        <div className="output-type-options">
          {OUTPUT_TYPE_OPTIONS.map((option) => (
            <div
              key={option.value}
              className={`output-type-card ${value.type === option.value ? 'selected' : ''}`}
              onClick={() => handleTypeChange(option.value)}
            >
              <div className="card-radio">
                <input
                  type="radio"
                  name="outputType"
                  checked={value.type === option.value}
                  onChange={() => handleTypeChange(option.value)}
                />
              </div>
              <div className="card-content">
                <span className="card-label">{option.label}</span>
                <span className="card-description">{option.description}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 압축 형식 선택 */}
      {showArchiveFormat && (
        <div className="option-group">
          <label className="option-label">압축 형식</label>
          <div className="archive-format-options">
            {ARCHIVE_FORMAT_OPTIONS.map((option) => (
              <button
                key={option.value}
                className={`format-btn ${value.archiveFormat === option.value ? 'selected' : ''}`}
                onClick={() => handleArchiveFormatChange(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 스크립트 포함 여부 */}
      <div className="option-group">
        <div className="switch-row">
          <label className="option-label">설치 스크립트 포함</label>
          <label className="switch">
            <input
              type="checkbox"
              checked={value.generateScripts}
              onChange={(e) => handleGenerateScriptsChange(e.target.checked)}
            />
            <span className="slider"></span>
          </label>
        </div>
        <p className="option-hint">
          폐쇄망에서 패키지를 쉽게 설치할 수 있는 Bash 스크립트를 생성합니다.
        </p>
      </div>

      {/* 스크립트 종류 선택 */}
      {value.generateScripts && (
        <div className="option-group">
          <label className="option-label">스크립트 종류</label>
          <div className="script-type-options">
            {SCRIPT_TYPE_OPTIONS.map((option) => (
              <label
                key={option.value}
                className={`script-type-checkbox ${
                  value.scriptTypes?.includes(option.value) ? 'checked' : ''
                }`}
              >
                <input
                  type="checkbox"
                  checked={value.scriptTypes?.includes(option.value) || false}
                  onChange={() => handleScriptTypeToggle(option.value)}
                />
                <div className="checkbox-content">
                  <span className="checkbox-label">{option.label}</span>
                  <span className="checkbox-description">{option.description}</span>
                </div>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* 패키지 관리자 정보 */}
      {packageManager && (
        <div className="pm-info">
          <span className="pm-icon">
            {packageManager === 'yum' && '🎩'}
            {packageManager === 'apt' && '📦'}
            {packageManager === 'apk' && '🏔️'}
          </span>
          <span className="pm-text">
            {getPackageManagerLabel(packageManager)} 패키지용 스크립트가 생성됩니다.
          </span>
        </div>
      )}

      <style>{`
        .os-output-options {
          padding: 16px 0;
        }

        .section-title {
          font-size: 18px;
          font-weight: 600;
          margin-bottom: 8px;
          color: #1a1a2e;
        }

        .section-description {
          color: #666;
          margin-bottom: 24px;
        }

        .option-group {
          margin-bottom: 24px;
        }

        .option-label {
          display: block;
          font-size: 14px;
          font-weight: 500;
          color: #333;
          margin-bottom: 12px;
        }

        .option-hint {
          font-size: 13px;
          color: #888;
          margin-top: 8px;
        }

        /* 출력 형식 카드 */
        .output-type-options {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .output-type-card {
          display: flex;
          align-items: flex-start;
          padding: 14px 16px;
          border: 2px solid #e0e0e0;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .output-type-card:hover {
          border-color: #4a90d9;
          background: #f8fafc;
        }

        .output-type-card.selected {
          border-color: #4a90d9;
          background: #e8f4fd;
        }

        .card-radio {
          margin-right: 12px;
          margin-top: 2px;
        }

        .card-radio input {
          width: 18px;
          height: 18px;
          cursor: pointer;
        }

        .card-content {
          display: flex;
          flex-direction: column;
        }

        .card-label {
          font-weight: 500;
          color: #1a1a2e;
          margin-bottom: 4px;
        }

        .card-description {
          font-size: 13px;
          color: #666;
        }

        /* 압축 형식 버튼 */
        .archive-format-options {
          display: flex;
          gap: 10px;
        }

        .format-btn {
          padding: 10px 24px;
          border: 2px solid #e0e0e0;
          border-radius: 6px;
          background: #fff;
          font-size: 14px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .format-btn:hover {
          border-color: #4a90d9;
        }

        .format-btn.selected {
          border-color: #4a90d9;
          background: #4a90d9;
          color: #fff;
        }

        /* 스위치 */
        .switch-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .switch {
          position: relative;
          display: inline-block;
          width: 48px;
          height: 26px;
        }

        .switch input {
          opacity: 0;
          width: 0;
          height: 0;
        }

        .slider {
          position: absolute;
          cursor: pointer;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-color: #ccc;
          transition: 0.3s;
          border-radius: 26px;
        }

        .slider:before {
          position: absolute;
          content: "";
          height: 20px;
          width: 20px;
          left: 3px;
          bottom: 3px;
          background-color: white;
          transition: 0.3s;
          border-radius: 50%;
        }

        .switch input:checked + .slider {
          background-color: #4a90d9;
        }

        .switch input:checked + .slider:before {
          transform: translateX(22px);
        }

        /* 스크립트 종류 체크박스 */
        .script-type-options {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .script-type-checkbox {
          display: flex;
          align-items: flex-start;
          padding: 12px 14px;
          border: 1px solid #e0e0e0;
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .script-type-checkbox:hover {
          background: #f5f5f5;
        }

        .script-type-checkbox.checked {
          border-color: #4a90d9;
          background: #f0f7ff;
        }

        .script-type-checkbox input {
          margin-right: 12px;
          margin-top: 2px;
          width: 16px;
          height: 16px;
          cursor: pointer;
        }

        .checkbox-content {
          display: flex;
          flex-direction: column;
        }

        .checkbox-label {
          font-weight: 500;
          color: #333;
          margin-bottom: 2px;
        }

        .checkbox-description {
          font-size: 12px;
          color: #888;
        }

        /* 패키지 관리자 정보 */
        .pm-info {
          display: flex;
          align-items: center;
          padding: 12px 16px;
          background: #f5f5f5;
          border-radius: 6px;
          font-size: 13px;
          color: #666;
          margin-top: 8px;
        }

        .pm-icon {
          margin-right: 10px;
          font-size: 18px;
        }
      `}</style>
    </div>
  );
};

export default OSOutputOptions;
