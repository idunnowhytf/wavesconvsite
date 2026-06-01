const { app, BrowserWindow, ipcMain, dialog, shell, Menu, Tray, globalShortcut, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, exec } = require('child_process');
const os = require('os');
const https = require('https');
const http = require('http');
const QRCode = require('qrcode');

let mainWindow;
let ytDlpPath;
let tray = null;
let shareServer = null;
let isQuitting = false;

function findYtDlp() {
  const isWin = process.platform === 'win32';
  const name = isWin ? 'yt-dlp.exe' : 'yt-dlp';
  const userBin = app.isReady() ? path.join(app.getPath('userData'), 'bin', name) : null;
  const candidates = [
    userBin,
    path.join(__dirname, 'yt-dlp-bin', name),
    path.join(__dirname, 'node_modules', 'yt-dlp-wrap', 'bin', name),
    isWin ? 'C:\\ProgramData\\chocolatey\\bin\\yt-dlp.exe' : null,
    isWin ? 'C:\\scoop\\shims\\yt-dlp.exe' : null,
    '/opt/homebrew/bin/yt-dlp',
    '/usr/local/bin/yt-dlp',
    '/usr/bin/yt-dlp',
  ].filter(Boolean);
  return candidates.find(c => fs.existsSync(c)) || null;
}

function findFfmpeg() {
  const isWin = process.platform === 'win32';
  const name = isWin ? 'ffmpeg.exe' : 'ffmpeg';
  const userBin = app.isReady() ? path.join(app.getPath('userData'), 'bin', name) : null;
  
  if (userBin && fs.existsSync(userBin)) return userBin;

  try {
    const i = require('@ffmpeg-installer/ffmpeg');
    let p = i.path;
    if (app.isPackaged) {
      p = p.replace('app.asar', 'app.asar.unpacked');
    }
    if (fs.existsSync(p)) return p;
  } catch (_) {}

  const candidates = [
    isWin ? 'C:\\ProgramData\\chocolatey\\bin\\ffmpeg.exe' : null,
    isWin ? 'C:\\scoop\\shims\\ffmpeg.exe' : null,
    '/opt/homebrew/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
    '/usr/bin/ffmpeg',
  ].filter(Boolean);
  
  return candidates.find(c => fs.existsSync(c)) || null;
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

app.whenReady().then(async () => {
  ytDlpPath = findYtDlp();
  if (!ytDlpPath) {
    try {
      const YTDlpWrap = require('yt-dlp-wrap').default || require('yt-dlp-wrap');
      const binDir = path.join(app.getPath('userData'), 'bin');
      if (!fs.existsSync(binDir)) fs.mkdirSync(binDir, { recursive: true });
      const binFile = path.join(binDir, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
      await YTDlpWrap.downloadFromGithub(binFile);
      if (process.platform !== 'win32') fs.chmodSync(binFile, 0o755);
      ytDlpPath = binFile;
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

ipcMain.handle('fetch-info', async (_, url) => {
  const activeYtDlp = findYtDlp();
  if (!activeYtDlp) throw new Error('yt-dlp not found. Please click the "Install / Repair Tools" button in Settings.');
  return new Promise((resolve, reject) => {
    const args = ['--dump-json', '--flat-playlist', '--no-warnings', url];
    let out = '', err = '';
    const proc = spawn(activeYtDlp, args);
    proc.stdout.on('data', d => out += d);
    proc.stderr.on('data', d => err += d);
    proc.on('close', () => {
      if (!out.trim()) return reject(new Error(err.slice(0, 300) || 'No info returned'));
      try { resolve(out.trim().split('\n').filter(Boolean).map(l => JSON.parse(l))); }
      catch (e) { reject(new Error('Failed to parse video info')); }
    });
  });
});

const active = new Map();

ipcMain.handle('start-download', (_, job) => new Promise((resolve, reject) => {
  const activeYtDlp = findYtDlp();
  const ffmpeg = findFfmpeg();
  if (!activeYtDlp) return reject(new Error('yt-dlp not found. Please click the "Install / Repair Tools" button in Settings.'));
  const { id, url, outputFormat, quality, bitrate, outputDir, filename, audioOnly } = job;
  const safeName = (filename || '%(title)s').replace(/[<>:"/\\|?*]/g, '_');
  const outTpl = path.join(outputDir, safeName + '.%(ext)s');
  const args = ['--no-warnings', '--newline'];
  if (ffmpeg) args.push('--ffmpeg-location', path.dirname(ffmpeg));
  if (audioOnly) {
    args.push('-x', '--audio-format', outputFormat || 'mp3');
    if (bitrate) args.push('--audio-quality', bitrate.replace('k', '') + 'K');
  } else {
    const h = quality && quality !== 'best' ? quality.replace('p', '') : null;
    args.push('-f', h ? `bestvideo[height<=${h}]+bestaudio/best[height<=${h}]/best` : 'bestvideo+bestaudio/best');
    args.push('--merge-output-format', outputFormat || 'mp4');
    if (!outputFormat || outputFormat === 'mp4') {
      args.push('--postprocessor-args', 'Merger:-c:a aac');
    }
    if (bitrate) args.push('--postprocessor-args', `ffmpeg:-b:v ${bitrate}`);
  }
  args.push('-o', outTpl, url);
  
  let detectedPath = '';
  const proc = spawn(activeYtDlp, args);
  active.set(id, proc);
  
  proc.stdout.on('data', d => {
    const line = d.toString().trim();
    const mDest = line.match(/Destination:\s+(.+)/i) || 
                  line.match(/Merging formats into\s+"([^"]+)"/i) ||
                  line.match(/Merging formats into\s+(.+)/i) ||
                  line.match(/\[download\]\s+(.+?)\s+has already been downloaded/i);
    if (mDest) {
      detectedPath = mDest[1].trim();
    }
    const m = line.match(/(\d+\.?\d*)%/);
    if (m) mainWindow.webContents.send('download-progress', { id, progress: parseFloat(m[1]), line });
    mainWindow.webContents.send('download-log', { id, line });
  });
  
  proc.stderr.on('data', d => mainWindow.webContents.send('download-log', { id, line: d.toString().trim() }));
  
  proc.on('close', code => {
    active.delete(id);
    if (code === 0) {
      let fileSize = 0;
      let finalPath = '';
      try {
        if (detectedPath && fs.existsSync(detectedPath)) {
          finalPath = detectedPath;
        } else if (detectedPath && fs.existsSync(path.resolve(outputDir, detectedPath))) {
          finalPath = path.resolve(outputDir, detectedPath);
        } else {
          // Fallback 1: match by cleanTitle
          const cleanTitle = (job.title || '').replace(/[<>:"/\\|?*]/g, '_');
          const files = fs.readdirSync(outputDir);
          const match = files.find(f => f.toLowerCase().includes(cleanTitle.toLowerCase()));
          if (match) {
            finalPath = path.join(outputDir, match);
          } else {
            // Fallback 2: search for most recently modified file in outputDir in last 15 seconds
            const now = Date.now();
            let bestFile = null;
            let bestMtime = 0;
            for (const f of files) {
              const fp = path.join(outputDir, f);
              try {
                const stat = fs.statSync(fp);
                if (stat.isFile() && (now - stat.mtimeMs < 15000) && stat.mtimeMs > bestMtime) {
                  bestMtime = stat.mtimeMs;
                  bestFile = fp;
                }
              } catch (_) {}
            }
            if (bestFile) finalPath = bestFile;
          }
        }
        
        if (finalPath && fs.existsSync(finalPath)) {
          fileSize = fs.statSync(finalPath).size;
        }
      } catch (_) {}
      resolve({ success: true, size: fileSize, path: finalPath });
    } else {
      reject(new Error(`Exit ${code}`));
    }
  });
  proc.on('error', err => { active.delete(id); reject(err); });
}));

ipcMain.on('cancel-download', (_, id) => { const p = active.get(id); if (p) { p.kill('SIGTERM'); active.delete(id); } });

ipcMain.handle('convert-file', (_, job) => new Promise((resolve, reject) => {
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) return reject(new Error('ffmpeg not found. Please click the "Install / Repair Tools" button in Settings.'));
  const { id, inputPath, outputPath, bitrate, videoBitrate, resolution, gifStart, gifDuration } = job;
  const ext = outputPath.split('.').pop().toLowerCase();
  const isGif = ext === 'gif';
  
  const args = ['-y'];
  if (isGif) {
    if (gifStart) args.push('-ss', gifStart);
    if (gifDuration) args.push('-t', String(gifDuration));
  }
  args.push('-i', inputPath);
  
  if (isGif) {
    args.push('-vf', 'fps=15,scale=480:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse');
  } else {
    if (resolution && resolution !== 'original') {
      args.push('-vf', `scale=-2:${resolution.replace('p', '')}`);
    }
    const isVideo = ['mp4', 'mkv', 'mov', 'avi', 'webm'].includes(ext);
    if (isVideo) {
      if (ext === 'webm') {
        args.push('-c:v', 'libvpx-vp9');
        if (videoBitrate) {
          args.push('-b:v', videoBitrate);
        } else {
          args.push('-crf', '28', '-b:v', '0');
        }
        args.push('-c:a', 'libopus');
        if (bitrate) args.push('-b:a', bitrate);
        else args.push('-b:a', '128k');
      } else {
        args.push('-c:v', 'libx264', '-preset', 'fast');
        if (videoBitrate) {
          args.push('-b:v', videoBitrate);
        } else {
          args.push('-crf', '18');
        }
        args.push('-c:a', 'aac');
        if (bitrate) args.push('-b:a', bitrate);
        else args.push('-b:a', '192k');
      }
    } else {
      if (ext === 'mp3') {
        args.push('-c:a', 'libmp3lame');
        if (bitrate) args.push('-b:a', bitrate);
        else args.push('-b:a', '256k');
      } else if (ext === 'wav') {
        args.push('-c:a', 'pcm_s16le');
      } else if (ext === 'flac') {
        args.push('-c:a', 'flac');
      } else if (ext === 'aac' || ext === 'm4a') {
        args.push('-c:a', 'aac');
        if (bitrate) args.push('-b:a', bitrate);
        else args.push('-b:a', '256k');
      } else if (ext === 'ogg') {
        args.push('-c:a', 'libvorbis');
        if (bitrate) args.push('-b:a', bitrate);
        else args.push('-b:a', '192k');
      }
    }
  }
  
  args.push(outputPath);
  const proc = spawn(ffmpeg, args);
  active.set(id, proc);
  let errOut = '';
  proc.stderr.on('data', d => {
    const line = d.toString();
    errOut += line;
    const t = line.match(/time=(\d+:\d+:\d+)/);
    if (t) mainWindow.webContents.send('convert-progress', { id, time: t[1] });
  });
  proc.on('close', code => {
    active.delete(id);
    code === 0 ? resolve({ success: true }) : reject(new Error(errOut.slice(-300)));
  });
  proc.on('error', err => {
    active.delete(id);
    reject(err);
  });
}));

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
