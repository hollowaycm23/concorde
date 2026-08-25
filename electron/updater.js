const { autoUpdater } = require('electron-updater');
const log = require('electron-log');
const { dialog, BrowserWindow, shell } = require('electron');
const Store = require('electron-store');

const store = new Store();

// Configura logs
log.transports.file.level = 'info';
autoUpdater.logger = log;

class Updater {
  constructor() {
    this.mainWindow = null;
    this.updateAvailable = false;
    this.updateDownloaded = false;
    this.updateInfo = null;
    this.checkInterval = null;
    
    this.setupEvents();
  }

  setMainWindow(window) {
    this.mainWindow = window;
  }

  setupEvents() {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('checking-for-update', () => {
      log.info('🔍 Verificando atualizações...');
      this.notifyRenderer('checking');
    });

    autoUpdater.on('update-available', (info) => {
      log.info('✅ Atualização disponível:', info.version);
      this.updateAvailable = true;
      this.updateInfo = info;
      this.notifyRenderer('available', info);
      
      // Pergunta ao usuário se quer baixar
      if (!store.get('autoDownload', true)) {
        this.showUpdateDialog(info);
      } else {
        autoUpdater.downloadUpdate();
      }
    });

    autoUpdater.on('update-not-available', (info) => {
      log.info('✔️ App está atualizado:', info.version);
      this.updateAvailable = false;
      this.notifyRenderer('not-available', info);
    });

    autoUpdater.on('error', (err) => {
      log.error('❌ Erro no auto-updater:', err);
      this.notifyRenderer('error', { message: err.message });
    });

    autoUpdater.on('download-progress', (progress) => {
      const logMessage = `Download: ${progress.percent.toFixed(1)}% ` +
        `(${this.formatBytes(progress.transferred)}/${this.formatBytes(progress.total)}) ` +
        `- ${progress.bytesPerSecond} B/s`;
      log.info(logMessage);
      this.notifyRenderer('downloading', {
        percent: progress.percent,
        transferred: progress.transferred,
        total: progress.total,
        speed: progress.bytesPerSecond
      });
    });

    autoUpdater.on('update-downloaded', (info) => {
      log.info('✅ Update baixado:', info.version);
      this.updateDownloaded = true;
      this.updateInfo = info;
      this.notifyRenderer('downloaded', info);
      this.showInstallDialog(info);
    });
  }

  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  notifyRenderer(event, data = null) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('update:event', { event, data });
    }
  }

  async checkForUpdates(manual = false) {
    try {
      log.info('🔄 Iniciando verificação de atualizações...');
      const result = await autoUpdater.checkForUpdates();
      return result;
    } catch (e) {
      log.error('Erro ao verificar:', e);
      if (manual) {
        dialog.showErrorBox('Erro', 'Não foi possível verificar atualizações: ' + e.message);
      }
    }
  }

  async downloadUpdate() {
    try {
      log.info('📥 Baixando atualização...');
      await autoUpdater.downloadUpdate();
    } catch (e) {
      log.error('Erro ao baixar:', e);
      dialog.showErrorBox('Erro', 'Não foi possível baixar a atualização: ' + e.message);
    }
  }

  installUpdate() {
    log.info('🚀 Instalando atualização...');
    autoUpdater.quitAndInstall(false, true);
  }

  async showUpdateDialog(info) {
    const { response } = await dialog.showMessageBox(this.mainWindow, {
      type: 'info',
      title: 'Nova versão disponível',
      message: `Concorde ${info.version}`,
      detail: `Uma nova versão está disponível.\n\n` +
              `Versão atual: ${autoUpdater.currentVersion}\n` +
              `Nova versão: ${info.version}\n` +
              `Tamanho: ${info.files?.[0]?.size ? this.formatBytes(info.files[0].size) : 'desconhecido'}\n\n` +
              (info.releaseNotes ? `\nNovidades:\n${this.formatReleaseNotes(info.releaseNotes)}\n\n` : '') +
              `Deseja baixar agora?`,
      buttons: ['Baixar agora', 'Depois', 'Não perguntar novamente'],
      defaultId: 0,
      cancelId: 1
    });

    if (response === 0) {
      await this.downloadUpdate();
    } else if (response === 2) {
      store.set('autoDownload', false);
    }
  }

  async showInstallDialog(info) {
    const { response } = await dialog.showMessageBox(this.mainWindow, {
      type: 'info',
      title: 'Atualização pronta',
      message: `Concorde ${info.version} foi baixado`,
      detail: 'A atualização será instalada quando você reiniciar o aplicativo.\n\n' +
              'Deseja reiniciar agora?',
      buttons: ['Reiniciar agora', 'Reiniciar depois'],
      defaultId: 0,
      cancelId: 1
    });

    if (response === 0) {
      this.installUpdate();
    }
  }

  formatReleaseNotes(notes) {
    if (typeof notes === 'string') {
      return notes.substring(0, 500) + (notes.length > 500 ? '...' : '');
    }
    return '';
  }

  startPeriodicCheck(intervalMinutes = 60) {
    // Verifica imediatamente ao iniciar
    setTimeout(() => this.checkForUpdates(), 5000);
    
    // Verifica periodicamente
    this.checkInterval = setInterval(() => {
      this.checkForUpdates();
    }, intervalMinutes * 60 * 1000);
    
    log.info(`⏰ Verificação periódica: a cada ${intervalMinutes} minutos`);
  }

  stopPeriodicCheck() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  getFeedURL() {
    return autoUpdater.getFeedURL();
  }

  setFeedURL(url) {
    autoUpdater.setFeedURL(url);
  }
}

module.exports = new Updater();
