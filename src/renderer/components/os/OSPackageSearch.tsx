/**
 * OS Package Search Component
 * OS 패키지 검색 및 결과 표시
 */

import React, { useState, useCallback } from 'react';
import type {
  OSPackageInfo,
  OSDistribution,
  OSArchitecture,
  Repository,
  MatchType,
} from '../../../core/downloaders/os/types';

interface OSPackageSearchProps {
  distribution: OSDistribution | null;
  architecture: OSArchitecture;
  repositories: Repository[];
  onAddToCart: (pkg: OSPackageInfo) => void;
}

interface SearchState {
  query: string;
  matchType: MatchType;
  isSearching: boolean;
  results: OSPackageInfo[];
  error: string | null;
}

export const OSPackageSearch: React.FC<OSPackageSearchProps> = ({
  distribution,
  architecture,
  repositories,
  onAddToCart,
}) => {
  const [state, setState] = useState<SearchState>({
    query: '',
    matchType: 'contains',
    isSearching: false,
    results: [],
    error: null,
  });

  const [addedPackages, setAddedPackages] = useState<Set<string>>(new Set());

  const handleSearch = useCallback(async () => {
    if (!state.query.trim() || !distribution) {
      return;
    }

    setState((s) => ({ ...s, isSearching: true, error: null }));

    try {
      let results: { packages: OSPackageInfo[]; totalCount: number } | undefined;

      // Electron 환경에서는 IPC 사용
      if (window.electronAPI?.os?.search) {
        results = await window.electronAPI.os.search({
          query: state.query,
          distribution,
          architecture,
          matchType: state.matchType,
          limit: 50,
        });
      } else {
        // 브라우저 환경에서는 HTTP API 사용
        const response = await fetch('/api/os/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: state.query,
            distribution,
            architecture,
            matchType: state.matchType,
            limit: 50,
          }),
        });

        if (!response.ok) {
          throw new Error(`검색 실패: ${response.statusText}`);
        }

        results = await response.json();
      }

      setState((s) => ({
        ...s,
        isSearching: false,
        results: results?.packages || [],
      }));
    } catch (error) {
      setState((s) => ({
        ...s,
        isSearching: false,
        error: error instanceof Error ? error.message : '검색 중 오류가 발생했습니다.',
        results: [],
      }));
    }
  }, [state.query, state.matchType, distribution, architecture]);

  const handleAddToCart = (pkg: OSPackageInfo) => {
    onAddToCart(pkg);
    setAddedPackages((prev) => new Set(prev).add(`${pkg.name}-${pkg.version}`));
  };

  const isAdded = (pkg: OSPackageInfo): boolean => {
    return addedPackages.has(`${pkg.name}-${pkg.version}`);
  };

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="os-package-search">
      <h3 className="selector-title">패키지 검색</h3>
      <p className="selector-description">
        설치할 패키지를 검색하세요. 와일드카드(*)를 사용할 수 있습니다.
      </p>

      {/* 검색 폼 */}
      <div className="search-form">
        <div className="search-input-group">
          <input
            type="text"
            className="search-input"
            placeholder="패키지 이름 입력 (예: httpd, nginx, python*)"
            value={state.query}
            onChange={(e) => setState((s) => ({ ...s, query: e.target.value }))}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          />
          <select
            className="match-type-select"
            value={state.matchType}
            onChange={(e) => setState((s) => ({ ...s, matchType: e.target.value as MatchType }))}
          >
            <option value="contains">부분 일치</option>
            <option value="exact">정확히 일치</option>
            <option value="startsWith">시작 문자</option>
            <option value="wildcard">와일드카드</option>
          </select>
          <button
            className="search-btn"
            onClick={handleSearch}
            disabled={state.isSearching || !state.query.trim() || !distribution}
          >
            {state.isSearching ? '검색 중...' : '검색'}
          </button>
        </div>
      </div>

      {/* 오류 메시지 */}
      {state.error && (
        <div className="error-message">
          {state.error}
        </div>
      )}

      {/* 검색 결과 */}
      {state.results.length > 0 && (
        <div className="search-results">
          <div className="results-header">
            <span>검색 결과: {state.results.length}개</span>
          </div>
          <div className="results-table-container">
            <table className="results-table">
              <thead>
                <tr>
                  <th>패키지명</th>
                  <th>버전</th>
                  <th>아키텍처</th>
                  <th>크기</th>
                  <th>설명</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {state.results.map((pkg, index) => (
                  <tr key={`${pkg.name}-${pkg.version}-${index}`}>
                    <td className="pkg-name">{pkg.name}</td>
                    <td className="pkg-version">{pkg.version}</td>
                    <td className="pkg-arch">{pkg.architecture}</td>
                    <td className="pkg-size">{formatSize(pkg.size)}</td>
                    <td className="pkg-desc" title={pkg.description}>
                      {pkg.summary || pkg.description?.substring(0, 50) || '-'}
                    </td>
                    <td className="pkg-action">
                      {isAdded(pkg) ? (
                        <span className="added-badge">추가됨</span>
                      ) : (
                        <button
                          className="add-btn"
                          onClick={() => handleAddToCart(pkg)}
                        >
                          + 담기
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 빈 결과 */}
      {state.results.length === 0 && !state.isSearching && state.query && !state.error && (
        <div className="no-results">
          검색 결과가 없습니다.
        </div>
      )}

      {/* 안내 메시지 */}
      {!distribution && (
        <div className="info-message">
          먼저 OS 버전을 선택하세요.
        </div>
      )}

      <style>{`
        .os-package-search {
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

        .search-form {
          margin-bottom: 20px;
        }

        .search-input-group {
          display: flex;
          gap: 8px;
        }

        .search-input {
          flex: 1;
          padding: 10px 14px;
          border: 1px solid #ddd;
          border-radius: 6px;
          font-size: 14px;
        }

        .search-input:focus {
          outline: none;
          border-color: #4a90d9;
        }

        .match-type-select {
          padding: 10px 12px;
          border: 1px solid #ddd;
          border-radius: 6px;
          font-size: 14px;
          background: #fff;
          cursor: pointer;
        }

        .search-btn {
          padding: 10px 20px;
          background: #4a90d9;
          color: white;
          border: none;
          border-radius: 6px;
          font-size: 14px;
          cursor: pointer;
          transition: background 0.2s;
        }

        .search-btn:hover:not(:disabled) {
          background: #3a7bc8;
        }

        .search-btn:disabled {
          background: #ccc;
          cursor: not-allowed;
        }

        .error-message {
          padding: 12px 16px;
          background: #ffebee;
          color: #c62828;
          border-radius: 6px;
          margin-bottom: 16px;
        }

        .search-results {
          border: 1px solid #e0e0e0;
          border-radius: 8px;
          overflow: hidden;
        }

        .results-header {
          padding: 12px 16px;
          background: #f5f5f5;
          border-bottom: 1px solid #e0e0e0;
          font-size: 13px;
          color: #666;
        }

        .results-table-container {
          max-height: 400px;
          overflow-y: auto;
        }

        .results-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 13px;
        }

        .results-table th {
          padding: 10px 12px;
          text-align: left;
          background: #fafafa;
          border-bottom: 1px solid #e0e0e0;
          font-weight: 600;
          color: #444;
          position: sticky;
          top: 0;
        }

        .results-table td {
          padding: 10px 12px;
          border-bottom: 1px solid #f0f0f0;
        }

        .results-table tr:hover {
          background: #f8fafc;
        }

        .pkg-name {
          font-weight: 500;
          color: #1a1a2e;
        }

        .pkg-version {
          font-family: monospace;
          color: #666;
        }

        .pkg-arch {
          color: #888;
        }

        .pkg-size {
          color: #888;
          text-align: right;
        }

        .pkg-desc {
          color: #666;
          max-width: 200px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .pkg-action {
          text-align: center;
        }

        .add-btn {
          padding: 4px 12px;
          background: #4caf50;
          color: white;
          border: none;
          border-radius: 4px;
          font-size: 12px;
          cursor: pointer;
          transition: background 0.2s;
        }

        .add-btn:hover {
          background: #388e3c;
        }

        .added-badge {
          font-size: 11px;
          padding: 4px 8px;
          background: #e8f5e9;
          color: #388e3c;
          border-radius: 4px;
        }

        .no-results {
          padding: 40px;
          text-align: center;
          color: #888;
          background: #f5f5f5;
          border-radius: 8px;
        }

        .info-message {
          padding: 20px;
          text-align: center;
          color: #1976d2;
          background: #e3f2fd;
          border-radius: 8px;
        }
      `}</style>
    </div>
  );
};

export default OSPackageSearch;
