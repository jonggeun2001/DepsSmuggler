import { message, type FormInstance } from 'antd';
import React from 'react';
import { useBlocker } from 'react-router-dom';
import {
  SMTP_TEST_MODE_MESSAGES,
  buildSettingsFormValues,
  getSmtpTestMode,
  normalizeSettingsFormValues,
  type SettingsFormSubmission,
  type SettingsStoreSnapshot,
  type SmtpTestMode,
} from './settings-form-utils';

type SmtpTestResult = 'success' | 'failed' | null;

interface UseSettingsFormActionsOptions {
  form: FormInstance;
  resetSettings: () => void;
  settingsSnapshot: SettingsStoreSnapshot;
  updateSettings: (updates: Record<string, unknown>) => void;
}

interface UseSettingsFormActionsResult {
  cacheCount: number;
  cacheSize: number;
  clearingCache: boolean;
  handleCheckForUpdates: () => Promise<void>;
  handleClearCache: () => Promise<void>;
  handleFormChange: (
    _changedValues?: Record<string, unknown>,
    allValues?: Record<string, unknown>
  ) => void;
  handleNavigationCancel: () => void;
  handleNavigationConfirm: (shouldSave: boolean) => Promise<void>;
  handleReset: () => void;
  handleSave: (values: SettingsFormSubmission) => void;
  handleSelectCacheFolder: () => Promise<void>;
  handleSelectDownloadFolder: () => Promise<void>;
  handleTestSmtp: () => Promise<void>;
  isDirty: boolean;
  loadCacheInfo: () => Promise<void>;
  loadingCache: boolean;
  showNavigationModal: boolean;
  smtpTestMode: SmtpTestMode;
  smtpTestModeMessage: string;
  smtpTestResult: SmtpTestResult;
  testingSmtp: boolean;
}

const BROWSER_SMTP_SIMULATION_DELAY_MS = 1500;

export function useSettingsFormActions({
  form,
  resetSettings,
  settingsSnapshot,
  updateSettings,
}: UseSettingsFormActionsOptions): UseSettingsFormActionsResult {
  const [isDirty, setIsDirty] = React.useState(false);
  const [showNavigationModal, setShowNavigationModal] = React.useState(false);
  const [initialValues, setInitialValues] = React.useState<SettingsFormSubmission>({});
  const [cacheSize, setCacheSize] = React.useState(0);
  const [cacheCount, setCacheCount] = React.useState(0);
  const [loadingCache, setLoadingCache] = React.useState(false);
  const [clearingCache, setClearingCache] = React.useState(false);
  const [testingSmtp, setTestingSmtp] = React.useState(false);
  const [smtpTestResult, setSmtpTestResult] = React.useState<SmtpTestResult>(null);
  const lastSynchronizedValuesRef = React.useRef<string>('');
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      isDirty && currentLocation.pathname !== nextLocation.pathname
  );

  const synchronizedFormValues = React.useMemo(
    () => buildSettingsFormValues(settingsSnapshot),
    [settingsSnapshot]
  );

  const synchronizedFormValuesKey = React.useMemo(
    () => JSON.stringify(synchronizedFormValues),
    [synchronizedFormValues]
  );

  const smtpTestMode = getSmtpTestMode(window.electronAPI);

  React.useEffect(() => {
    if (lastSynchronizedValuesRef.current === synchronizedFormValuesKey) {
      return;
    }

    form.setFieldsValue(synchronizedFormValues);
    setInitialValues(synchronizedFormValues as SettingsFormSubmission);
    setIsDirty(false);
    setSmtpTestResult(null);
    lastSynchronizedValuesRef.current = synchronizedFormValuesKey;
  }, [form, synchronizedFormValues, synchronizedFormValuesKey]);

  React.useEffect(() => {
    if (blocker.state === 'blocked') {
      setShowNavigationModal(true);
    }
  }, [blocker.state]);

  React.useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!isDirty) {
        return;
      }

      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [isDirty]);

  const handleFormChange = React.useCallback(
    (_changedValues?: Record<string, unknown>, allValues?: Record<string, unknown>) => {
      const currentValues = allValues ?? form.getFieldsValue(true);
      setIsDirty(JSON.stringify(currentValues) !== JSON.stringify(initialValues));
    },
    [form, initialValues]
  );

  const markCurrentValuesAsClean = React.useCallback(() => {
    const currentValues = form.getFieldsValue(true) as Record<string, unknown>;
    setInitialValues(currentValues);
    setIsDirty(false);
    lastSynchronizedValuesRef.current = JSON.stringify(currentValues);
  }, [form]);

  const loadCacheInfo = React.useCallback(async () => {
    setLoadingCache(true);
    try {
      if (!window.electronAPI?.cache?.getStats) {
        throw new Error('패키지 캐시 정보 API를 사용할 수 없습니다');
      }

      const stats = await window.electronAPI.cache.getStats();
      setCacheSize(stats.totalSize);
      setCacheCount(stats.entryCount);
    } catch (error) {
      console.error('패키지 캐시 정보 로드 실패:', error);
      setCacheSize(0);
      setCacheCount(0);
    } finally {
      setLoadingCache(false);
    }
  }, []);

  React.useEffect(() => {
    void loadCacheInfo();
  }, [loadCacheInfo]);

  const handleClearCache = React.useCallback(async () => {
    setClearingCache(true);
    try {
      if (!window.electronAPI?.cache?.clear) {
        throw new Error('패키지 캐시 삭제 API를 사용할 수 없습니다');
      }

      await window.electronAPI.cache.clear();
      setCacheSize(0);
      setCacheCount(0);
      message.success('패키지 캐시가 삭제되었습니다');
    } catch (error) {
      console.error('패키지 캐시 삭제 실패:', error);
      message.error('패키지 캐시 삭제에 실패했습니다');
    } finally {
      setClearingCache(false);
    }
  }, []);

  const handleSave = React.useCallback(
    (values: SettingsFormSubmission) => {
      const normalizedValues = normalizeSettingsFormValues(values);
      updateSettings(normalizedValues);
      message.success('설정이 저장되었습니다');
      markCurrentValuesAsClean();
    },
    [markCurrentValuesAsClean, updateSettings]
  );

  const handleReset = React.useCallback(() => {
    resetSettings();
    setSmtpTestResult(null);
    setShowNavigationModal(false);
    setIsDirty(false);
    message.info('설정이 초기화되었습니다');
  }, [resetSettings]);

  const handleNavigationConfirm = React.useCallback(
    async (shouldSave: boolean) => {
      if (shouldSave) {
        try {
          await form.validateFields();
          handleSave(form.getFieldsValue(true) as SettingsFormSubmission);
          blocker.proceed?.();
        } catch {
          message.error('설정 저장에 실패했습니다');
          return;
        }
      } else {
        blocker.proceed?.();
      }

      setShowNavigationModal(false);
    },
    [blocker, form, handleSave]
  );

  const handleNavigationCancel = React.useCallback(() => {
    blocker.reset?.();
    setShowNavigationModal(false);
  }, [blocker]);

  const handleSelectDownloadFolder = React.useCallback(async () => {
    if (!window.electronAPI?.selectDirectory) {
      message.info('폴더 선택은 Electron 환경에서만 가능합니다');
      return;
    }

    const selectedPath = await window.electronAPI.selectDirectory();
    if (!selectedPath) {
      return;
    }

    form.setFieldValue('defaultDownloadPath', selectedPath);
    handleFormChange(undefined, form.getFieldsValue(true));
  }, [form, handleFormChange]);

  const handleSelectCacheFolder = React.useCallback(async () => {
    if (!window.electronAPI?.selectFolder) {
      message.info('폴더 선택 기능은 Electron 환경에서 사용 가능합니다');
      return;
    }

    const folder = await window.electronAPI.selectFolder();
    if (!folder) {
      return;
    }

    form.setFieldValue('cachePath', folder);
    handleFormChange(undefined, form.getFieldsValue(true));
    message.success('폴더가 선택되었습니다');
  }, [form, handleFormChange]);

  const handleTestSmtp = React.useCallback(async () => {
    const values = form.getFieldsValue(true) as SettingsFormSubmission;
    if (!values.smtpHost || !values.smtpPort) {
      message.warning('SMTP 서버와 포트를 입력하세요');
      return;
    }

    setTestingSmtp(true);
    setSmtpTestResult(null);

    try {
      if (smtpTestMode === 'browser-simulated') {
        await new Promise((resolve) => setTimeout(resolve, BROWSER_SMTP_SIMULATION_DELAY_MS));
        setSmtpTestResult('success');
        message.success('SMTP 연결 테스트 성공 (시뮬레이션)');
        return;
      }

      if (smtpTestMode === 'missing-ipc') {
        setSmtpTestResult('failed');
        message.warning(SMTP_TEST_MODE_MESSAGES[smtpTestMode]);
        return;
      }

      const smtpTester = window.electronAPI?.testSmtpConnection;
      if (!smtpTester) {
        setSmtpTestResult('failed');
        message.warning(SMTP_TEST_MODE_MESSAGES['missing-ipc']);
        return;
      }

      const result = await smtpTester({
        host: String(values.smtpHost),
        port: Number(values.smtpPort),
        user: values.smtpUser ? String(values.smtpUser) : undefined,
        password: values.smtpPassword ? String(values.smtpPassword) : undefined,
        from: values.smtpFrom ? String(values.smtpFrom) : undefined,
      });

      const success = typeof result === 'boolean' ? result : Boolean(result.success);
      setSmtpTestResult(success ? 'success' : 'failed');

      if (success) {
        message.success('SMTP 연결 테스트 성공');
      } else {
        message.error(typeof result === 'boolean' ? 'SMTP 연결 테스트 실패' : result.error || 'SMTP 연결 테스트 실패');
      }
    } catch (error) {
      setSmtpTestResult('failed');
      message.error(error instanceof Error ? error.message : 'SMTP 연결 테스트 실패');
    } finally {
      setTestingSmtp(false);
    }
  }, [form, smtpTestMode]);

  const handleCheckForUpdates = React.useCallback(async () => {
    if (!window.electronAPI?.updater) {
      return;
    }

    message.loading({ content: '업데이트 확인 중...', key: 'update-check' });
    const result = await window.electronAPI.updater.check();

    if (result.success) {
      message.success({ content: '업데이트 확인 완료', key: 'update-check' });
    } else {
      message.error({
        content: `업데이트 확인 실패: ${result.error}`,
        key: 'update-check',
      });
    }
  }, []);

  return {
    cacheCount,
    cacheSize,
    clearingCache,
    handleCheckForUpdates,
    handleClearCache,
    handleFormChange,
    handleNavigationCancel,
    handleNavigationConfirm,
    handleReset,
    handleSave,
    handleSelectCacheFolder,
    handleSelectDownloadFolder,
    handleTestSmtp,
    isDirty,
    loadCacheInfo,
    loadingCache,
    showNavigationModal,
    smtpTestMode,
    smtpTestModeMessage: SMTP_TEST_MODE_MESSAGES[smtpTestMode],
    smtpTestResult,
    testingSmtp,
  };
}
