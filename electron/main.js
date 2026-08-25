const { app, BrowserWindow, Tray, Menu, dialog, shell, ipcMain, nativeImage } = require('electron');
const path = require('path');
const Store = require('electron-store');
const updater = require('./updater');

const store = new Store();
let mainWindow = null;
let tray = null;

function startServer() {
  try {
    const PORT = store.get('port', 3000);
    const userDataPath = app.getPath('userData');
    process.env.PORT = PORT;
    process.env.DB_PATH = path.join(userDataPath, 'concorde.db');
    process.env.UPLOADS_PATH = path.join(userDataPath, 'uploads');
    require('../server.js');
    console.log(`✅ Servidor iniciado na porta ${PORT}`);
  } catch (e) {
    console.error('❌ Erro ao iniciar servidor:', e);
    dialog.showErrorBox('Erro', 'Não foi possível iniciar o servidor: ' + e.message);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    icon: path.join(__dirname, 'concorde.png'),
    backgroundColor: '#313338',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true
    },
    show: false
  });

  const PORT = store.get('port', 3000);
  mainWindow.loadURL(`http://localhost:${PORT}`);

  // Recarrega se a página falhar ao carregar (server ainda inicializando)
  mainWindow.webContents.on('did-fail-load', (e, code, desc, url, isMain) => {
    if (isMain) {
      setTimeout(() => {
        mainWindow.loadURL(`http://localhost:${PORT}`).catch(() => {});
      }, 1000);
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (store.get('maximized', false)) {
      mainWindow.maximize();
    }
  });

  mainWindow.on('close', (e) => {
    if (store.get('minimizeToTray', true) && !app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('maximize', () => store.set('maximized', true));
  mainWindow.on('unmaximize', () => store.set('maximized', false));

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Configura updater
  updater.setMainWindow(mainWindow);
}

function createTray() {
  const iconPath = path.join(__dirname, 'concorde.png');
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Abrir Concorde',
      click: () => {
        mainWindow.show();
        if (mainWindow.isMinimized()) mainWindow.restore();
      }
    },
    { type: 'separator' },
    {
      label: 'Verificar atualizações',
      click: () => updater.checkForUpdates(true)
    },
    { type: 'separator' },
    {
      label: 'Minimizar para Tray',
      type: 'checkbox',
      checked: store.get('minimizeToTray', true),
      click: (item) => store.set('minimizeToTray', item.checked)
    },
    {
      label: 'Iniciar com Windows',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked })
    },
    { type: 'separator' },
    {
      label: 'Sair',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);
  
  tray.setToolTip('Concorde');
  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => mainWindow.show());
}

function createMenu() {
  const template = [
    {
      label: 'Arquivo',
      submenu: [
        { 
          label: 'Verificar atualizações',
          accelerator: 'CmdOrCtrl+U',
          click: () => updater.checkForUpdates(true)
        },
        { type: 'separator' },
        { 
          label: 'Sair', 
          accelerator: 'CmdOrCtrl+Q',
          click: () => {
            app.isQuitting = true;
            app.quit();
          }
        }
      ]
    },
    {
      label: 'Ajuda',
      submenu: [
        {
          label: `Sobre (v${app.getVersion()})`,
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'Sobre',
              message: 'Concorde',
              detail: `Versão: ${app.getVersion()}\n` +
                      `Electron: ${process.versions.electron}\n` +
                      `Chrome: ${process.versions.chrome}\n` +
                      `Node.js: ${process.versions.node}\n\n` +
                      `© 2026 Concorde`,
              buttons: ['OK', 'Verificar atualizações']
            }).then(({ response }) => {
              if (response === 1) updater.checkForUpdates(true);
            });
          }
        }
      ]
    }
  ];
  
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// IPC handlers para updater
ipcMain.handle('updater:check', () => updater.checkForUpdates(true));
ipcMain.handle('updater:download', () => updater.downloadUpdate());
ipcMain.handle('updater:install', () => updater.installUpdate());
ipcMain.handle('updater:get-status', () => ({
  currentVersion: app.getVersion(),
  updateAvailable: updater.updateAvailable,
  updateDownloaded: updater.updateDownloaded,
  updateInfo: updater.updateInfo
}));

function waitForServer(port, tries = 40) {
  return new Promise((resolve) => {
    const attempt = (n) => {
      const req = require('http').get(`http://127.0.0.1:${port}/`, (res) => {
        res.resume();
        resolve(true);
      });
      req.on('error', () => {
        if (n <= 0) return resolve(false);
        setTimeout(() => attempt(n - 1), 500);
      });
    };
    attempt(tries);
  });
}

app.whenReady().then(async () => {
  startServer();

  const port = store.get('port', 3000);
  const ok = await waitForServer(port);
  if (!ok) {
    dialog.showErrorBox('Erro', `O servidor interno não respondeu na porta ${port}. Verifique se outro processo não está usando a porta e tente novamente.`);
  }

  createWindow();
  createTray();
  createMenu();

  // Inicia auto-update apenas se empacotado
  if (app.isPackaged) {
    updater.startPeriodicCheck(60); // verifica a cada 60 min
  } else {
    console.log('⚠️ Auto-update desativado em modo desenvolvimento');
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  app.isQuitting = true;
  updater.stopPeriodicCheck();
});

