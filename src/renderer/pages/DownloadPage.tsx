import { DedicatedOSDownloadView } from './download-page/components/DedicatedOSDownloadView';
import { DownloadEmptyState } from './download-page/components/DownloadEmptyState';
import { DownloadOSReselectionState } from './download-page/components/DownloadOSReselectionState';
import { DownloadOutcomeView } from './download-page/components/DownloadOutcomeView';
import { DownloadStandardView } from './download-page/components/DownloadStandardView';
import { useDownloadPageController } from './download-page/hooks/use-download-page-controller';

function DownloadPage() {
  const controller = useDownloadPageController();

  if (controller.viewMode === 'os-dedicated') {
    return (
      <DedicatedOSDownloadView
        outputDir={controller.outputDir}
        onOutputDirChange={controller.setOutputDir}
        onSelectFolder={controller.handleSelectFolder}
        osDownloadError={controller.osFlow.osDownloadError}
        osResult={controller.osFlow.osResult}
        osProgress={controller.osFlow.osProgress}
        osPackages={controller.osFlow.osPackages}
        osDistribution={controller.osFlow.osDistribution}
        historyOSOutputOptions={controller.osFlow.historyOSOutputOptions}
        osDownloading={controller.osFlow.osDownloading}
        isOSPackaging={controller.osFlow.isOSPackaging}
        onCancelOSDownload={controller.osFlow.handleCancelOSDownload}
        onStartOSDownload={controller.osFlow.handleStartOSDownload}
        onOpenFolder={controller.handleOpenFolder}
        onComplete={controller.handleComplete}
        onRemoveOSPackage={controller.osFlow.handleRemoveOSPackage}
        onClearCart={controller.clearCart}
      />
    );
  }

  if (controller.viewMode === 'os-reselection') {
    return (
      <DownloadOSReselectionState
        onGoToWizard={controller.goToWizard}
        onClearCart={controller.clearCart}
      />
    );
  }

  if (controller.viewMode === 'empty') {
    return <DownloadEmptyState onGoToCart={controller.goToCart} />;
  }

  if (controller.viewMode === 'completed' || controller.viewMode === 'failed') {
    return (
      <DownloadOutcomeView
        variant={controller.viewMode}
        completedCount={controller.completedCount}
        failedCount={controller.failedCount}
        skippedCount={controller.skippedCount}
        isDownloading={controller.isDownloading}
        outputFormat={controller.outputFormat}
        deliveryMethod={controller.deliveryMethod}
        completedOutputPath={controller.completedOutputPath}
        outputDir={controller.outputDir}
        completedArtifactPaths={controller.completedArtifactPaths}
        completedDeliveryResult={controller.completedDeliveryResult}
        completedError={controller.completedError}
        downloadItems={controller.downloadItems}
        logs={controller.logs}
        onRetry={controller.executeRetryDownload}
        onRestartDownload={controller.handleStartDownload}
        onOpenFolder={controller.handleOpenFolder}
        onComplete={controller.handleComplete}
      />
    );
  }

  return (
    <DownloadStandardView
      outputDir={controller.outputDir}
      onOutputDirChange={controller.setOutputDir}
      deliveryMethod={controller.deliveryMethod}
      onDeliveryMethodChange={controller.setDeliveryMethod}
      effectiveSmtpTo={controller.effectiveSmtpTo}
      outputFormat={controller.outputFormat}
      fileSplitEnabled={controller.fileSplitEnabled}
      maxFileSizeMB={controller.maxFileSizeMB}
      isDownloading={controller.isDownloading}
      onSelectFolder={controller.handleSelectFolder}
      downloadItems={controller.downloadItems}
      completedCount={controller.completedCount}
      failedCount={controller.failedCount}
      skippedCount={controller.skippedCount}
      totalDownloadedBytes={controller.totalDownloadedBytes}
      totalExpectedBytes={controller.totalExpectedBytes}
      totalProgress={controller.totalProgress}
      isPaused={controller.isPaused}
      packagingStatus={controller.packagingStatus}
      packagingProgress={controller.packagingProgress}
      totalSpeed={controller.totalSpeed}
      remainingTime={controller.remainingTime}
      includeDependencies={controller.includeDependencies}
      depsResolved={controller.depsResolved}
      isResolvingDeps={controller.isResolvingDeps}
      allCompleted={controller.allCompleted}
      logs={controller.logs}
      onRetry={controller.executeRetryDownload}
      onResolveDependencies={controller.handleResolveDependencies}
      onResetDependencies={controller.resetDependencies}
      onStartDownload={controller.handleStartDownload}
      onPauseResume={controller.handlePauseResume}
      onCancelDownload={controller.handleCancelDownload}
      onComplete={controller.handleComplete}
    />
  );
}

export default DownloadPage;
