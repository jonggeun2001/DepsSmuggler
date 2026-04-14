import { useCallback, useEffect, useRef, useState } from 'react';
import type { PackageType } from '../../stores/cart-store';
import { getRendererDataClient } from '../../lib/renderer-data-client';
import type { SearchResult } from './types';
import { createSearchService, type WizardSearchContext } from './search-service';
import { createVersionService } from './version-service';

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

export function parseSearchInput(
  packageType: PackageType,
  query: string
): ParsedSearchInput {
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
    extras: extrasMatch[2].split(',').map((item) => item.trim()).filter(Boolean),
  };
}

export function useWizardSearchFlow({
  packageType,
  searchContext,
  setCurrentStep,
  notifier,
}: UseWizardSearchFlowArgs) {
  const dataClientRef = useRef(getRendererDataClient());
  const searchServiceRef = useRef(
    createSearchService({
      client: dataClientRef.current,
    })
  );
  const versionServiceRef = useRef(
    createVersionService({
      client: dataClientRef.current,
    })
  );
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
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

  const resetSearch = useCallback(() => {
    setSearchQuery('');
    setSearchResults([]);
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
  }, []);

  const handleSelectPackage = useCallback(async (record: SearchResult) => {
    setSelectedPackage(record);
    setSelectedVersion(record.version);
    setCurrentStep(3);
    setLoadingVersions(true);

    try {
      const details = await versionServiceRef.current.loadVersionDetails(searchContext, record);
      setAvailableVersions(details.versions);
      setSelectedVersion(details.selectedVersion);
      setUsedIndexUrl(details.usedIndexUrl);
      setIsNativeLibrary(details.isNativeLibrary);
      setAvailableClassifiers(details.availableClassifiers);
      setSelectedClassifier(undefined);
    } catch (error) {
      console.error('Version fetch error:', error);
      setAvailableVersions(record.versions || [record.version]);
      setIsNativeLibrary(false);
      setAvailableClassifiers([]);
      setSelectedClassifier(undefined);
    } finally {
      setLoadingVersions(false);
    }
  }, [searchContext, setCurrentStep]);

  const handleSuggestionSelect = useCallback((item: SearchResult) => {
    setShowSuggestions(false);
    setSearchQuery(item.name);
    setSearchResults([item]);
    void handleSelectPackage(item);
  }, [handleSelectPackage]);

  const debouncedSearch = useCallback(async (query: string) => {
    if (!query.trim() || query.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    setSearching(true);
    try {
      const results = await searchServiceRef.current.searchSuggestions(searchContext, query);
      setSuggestions(results);
      setShowSuggestions(results.length > 0);
    } catch (error) {
      console.error('Search error:', error);
      setSuggestions([]);
      setShowSuggestions(false);
    } finally {
      setSearching(false);
    }
  }, [searchContext]);

  const handleInputChange = useCallback((value: string) => {
    setSearchQuery(value);

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      void debouncedSearch(value);
    }, 300);
  }, [debouncedSearch]);

  const handleSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      notifier.warning('검색어를 입력하세요');
      return;
    }

    const parsed = parseSearchInput(packageType, query);
    setExtras(parsed.extras);
    setSearching(true);
    setSearchResults([]);

    try {
      const results = await searchServiceRef.current.searchPackages(searchContext, parsed.searchQuery);
      setSearchResults(results);

      if (results.length === 0) {
        notifier.info('검색 결과가 없습니다');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '검색 중 오류가 발생했습니다';
      notifier.error(errorMessage);
      console.error('Search error:', error);
    } finally {
      setSearching(false);
    }
  }, [notifier, packageType, searchContext]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  return {
    searchQuery,
    setSearchQuery,
    searching,
    searchResults,
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
