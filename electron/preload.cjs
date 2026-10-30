// CommonJS on purpose: an ESM preload would require sandbox:false, and keeping the
// sandbox on is worth more than matching the project's module style.
const { contextBridge, ipcRenderer, webFrame, webUtils } = require('electron');

// The renderer talks ACP to goosed over HTTP directly (same split goose's own
// desktop uses). All it needs from main is where to find it, plus the few
// OS affordances a browser context can't do itself.
contextBridge.exposeInMainWorld('host', {
  gooseUrl: 'http://127.0.0.1:3299',
  platform: process.platform,
  workspacePath: ipcRenderer.sendSync('get-workspace-path'),
  setZoomFactor: (factor) => {
    const f = Number(factor);
    if (f >= 0.8 && f <= 1.5) webFrame.setZoomFactor(f);
  },
  openFile: (path) => ipcRenderer.invoke('open-file', path),
  revealFile: (path) => ipcRenderer.send('reveal-file', path),
  pickChatFiles: () => ipcRenderer.invoke('pick-chat-files'),
  /** Absolute paths of files dropped on the window (the page itself never sees them). */
  pathsOfDroppedFiles: (files) => Array.from(files ?? []).map((f) => webUtils.getPathForFile(f)).filter(Boolean),
  addChatFiles: (paths) => ipcRenderer.invoke('add-chat-files', paths),
  readTables: (path) => ipcRenderer.invoke('read-tables', path),
  bulkUploadRows: (request) => ipcRenderer.invoke('bulk-upload-rows', request),
  cancelBulkUpload: () => ipcRenderer.send('bulk-upload-cancel'),
  onBulkUploadProgress: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('bulk-upload-progress', handler);
    return () => ipcRenderer.removeListener('bulk-upload-progress', handler);
  },
  runLocalWorkflow: (request) => ipcRenderer.invoke('run-local-workflow', request),

  // Werkbank install deep links. Callbacks receive only
  // the already-validated fields main.mjs extracted, never the raw URL.
  onSkillInstallRequest: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('skill-install-request', handler);
    return () => ipcRenderer.removeListener('skill-install-request', handler);
  },
  onSkillInstallResult: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('skill-install-result', handler);
    return () => ipcRenderer.removeListener('skill-install-result', handler);
  },
  decideSkillInstall: (id, approved, values) =>
    ipcRenderer.send('skill-install-decision', { id, approved, values }),

  // Managing what is installed.
  listSkills: () => ipcRenderer.invoke('list-skills'),
  readSkill: (dir) => ipcRenderer.invoke('read-skill', dir),
  importMcpb: () => ipcRenderer.invoke('import-mcpb'),
  prepareControlTowerConnector: () => ipcRenderer.invoke('prepare-control-tower-connector'),
  getConnectorSpec: (name) => ipcRenderer.invoke('get-connector-spec', name),
  saveConnectorConfig: (name, values, config) =>
    ipcRenderer.invoke('save-connector-config', { name, values, config }),
  removeSkill: (name) => ipcRenderer.invoke('remove-skill', name),
  forgetSecrets: (name) => ipcRenderer.invoke('forget-secrets', name),
  setConnectorEnabled: (name, enabled) =>
    ipcRenderer.invoke('set-connector-enabled', { name, enabled }),
  removeConnector: (name) => ipcRenderer.invoke('remove-connector', name),
  restartAgent: () => ipcRenderer.invoke('restart-agent'),

  // n8n Cloud: embedded UI + chat connection. Only the instance URL crosses this bridge.
  n8n: {
    getSettings: () => ipcRenderer.invoke('n8n-get-settings'),
    saveSettings: (url) => ipcRenderer.invoke('n8n-save-settings', url),
    show: (bounds) => ipcRenderer.invoke('n8n-show', bounds),
    hide: () => ipcRenderer.invoke('n8n-hide'),
    reload: () => ipcRenderer.invoke('n8n-reload'),
    back: () => ipcRenderer.invoke('n8n-back'),
    forward: () => ipcRenderer.invoke('n8n-forward'),
    home: () => ipcRenderer.invoke('n8n-home'),
    onNavState: (callback) => {
      const handler = (_event, state) => callback(state);
      ipcRenderer.on('n8n-nav-state', handler);
      return () => ipcRenderer.removeListener('n8n-nav-state', handler);
    },
    setTheme: (theme) => ipcRenderer.invoke('n8n-set-theme', theme),
    connectChat: () => ipcRenderer.invoke('n8n-connect-chat'),
    disconnectChat: () => ipcRenderer.invoke('n8n-disconnect-chat'),
  },

  // Voice input: the key never reaches the renderer, only hasKey.
  voice: {
    getSettings: () => ipcRenderer.invoke('voice-get-settings'),
    saveSettings: (patch) => ipcRenderer.invoke('voice-save-settings', patch),
    transcribe: (audio, mimeType) => ipcRenderer.invoke('voice-transcribe', { audio, mimeType }),
  },
});
