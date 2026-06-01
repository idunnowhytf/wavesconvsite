const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const os = require('os');
const https = require('https');
const http = require('http');
const engine = require('./lib/engine');
const cli = require('./cli');

// Tryb CLI: node cli.js …  lub  npx electron . --cli download …
const rawArgv = process.argv.slice(1);
const cliFlagIdx = rawArgv.indexOf('--cli');
if (cliFlagIdx !== -1) {
  cli.run(rawArgv.slice(cliFlagIdx + 1)).then(code => process.exit(code ?? 0)).catch(e => {
    console.error(e.message || e);
    process.exit(1);
  });
} else {
  startElectronApp();
}

function startElectronApp() {
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, Tray, globalShortcut, clipboard } = require('electron');
const QRCode = require('qrcode');

let mainWindow;
let ytDlpPath;
let tray = null;
let shareServer = null;
let isQuitting = false;
let pendingDeepLink = null;

const PROTOCOL = 'wavesconverter';

function syncEngineUserData() {
  if (app.isReady()) process.env.WAVESCONVERTER_USER_DATA = app.getPath('userData');
}

function findYtDlp() {
  syncEngineUserData();
  return engine.findYtDlp();
}

function findFfmpeg() {
  syncEngineUserData();
  let p = engine.findFfmpeg();
  if (p) return p;
  try {
    const i = require('@ffmpeg-installer/ffmpeg');
    let fp = i.path;
    if (app.isPackaged) fp = fp.replace('app.asar', 'app.asar.unpacked');
    if (fs.existsSync(fp)) return fp;
  } catch (_) {}
  return null;
}

function registerProtocol() {
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
    }
  } else {
    app.setAsDefaultProtocolClient(PROTOCOL);
  }
}

function deliverDeepLink(payload) {
  if (!payload) return;
  if (mainWindow?.webContents && !mainWindow.webContents.isLoading()) {
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send('deep-link', payload);
    pendingDeepLink = null;
  } else {
    pendingDeepLink = payload;
  }
}

function handleDeepLinkUrl(url) {
  const payload = engine.parseDeepLink(url);
  if (payload) deliverDeepLink(payload);
}

function flushPendingDeepLink() {
  if (pendingDeepLink) deliverDeepLink(pendingDeepLink);
}

// Helper: Get ffbinaries platform tag
function getFfmpegPlatformTag() {
  const p = process.platform;
  const a = process.arch;
  if (p === 'win32') return a === 'ia32' ? 'windows-32' : 'windows-64';
  if (p === 'darwin') return 'osx-64';
  if (p === 'linux') {
    if (a === 'arm64') return 'linux-arm-64';
    if (a === 'arm') return 'linux-armhf';
    return 'linux-64';
  }
  return 'windows-64';
}

// Helper: Get ffmpeg URL
function getFfmpegDownloadUrl() {
  return new Promise((resolve) => {
    const tag = getFfmpegPlatformTag();
    const fallbackUrl = `https://github.com/ffbinaries/ffbinaries-prebuilt/releases/download/v6.1/ffmpeg-6.1-${tag === 'osx-64' ? 'osx-64' : tag === 'windows-64' ? 'win-64' : tag === 'windows-32' ? 'win-32' : tag}.zip`;
    
    https.get('https://ffbinaries.com/api/v1/version/latest', { headers: { 'User-Agent': 'WavesConverter' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const url = json?.bin?.[tag]?.ffmpeg;
          if (url) resolve(url);
          else resolve(fallbackUrl);
        } catch (_) {
          resolve(fallbackUrl);
        }
      });
    }).on('error', () => {
      resolve(fallbackUrl);
    });
  });
}

// Helper: Download file following redirects
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    
    function get(fileUrl) {
      https.get(fileUrl, { headers: { 'User-Agent': 'WavesConverter' } }, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          get(response.headers.location);
          return;
        }
        if (response.statusCode !== 200) {
          reject(new Error(`Failed to download: Status ${response.statusCode}`));
          return;
        }
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      }).on('error', (err) => {
        try { fs.unlinkSync(dest); } catch (_) {}
        reject(err);
      });
    }
    
    get(url);
  });
}

// Helper: Extract Zip
function extractZip(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    const isWin = process.platform === 'win32';
    if (isWin) {
      const cmd = `powershell.exe -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force"`;
      exec(cmd, (err) => {
        if (err) reject(err);
        else resolve();
      });
    } else {
      const cmd = `unzip -o "${zipPath}" -d "${destDir}"`;
      exec(cmd, (err) => {
        if (err) reject(err);
        else resolve();
      });
    }
  });
}

// Helper: Find File Recursively
function findFileRecursively(dir, fileName) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      const found = findFileRecursively(fullPath, fileName);
      if (found) return found;
    } else if (file.toLowerCase() === fileName.toLowerCase()) {
      return fullPath;
    }
  }
  return null;
}

// Helper: Clean nested folders in bin
function cleanupExtractedFolders(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      try {
        fs.rmSync(fullPath, { recursive: true, force: true });
      } catch (_) {}
    }
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1300, height: 860, minWidth: 920, minHeight: 660,
    frame: false, transparent: true, backgroundColor: '#00000000',
    vibrancy: 'under-window', visualEffectState: 'active',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
    title: 'WavesConverter', show: false,
  });
  mainWindow.loadFile('index.html');
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.on('did-finish-load', flushPendingDeepLink);
  mainWindow.on('maximize',   () => mainWindow.webContents.send('window-state', 'maximized'));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window-state', 'normal'));
  
  // Close to tray logic
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      return false;
    }
  });
}

function createTray() {
  const iconPath = path.join(__dirname, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
  if (!fs.existsSync(iconPath)) return;
  
  tray = new Tray(iconPath);
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Pokaż WavesConverter', click: () => { showAndCheckClipboard(); } },
    { label: 'Minimalizuj do zasobnika', click: () => { mainWindow?.hide(); } },
    { type: 'separator' },
    { label: 'Zakończ', click: () => { isQuitting = true; app.quit(); } }
  ]);
  
  tray.setToolTip('WavesConverter');
  tray.setContextMenu(contextMenu);
  
  tray.on('click', () => {
    if (mainWindow?.isVisible()) {
      mainWindow.hide();
    } else {
      showAndCheckClipboard();
    }
  });
}

function registerGlobalShortcut() {
  // Alt+Shift+W is a safe global shortcut combination
  globalShortcut.register('Alt+Shift+W', () => {
    if (mainWindow) {
      if (mainWindow.isVisible() && mainWindow.isFocused()) {
        mainWindow.hide();
      } else {
        showAndCheckClipboard();
      }
    }
  });
}

function showAndCheckClipboard() {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
    const text = clipboard.readText();
    mainWindow.webContents.send('clipboard-search-trigger', text);
  }
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_, argv) => {
    const link = engine.findDeepLinkInArgv(argv);
    if (link) handleDeepLinkUrl(link);
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.on('open-url', (event, url) => {
    event.preventDefault();
    handleDeepLinkUrl(url);
  });

  app.whenReady().then(async () => {
    syncEngineUserData();
    registerProtocol();

    const startupLink = engine.findDeepLinkInArgv(process.argv);
    if (startupLink) handleDeepLinkUrl(startupLink);

    ytDlpPath = findYtDlp();
    if (!ytDlpPath) {
      try {
        ytDlpPath = await engine.ensureYtDlp();
      } catch (e) { console.error('yt-dlp download failed on startup:', e.message); }
    }
    createWindow();
    createTray();
    registerGlobalShortcut();
    setupAutoUpdater();
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
  });

  app.on('window-all-closed', () => {
    // Keep running in system tray
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      mainWindow?.show();
    }
  });
}

function setupAutoUpdater() {
  if (!app.isPackaged) return;
  try {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('checking-for-update', () => mainWindow?.webContents.send('update-status', { type: 'checking' }));
    autoUpdater.on('update-available', info => mainWindow?.webContents.send('update-status', { type: 'available', version: info.version }));
    autoUpdater.on('update-not-available', () => mainWindow?.webContents.send('update-status', { type: 'latest' }));
    autoUpdater.on('download-progress', p => mainWindow?.webContents.send('update-status', { type: 'downloading', percent: Math.round(p.percent) }));
    autoUpdater.on('update-downloaded', info => mainWindow?.webContents.send('update-status', { type: 'ready', version: info.version }));
    autoUpdater.on('error', err => mainWindow?.webContents.send('update-status', { type: 'error', message: err.message }));
    autoUpdater.checkForUpdatesAndNotify();
  } catch (e) { console.error('Updater error:', e.message); }
}

ipcMain.on('install-update', () => { if (app.isPackaged) try { require('electron-updater').autoUpdater.quitAndInstall(); } catch (_) {} });
ipcMain.handle('check-update', async () => { if (!app.isPackaged) return { type: 'dev' }; try { await require('electron-updater').autoUpdater.checkForUpdates(); } catch (e) { return { type: 'error', message: e.message }; } });
ipcMain.handle('get-version', () => app.getVersion());

ipcMain.on('window-minimize', () => mainWindow.minimize());
ipcMain.on('window-maximize', () => mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize());
ipcMain.on('window-close', () => mainWindow.close());

ipcMain.handle('choose-folder', async () => { const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] }); return r.canceled ? null : r.filePaths[0]; });
ipcMain.handle('choose-file', async () => { const r = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: [{ name: 'Media', extensions: ['mp4','mkv','avi','mov','webm','mp3','wav','flac','aac','m4a','ogg'] }] }); return r.canceled ? null : r.filePaths[0]; });
ipcMain.on('open-folder', (_, p) => shell.openPath(p));
ipcMain.handle('get-default-dir', () => path.join(os.homedir(), 'Downloads'));
ipcMain.handle('check-ytdlp', () => !!findYtDlp());
ipcMain.handle('check-ffmpeg', () => !!findFfmpeg());

// Tool Installer IPC handler
ipcMain.handle('install-tools', async (event) => {
  const binDir = path.join(app.getPath('userData'), 'bin');
  if (!fs.existsSync(binDir)) fs.mkdirSync(binDir, { recursive: true });
  const isWin = process.platform === 'win32';

  // 1. Download yt-dlp
  try {
    event.sender.send('install-status', { status: 'downloading-ytdlp', progress: 10, message: 'Downloading yt-dlp...' });
    const YTDlpWrap = require('yt-dlp-wrap').default || require('yt-dlp-wrap');
    const binFile = path.join(binDir, isWin ? 'yt-dlp.exe' : 'yt-dlp');
    await YTDlpWrap.downloadFromGithub(binFile);
    if (!isWin) fs.chmodSync(binFile, 0o755);
    ytDlpPath = binFile;
  } catch (e) {
    console.error('yt-dlp install failed:', e);
    throw new Error('Failed to install yt-dlp: ' + e.message);
  }

  // 2. Download ffmpeg
  try {
    event.sender.send('install-status', { status: 'downloading-ffmpeg', progress: 40, message: 'Downloading ffmpeg...' });
    const ffmpegUrl = await getFfmpegDownloadUrl();
    const zipFile = path.join(binDir, 'ffmpeg.zip');
    await downloadFile(ffmpegUrl, zipFile);

    event.sender.send('install-status', { status: 'extracting-ffmpeg', progress: 80, message: 'Extracting ffmpeg...' });
    await extractZip(zipFile, binDir);
    try { fs.unlinkSync(zipFile); } catch (_) {}

    const ffmpegExeName = isWin ? 'ffmpeg.exe' : 'ffmpeg';
    const foundFfmpeg = findFileRecursively(binDir, ffmpegExeName);
    if (foundFfmpeg && foundFfmpeg !== path.join(binDir, ffmpegExeName)) {
      fs.renameSync(foundFfmpeg, path.join(binDir, ffmpegExeName));
    }

    const finalFfmpegPath = path.join(binDir, ffmpegExeName);
    if (!fs.existsSync(finalFfmpegPath)) {
      throw new Error('ffmpeg binary not found in extracted files');
    }

    if (!isWin) fs.chmodSync(finalFfmpegPath, 0o755);
    cleanupExtractedFolders(binDir);
  } catch (e) {
    console.error('ffmpeg install failed:', e);
    throw new Error('Failed to install ffmpeg: ' + e.message);
  }

  event.sender.send('install-status', { status: 'success', progress: 100, message: 'Tools installed successfully!' });
  return { success: true };
});

ipcMain.handle('fetch-info', async (_, url, options) => engine.fetchInfo(url, options || {}));
ipcMain.handle('is-supported-url', (_, url) => engine.isSupportedMediaUrl(url));
ipcMain.handle('get-url-platform', (_, url) => engine.getMediaPlatform(url));
ipcMain.handle('choose-cookies-file', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Cookies', extensions: ['txt'] }],
  });
  return r.canceled ? null : r.filePaths[0];
});

const cliInstall = require('./lib/cli-install');

ipcMain.handle('check-cli', async () => cliInstall.checkCliEnvironment());

ipcMain.handle('install-cli', async (event) => {
  const env = await cliInstall.checkCliEnvironment();
  if (!env.node) {
    throw new Error('Node.js nie jest zainstalowany. Pobierz Node 18+ z nodejs.org i spróbuj ponownie.');
  }
  if (!env.npm) {
    throw new Error('npm nie jest dostępny. Zainstaluj Node.js (zawiera npm) i spróbuj ponownie.');
  }
  return cliInstall.installCliGlobal(data => {
    event.sender.send('cli-install-status', data);
  });
});

ipcMain.handle('copy-text', (_, text) => {
  clipboard.writeText(text || '');
  return true;
});

ipcMain.handle('open-external', (_, url) => shell.openExternal(url));

const active = new Map();

ipcMain.handle('start-download', (_, job) => {
  if (!findYtDlp()) return Promise.reject(new Error('yt-dlp not found. Please click the "Install / Repair Tools" button in Settings.'));
  const { id } = job;
  return engine.runDownload(job, {
    onSpawn: proc => active.set(id, proc),
    onProgress: (progress, line) => {
      mainWindow?.webContents.send('download-progress', { id, progress, line });
      mainWindow?.webContents.send('download-log', { id, line });
    },
    onLog: line => mainWindow?.webContents.send('download-log', { id, line }),
  }).finally(() => active.delete(id));
});

ipcMain.on('cancel-download', (_, id) => { const p = active.get(id); if (p) { p.kill('SIGTERM'); active.delete(id); } });

ipcMain.handle('convert-file', (_, job) => {
  if (!findFfmpeg()) return Promise.reject(new Error('ffmpeg not found. Please click the "Install / Repair Tools" button in Settings.'));
  const { id } = job;
  return engine.runConvert(job, {
    onSpawn: proc => active.set(id, proc),
    onProgress: time => mainWindow?.webContents.send('convert-progress', { id, time }),
  }).finally(() => active.delete(id));
});

// Expose download-thumbnail handler
ipcMain.handle('download-thumbnail', async (_, { url, dest }) => {
  return downloadFile(url, dest);
});

// Wi-Fi Local File Sharing Server Handlers
ipcMain.handle('start-share-server', async (event, { filePath, fileName }) => {
  if (!fs.existsSync(filePath)) {
    throw new Error('Plik nie istnieje lub został usunięty z dysku.');
  }

  if (shareServer) {
    try {
      shareServer.close();
    } catch (_) {}
    shareServer = null;
  }

  // Get local IP address
  const networkInterfaces = os.networkInterfaces();
  let localIp = '127.0.0.1';
  for (const name of Object.keys(networkInterfaces)) {
    for (const iface of networkInterfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        localIp = iface.address;
        break;
      }
    }
    if (localIp !== '127.0.0.1') break;
  }

  return new Promise((resolve, reject) => {
    shareServer = http.createServer((req, res) => {
      if (fs.existsSync(filePath)) {
        const stat = fs.statSync(filePath);
        const safeFileName = fileName.replace(/["\\]/g, ''); // strip quotes and backslashes
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Length': stat.size,
          'Content-Disposition': `attachment; filename="${encodeURIComponent(safeFileName)}"; filename*=UTF-8''${encodeURIComponent(safeFileName)}`
        });
        const readStream = fs.createReadStream(filePath);
        readStream.pipe(res);
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Plik nie istnieje lub został usunięty.');
      }
    });

    shareServer.listen(0, localIp, async () => {
      const port = shareServer.address().port;
      const shareUrl = `http://${localIp}:${port}/download`;
      try {
        const qrDataUrl = await QRCode.toDataURL(shareUrl, {
          color: {
            dark: '#1e0b36',
            light: '#f0e6ff'
          },
          margin: 2
        });
        resolve({ shareUrl, qrDataUrl });
      } catch (err) {
        reject(err);
      }
    });

    shareServer.on('error', (err) => {
      reject(err);
    });
  });
});

ipcMain.handle('stop-share-server', async () => {
  if (shareServer) {
    shareServer.close();
    shareServer = null;
  }
  return { success: true };
});

} // startElectronApp
