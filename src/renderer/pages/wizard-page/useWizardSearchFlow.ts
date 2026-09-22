import { useCallback, useEffect, useRef, useState } from 'react';
import type { PackageType } from '../../stores/cart-store';
import { getRendererDataClient } from '../../lib/renderer-data-client';
import type { SearchResult } from './types';
import { createSearchService, type WizardSearchContext } from './search-service';
import { createVersionService } from './version-service';
import { toQueryFailure } from '../../../utils/query-error';
import type { QueryFailure } from '../../../types/query-error';

export interface WizardSearchNotifier {
  info: (message: string) => void;
  warning: (message: string) => void;
  error: (message: string) => void;
}

export interface ParsedSearchInput {
  searchQuery: string;
  extras: string[];
}

export interface UseWizardSearchFlowArgs {
  packageType: PackageType;
  searchContext: WizardSearchContext;
  setCurrentStep: (step: number) => void;
  notifier: WizardSearchNotifier;
}

export function parseSearchInput(packageType: PackageType, query: string): ParsedSearchInput {
  if (packageType !== 'pip') {
    return {
      searchQuery: query,
      extras: [],
    };
  }

  const extrasMatch = query.match(/^([a-zA-Z0-9_-]+)\[([a-zA-Z0-9_,\s]+)\]$/);
  if (!extrasMatch) {
    return {
      searchQuery: query,
      extras: [],
    };
  }

  return {
    searchQuery: extrasMatch[1],
    extras: extrasMatch[2]
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  };
}

export function useWizardSearchFlow({
  packageType,
  searchContext,
  setCurrentStep,
  notifier,
}: UseWizardSearchFlowArgs) {
  const dataClientRef = useRef(getRendererDataClient());
  const searchServiceRef = useRef(createSearchService({ client: dataClientRef.current }));
  const versionServiceRef = useRef(createVersionService({ client: dataClientRef.current }));
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRequestRef = useRef(0);
  const versionRequestRef = useRef(0);
  const mountedRef = useRef(true);
  // WizardPage constructs this object on every render; compare its values, not its identity.
  const contextKey = JSON.stringify(searchContext);
  const contextKeyRef = useRef(contextKey);
  contextKeyRef.current = contextKey;

  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchError, setSearchError] = useState<QueryFailure | null>(null);
  const [searchEmpty, setSearchEmpty] = useState(false);
  const [versionError, setVersionError] = useState<QueryFailure | null>(null);
  const [selectedPackage, setSelectedPackage] = useState<SearchResult | null>(null);
  const [suggestions, setSuggestions] = useState<SearchResult[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState('');
  const [availableVersions, setAvailableVersions] = useState<string[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [usedIndexUrl, setUsedIndexUrl] = useState<string | undefined>(undefined);
  const [extras, setExtras] = useState<string[]>([]);
  const [isNativeLibrary, setIsNativeLibrary] = useState(false);
  const [selectedClassifier, setSelectedClassifier] = useState<string | undefined>();
  const [availableClassifiers, setAvailableClassifiers] = useState<string[]>([]);
  const [customClassifier, setCustomClassifier] = useState('');

  const invalidateSearch = useCallback(() => {
    searchRequestRef.current++;
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = null;
    setSearching(false);
  }, []);

  const resetSearch = useCallback(() => {
    invalidateSearch();
    versionRequestRef.current++;
    setLoadingVersions(false);
    setSearchQuery('');
    setSearchResults([]);
    setSearchError(null);
    setSearchEmpty(false);
    setVersionError(null);
    setSelectedPackage(null);
    setSelectedVersion('');
    setAvailableVersions([]);
    setSuggestions([]);
    setShowSuggestions(false);
    setUsedIndexUrl(undefined);
    setExtras([]);
    setIsNativeLibrary(false);
    setSelectedClassifier(undefined);
    setAvailableClassifiers([]);
    setCustomClassifier('');
  }, [invalidateSearch]);

  const handleSelectPackage = useCallback(
    async (record: SearchResult) => {
      invalidateSearch();
      const request = ++versionRequestRef.current;
      const isCurrent = () =>
        mountedRef.current &&
        request === versionRequestRef.current &&
        contextKey === contextKeyRef.current;
      setSelectedPackage(record);
      setSelectedVersion(record.version);
      setAvailableVersions([]);
      setUsedIndexUrl(undefined);
      setVersionError(null);
      setIsNativeLibrary(false);
      setAvailableClassifiers([]);
      setSelectedClassifier(undefined);
      setCustomClassifier('');
      setCurrentStep(3);
      setLoadingVersions(true);
      try {
        const details = await versionServiceRef.current.loadVersionDetails(searchContext, record);
        if (!isCurrent()) return;
        setVersionError(details.versionError ?? null);
        setAvailableVersions(details.versions);
        setSelectedVersion(details.selectedVersion);
        setUsedIndexUrl(details.usedIndexUrl);
        setIsNativeLibrary(details.isNativeLibrary);
        setAvailableClassifiers(details.availableClassifiers);
      } catch (error) {
        if (!isCurrent()) return;
        setVersionError(toQueryFailure(error));
        setAvailableVersions(record.versions?.length ? record.versions : [record.version]);
        // The search result is already from the selected custom index, even if version lookup fails.
        if (
          packageType === 'pip' &&
          searchContext.useCustomIndex &&
          typeof window.electronAPI?.search?.versions === 'function'
        ) {
          setUsedIndexUrl(searchContext.customIndexUrl || undefined);
        }
      } finally {
        if (isCurrent()) setLoadingVersions(false);
      }
    },
    [contextKey, invalidateSearch, packageType, searchContext, setCurrentStep]
  );

  const handleSuggestionSelect = useCallback(
    (item: SearchResult) => {
      setShowSuggestions(false);
      setSearchError(null);
      setSearchEmpty(false);
      setSearchQuery(item.name);
      setSearchResults([item]);
      void handleSelectPackage(item);
    },
    [handleSelectPackage]
  );

  const runSearch = useCallback(
    async (query: string) => {
      invalidateSearch();
      const request = searchRequestRef.current;
      const isCurrent = () =>
        mountedRef.current &&
        request === searchRequestRef.current &&
        contextKey === contextKeyRef.current;
      const parsed = parseSearchInput(packageType, query.trim());
      setExtras(parsed.extras);
      setSearching(true);
      setSearchError(null);
      setSearchEmpty(false);
      setSearchResults([]);
      setSuggestions([]);
      setShowSuggestions(false);
      try {
        const results = await searchServiceRef.current.searchSuggestions(
          searchContext,
          parsed.searchQuery
        );
        if (!isCurrent()) return;
        setSearchResults(results);
        setSuggestions(results);
        setShowSuggestions(results.length > 0);
        setSearchEmpty(results.length === 0);
      } catch (error) {
        if (isCurrent()) setSearchError(toQueryFailure(error));
      } finally {
        if (isCurrent()) setSearching(false);
      }
    },
    [contextKey, invalidateSearch, packageType, searchContext]
  );

  const handleInputChange = useCallback(
    (value: string) => {
      invalidateSearch();
      versionRequestRef.current++;
      setLoadingVersions(false);
      setSearchQuery(value);
      setSearchError(null);
      setSearchEmpty(false);
      setVersionError(null);
      setSelectedPackage(null);
      setSuggestions([]);
      setShowSuggestions(false);
      if (value.trim().length >= 2) {
        debounceTimerRef.current = setTimeout(() => {
          void runSearch(value);
        }, 300);
      }
    },
    [invalidateSearch, runSearch]
  );

  const handleSearch = useCallback(
    async (query: string) => {
      if (!query.trim()) {
        invalidateSearch();
        notifier.warning('검색어를 입력하세요');
        return;
      }
      await runSearch(query);
    },
    [invalidateSearch, notifier, runSearch]
  );

  useEffect(() => {
    resetSearch();
  }, [contextKey, resetSearch]);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      searchRequestRef.current++;
      versionRequestRef.current++;
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, []);

  return {
    searchQuery,
    setSearchQuery,
    searching,
    searchResults,
    searchError,
    searchEmpty,
    versionError,
    selectedPackage,
    suggestions,
    showSuggestions,
    setShowSuggestions,
    selectedVersion,
    setSelectedVersion,
    availableVersions,
    loadingVersions,
    usedIndexUrl,
    extras,
    isNativeLibrary,
    selectedClassifier,
    setSelectedClassifier,
    availableClassifiers,
    customClassifier,
    setCustomClassifier,
    resetSearch,
    handleInputChange,
    handleSuggestionSelect,
    handleSearch,
    handleSelectPackage,
  };
}
