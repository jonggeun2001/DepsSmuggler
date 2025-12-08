/**
 * Repository Selector Component
 * 저장소 선택 및 사용자 정의 저장소 추가
 */

import React, { useState } from 'react';
import type { Repository, OSDistribution } from '../../../core/downloaders/os/types';

interface RepositorySelectorProps {
  distribution: OSDistribution | null;
  selectedRepos: Repository[];
  customRepos: Repository[];
  onSelectedChange: (repos: Repository[]) => void;
  onCustomReposChange: (repos: Repository[]) => void;
}

interface CustomRepoForm {
  name: string;
  baseUrl: string;
  gpgCheck: boolean;
}

export const RepositorySelector: React.FC<RepositorySelectorProps> = ({
  distribution,
  selectedRepos,
  customRepos,
  onSelectedChange,
  onCustomReposChange,
}) => {
  const [showAddForm, setShowAddForm] = useState(false);
  const [newRepo, setNewRepo] = useState<CustomRepoForm>({
    name: '',
    baseUrl: '',
    gpgCheck: false,
  });

  const defaultRepos = distribution?.defaultRepos || [];
  const extendedRepos = distribution?.extendedRepos || [];

  const isRepoSelected = (repo: Repository): boolean => {
    return selectedRepos.some((r) => r.id === repo.id);
  };

  const toggleRepo = (repo: Repository) => {
    if (isRepoSelected(repo)) {
      onSelectedChange(selectedRepos.filter((r) => r.id !== repo.id));
    } else {
      onSelectedChange([...selectedRepos, repo]);
    }
  };

  const handleAddCustomRepo = () => {
    if (!newRepo.name || !newRepo.baseUrl) return;

    const customRepo: Repository = {
      id: `custom-${Date.now()}`,
      name: newRepo.name,
      baseUrl: newRepo.baseUrl,
      enabled: true,
      gpgCheck: newRepo.gpgCheck,
      isOfficial: false,
    };

    onCustomReposChange([...customRepos, customRepo]);
    onSelectedChange([...selectedRepos, customRepo]);
    setNewRepo({ name: '', baseUrl: '', gpgCheck: false });
    setShowAddForm(false);
  };

  const removeCustomRepo = (repoId: string) => {
    onCustomReposChange(customRepos.filter((r) => r.id !== repoId));
    onSelectedChange(selectedRepos.filter((r) => r.id !== repoId));
  };

  return (
    <div className="repository-selector">
      <h3 className="selector-title">저장소 선택</h3>
      <p className="selector-description">
        패키지를 검색할 저장소를 선택하세요. 기본 저장소는 필수입니다.
      </p>

      {/* 기본 저장소 */}
      <div className="repo-section">
        <h4 className="repo-section-title">기본 저장소</h4>
        <div className="repo-list">
          {defaultRepos.map((repo) => (
            <div key={repo.id} className="repo-item default">
              <div className="repo-checkbox">
                <input
                  type="checkbox"
                  checked={true}
                  disabled={true}
                  readOnly
                />
              </div>
              <div className="repo-info">
                <span className="repo-name">{repo.name}</span>
                <span className="repo-url">{repo.baseUrl}</span>
              </div>
              <span className="badge required">필수</span>
            </div>
          ))}
          {defaultRepos.length === 0 && (
            <p className="no-repos">배포판을 먼저 선택하세요.</p>
          )}
        </div>
      </div>

      {/* 확장 저장소 */}
      {extendedRepos.length > 0 && (
        <div className="repo-section">
          <h4 className="repo-section-title">확장 저장소</h4>
          <div className="repo-list">
            {extendedRepos.map((repo) => (
              <div
                key={repo.id}
                className={`repo-item ${isRepoSelected(repo) ? 'selected' : ''}`}
                onClick={() => toggleRepo(repo)}
              >
                <div className="repo-checkbox">
                  <input
                    type="checkbox"
                    checked={isRepoSelected(repo)}
                    onChange={() => toggleRepo(repo)}
                  />
                </div>
                <div className="repo-info">
                  <span className="repo-name">{repo.name}</span>
                  <span className="repo-url">{repo.baseUrl}</span>
                </div>
                {repo.gpgCheck && (
                  <span className="badge gpg">GPG</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 사용자 정의 저장소 */}
      <div className="repo-section">
        <div className="section-header">
          <h4 className="repo-section-title">사용자 정의 저장소</h4>
          <button
            className="add-repo-btn"
            onClick={() => setShowAddForm(!showAddForm)}
          >
            {showAddForm ? '취소' : '+ 추가'}
          </button>
        </div>

        {showAddForm && (
          <div className="add-repo-form">
            <div className="form-row">
              <label>저장소 이름</label>
              <input
                type="text"
                placeholder="예: my-custom-repo"
                value={newRepo.name}
                onChange={(e) => setNewRepo({ ...newRepo, name: e.target.value })}
              />
            </div>
            <div className="form-row">
              <label>Base URL</label>
              <input
                type="text"
                placeholder="예: https://example.com/repo"
                value={newRepo.baseUrl}
                onChange={(e) => setNewRepo({ ...newRepo, baseUrl: e.target.value })}
              />
            </div>
            <div className="form-row checkbox-row">
              <label>
                <input
                  type="checkbox"
                  checked={newRepo.gpgCheck}
                  onChange={(e) => setNewRepo({ ...newRepo, gpgCheck: e.target.checked })}
                />
                GPG 서명 검증
              </label>
            </div>
            <button
              className="submit-btn"
              onClick={handleAddCustomRepo}
              disabled={!newRepo.name || !newRepo.baseUrl}
            >
              저장소 추가
            </button>
          </div>
        )}

        <div className="repo-list">
          {customRepos.map((repo) => (
            <div
              key={repo.id}
              className={`repo-item custom ${isRepoSelected(repo) ? 'selected' : ''}`}
            >
              <div className="repo-checkbox">
                <input
                  type="checkbox"
                  checked={isRepoSelected(repo)}
                  onChange={() => toggleRepo(repo)}
                />
              </div>
              <div className="repo-info">
                <span className="repo-name">{repo.name}</span>
                <span className="repo-url">{repo.baseUrl}</span>
              </div>
              <button
                className="remove-btn"
                onClick={() => removeCustomRepo(repo.id)}
              >
                삭제
              </button>
            </div>
          ))}
          {customRepos.length === 0 && !showAddForm && (
            <p className="no-repos">사용자 정의 저장소가 없습니다.</p>
          )}
        </div>
      </div>

      <style>{`
        .repository-selector {
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

        .repo-section {
          margin-bottom: 24px;
        }

        .section-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .repo-section-title {
          font-size: 14px;
          font-weight: 600;
          color: #444;
          margin-bottom: 12px;
        }

        .repo-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .repo-item {
          display: flex;
          align-items: center;
          padding: 12px;
          border: 1px solid #e0e0e0;
          border-radius: 8px;
          background: #fff;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .repo-item.default {
          background: #f5f5f5;
          cursor: default;
        }

        .repo-item:hover:not(.default) {
          border-color: #4a90d9;
        }

        .repo-item.selected {
          border-color: #4a90d9;
          background: #f0f7ff;
        }

        .repo-checkbox {
          margin-right: 12px;
        }

        .repo-checkbox input {
          width: 18px;
          height: 18px;
          cursor: pointer;
        }

        .repo-info {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .repo-name {
          font-size: 14px;
          font-weight: 500;
          color: #1a1a2e;
        }

        .repo-url {
          font-size: 12px;
          color: #888;
          font-family: monospace;
          word-break: break-all;
        }

        .badge {
          font-size: 10px;
          padding: 2px 8px;
          border-radius: 4px;
          margin-left: 8px;
        }

        .badge.required {
          background: #e0e0e0;
          color: #666;
        }

        .badge.gpg {
          background: #e8f5e9;
          color: #388e3c;
        }

        .add-repo-btn {
          font-size: 13px;
          padding: 4px 12px;
          border: 1px solid #4a90d9;
          border-radius: 4px;
          background: #fff;
          color: #4a90d9;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .add-repo-btn:hover {
          background: #4a90d9;
          color: #fff;
        }

        .add-repo-form {
          padding: 16px;
          border: 1px solid #e0e0e0;
          border-radius: 8px;
          background: #fafafa;
          margin-bottom: 12px;
        }

        .form-row {
          margin-bottom: 12px;
        }

        .form-row label {
          display: block;
          font-size: 13px;
          font-weight: 500;
          margin-bottom: 4px;
          color: #444;
        }

        .form-row input[type="text"] {
          width: 100%;
          padding: 8px 12px;
          border: 1px solid #ddd;
          border-radius: 4px;
          font-size: 14px;
        }

        .checkbox-row label {
          display: flex;
          align-items: center;
          gap: 8px;
          cursor: pointer;
        }

        .submit-btn {
          padding: 8px 16px;
          background: #4a90d9;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 14px;
        }

        .submit-btn:disabled {
          background: #ccc;
          cursor: not-allowed;
        }

        .remove-btn {
          font-size: 12px;
          padding: 4px 8px;
          border: 1px solid #f44336;
          border-radius: 4px;
          background: #fff;
          color: #f44336;
          cursor: pointer;
          margin-left: 8px;
        }

        .remove-btn:hover {
          background: #f44336;
          color: #fff;
        }

        .no-repos {
          color: #888;
          font-size: 13px;
          padding: 12px;
          text-align: center;
          background: #f5f5f5;
          border-radius: 4px;
        }
      `}</style>
    </div>
  );
};

export default RepositorySelector;
