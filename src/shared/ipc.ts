/** Canales IPC compartidos entre main y preload. */
export const IPC = {
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  settingsSetApiKey: 'settings:set-api-key',
  settingsChanged: 'settings:changed',
  providerModels: 'provider:models',

  whisperModelsList: 'whisper-models:list',
  whisperModelsDownload: 'whisper-models:download',
  whisperModelsCancel: 'whisper-models:cancel',
  whisperModelsDelete: 'whisper-models:delete',
  whisperModelsProgress: 'whisper-models:progress',

  dialogPickMedia: 'dialog:pick-media',
  micRequestAccess: 'mic:request-access',

  jobStartFile: 'job:start-file',
  jobStartRecording: 'job:start-recording',
  jobSummarize: 'job:summarize',
  jobCancel: 'job:cancel',
  jobRetry: 'job:retry',
  jobProgress: 'job:progress',
  jobSummaryDelta: 'job:summary-delta',
  jobFinished: 'job:finished',
  jobActive: 'job:active',

  libraryList: 'library:list',
  libraryGet: 'library:get',
  libraryRename: 'library:rename',
  libraryDelete: 'library:delete',
  libraryDeleteSummary: 'library:delete-summary',
  libraryChanged: 'library:changed',

  updateGetState: 'update:get-state',
  updateCheck: 'update:check',
  updateInstall: 'update:install',
  updateOpenDownload: 'update:open-download',
  updateStatus: 'update:status',

  exportEntry: 'export:entry',
  openExternal: 'shell:open-external'
} as const
