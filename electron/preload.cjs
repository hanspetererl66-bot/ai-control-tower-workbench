// CommonJS on purpose: an ESM preload would require sandbox:false, and keeping the
// sandbox on is worth more than matching the project's module style.
const { contextBridge, ipcRenderer } = require('electron');

// The renderer talks ACP to goosed over HTTP directly (same split goose's own
// desktop uses). All it needs from main is where to find it, plus the few
// OS affordances a browser context can't do itself.
contextBridge.exposeInMainWorld('host', {
  gooseUrl: 'http://127.0.0.1:3299',
  platform: process.platform,
  workspacePath: ipcRenderer.sendSync('get-workspace-path'),
  openFile: (path) => ipcRenderer.invoke('open-file', path),
  revealFile: (path) => ipcRenderer.send('reveal-file', path),
  pickChatFiles: () => ipcRenderer.invoke('pick-chat-files'),
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
