const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getPort: () => ipcRenderer.invoke('get-port'),
  showNotification: (data) => ipcRenderer.invoke('show-notification', data),
  isDesktop: true,
  platform: process.platform,
  
  // Updater API
  updater: {
    check: () => ipcRenderer.invoke('updater:check'),
    download: () => ipcRenderer.invoke('updater:download'),
    install: () => ipcRenderer.invoke('updater:install'),
    getStatus: () => ipcRenderer.invoke('updater:get-status'),
    onEvent: (callback) => {
      ipcRenderer.on('update:event', (event, data) => callback(data));
    }
  }
});
