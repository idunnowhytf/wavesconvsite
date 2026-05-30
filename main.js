const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const os = require('os');

let mainWindow;
let ytDlpPath;

function findYtDlp() {
  const candidates = [
    path.join(__dirname, 'yt-dlp-bin', 'yt-dlp'),
    '/opt/homebrew/bin/yt-dlp',
    '/usr/local/bin/yt-dlp',
    '/usr/bin/yt-dlp',
    path.join(__dirname, 'node_modules', 'yt-dlp-wrap', 'bin', 'yt-dlp'),
  ];
  return candidates.find(c => fs.existsSync(c)) || null;
}

function findFfmpeg() {
  try {
    const i = require('@ffmpeg-installer/ffmpeg');
    if (fs.existsSync(i.path)) return i.path;
  } catch (_) {}
  return ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg'].find(c => fs.existsSync(c)) || null;
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
}

app.whenReady().then(async () => {
  ytDlpPath = findYtDlp();
  if (!ytDlpPath) {
    try {
      const YTDlpWrap = require('yt-dlp-wrap').default || require('yt-dlp-wrap');
      const binDir = path.join(__dirname, 'yt-dlp-bin');
      if (!fs.existsSync(binDir)) fs.mkdirSync(binDir, { recursive: true });
      const binFile = path.join(binDir, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
      await YTDlpWrap.downloadFromGithub(binFile);
      ytDlpPath = binFile;
    } catch (e) { console.error('yt-dlp download failed:', e.message); }
  }
  createWindow();
  setupAutoUpdater();
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

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
ipcMain.handle('check-ytdlp', () => !!ytDlpPath);
ipcMain.handle('check-ffmpeg', () => !!findFfmpeg());

ipcMain.handle('fetch-info', async (_, url) => {
  if (!ytDlpPath) throw new Error('yt-dlp not found. Install with: brew install yt-dlp');
  return new Promise((resolve, reject) => {
    const args = ['--dump-json', '--flat-playlist', '--no-warnings', url];
    let out = '', err = '';
    const proc = spawn(ytDlpPath, args);
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
  const ffmpeg = findFfmpeg();
  if (!ytDlpPath) return reject(new Error('yt-dlp not found'));
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
    args.push('-f', h ? `bestvideo[height<=${h}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${h}]+bestaudio/best[height<=${h}]/best` : 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best');
    args.push('--merge-output-format', outputFormat || 'mp4');
    if (bitrate) args.push('--postprocessor-args', `ffmpeg:-b:v ${bitrate}`);
  }
  args.push('-o', outTpl, url);
  const proc = spawn(ytDlpPath, args);
  active.set(id, proc);
  proc.stdout.on('data', d => {
    const line = d.toString().trim();
    const m = line.match(/(\d+\.?\d*)%/);
    if (m) mainWindow.webContents.send('download-progress', { id, progress: parseFloat(m[1]), line });
    mainWindow.webContents.send('download-log', { id, line });
  });
  proc.stderr.on('data', d => mainWindow.webContents.send('download-log', { id, line: d.toString().trim() }));
  proc.on('close', code => { active.delete(id); code === 0 ? resolve({ success: true }) : reject(new Error(`Exit ${code}`)); });
  proc.on('error', err => { active.delete(id); reject(err); });
}));

ipcMain.on('cancel-download', (_, id) => { const p = active.get(id); if (p) { p.kill('SIGTERM'); active.delete(id); } });

ipcMain.handle('convert-file', (_, job) => new Promise((resolve, reject) => {
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) return reject(new Error('ffmpeg not found. Install: brew install ffmpeg'));
  const { id, inputPath, outputPath, bitrate, videoBitrate, resolution } = job;
  const args = ['-y', '-i', inputPath];
  if (resolution && resolution !== 'original') args.push('-vf', `scale=-2:${resolution.replace('p', '')}`);
  if (videoBitrate) args.push('-b:v', videoBitrate);
  if (bitrate) args.push('-b:a', bitrate);
  args.push(outputPath);
  const proc = spawn(ffmpeg, args);
  active.set(id, proc);
  let errOut = '';
  proc.stderr.on('data', d => { const line = d.toString(); errOut += line; const t = line.match(/time=(\d+:\d+:\d+)/); if (t) mainWindow.webContents.send('convert-progress', { id, time: t[1] }); });
  proc.on('close', code => { active.delete(id); code === 0 ? resolve({ success: true }) : reject(new Error(errOut.slice(-300))); });
}));
