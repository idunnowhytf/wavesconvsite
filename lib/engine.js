const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const { spawn, exec } = require('child_process');

const APP_FOLDER = 'waves-converter';

function getUserDataDir() {
  if (process.env.WAVESCONVERTER_USER_DATA) return process.env.WAVESCONVERTER_USER_DATA;
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), APP_FOLDER);
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', APP_FOLDER);
  }
  return path.join(os.homedir(), '.config', APP_FOLDER);
}

function getBinDir() {
  return path.join(getUserDataDir(), 'bin');
}

function findYtDlp() {
  const isWin = process.platform === 'win32';
  const name = isWin ? 'yt-dlp.exe' : 'yt-dlp';
  const userBin = path.join(getBinDir(), name);
  const root = path.join(__dirname, '..');
  const candidates = [
    userBin,
    path.join(root, 'yt-dlp-bin', name),
    path.join(root, 'node_modules', 'yt-dlp-wrap', 'bin', name),
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
  const userBin = path.join(getBinDir(), name);
  if (fs.existsSync(userBin)) return userBin;

  try {
    const i = require('@ffmpeg-installer/ffmpeg');
    let p = i.path;
    if (process.env.ELECTRON_RUN_AS_NODE || (process.mainModule && process.mainModule.filename.includes('app.asar'))) {
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

async function ensureYtDlp(onStatus) {
  let bin = findYtDlp();
  if (bin) return bin;
  const binDir = getBinDir();
  if (!fs.existsSync(binDir)) fs.mkdirSync(binDir, { recursive: true });
  const isWin = process.platform === 'win32';
  const binFile = path.join(binDir, isWin ? 'yt-dlp.exe' : 'yt-dlp');
  if (onStatus) onStatus('Pobieranie yt-dlp…');
  const YTDlpWrap = require('yt-dlp-wrap').default || require('yt-dlp-wrap');
  await YTDlpWrap.downloadFromGithub(binFile);
  if (!isWin) fs.chmodSync(binFile, 0o755);
  return binFile;
}

function fetchInfo(url) {
  const activeYtDlp = findYtDlp();
  if (!activeYtDlp) {
    return Promise.reject(new Error('yt-dlp nie znaleziony. Uruchom: wavesconv tools install'));
  }
  return new Promise((resolve, reject) => {
    const args = ['--dump-json', '--flat-playlist', '--no-warnings', url];
    let out = '';
    let err = '';
    const proc = spawn(activeYtDlp, args);
    proc.stdout.on('data', d => { out += d; });
    proc.stderr.on('data', d => { err += d; });
    proc.on('close', () => {
      if (!out.trim()) return reject(new Error(err.slice(0, 300) || 'Brak danych z yt-dlp'));
      try {
        resolve(out.trim().split('\n').filter(Boolean).map(l => JSON.parse(l)));
      } catch {
        reject(new Error('Nie udało się odczytać metadanych'));
      }
    });
    proc.on('error', e => reject(e));
  });
}

function buildDownloadArgs(job) {
  const ffmpeg = findFfmpeg();
  const { url, outputFormat, quality, bitrate, outputDir, filename, audioOnly } = job;
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
  return args;
}

function resolveDownloadedPath(job, outputDir, detectedPath) {
  let finalPath = '';
  try {
    if (detectedPath && fs.existsSync(detectedPath)) {
      finalPath = detectedPath;
    } else if (detectedPath && fs.existsSync(path.resolve(outputDir, detectedPath))) {
      finalPath = path.resolve(outputDir, detectedPath);
    } else {
      const cleanTitle = (job.title || '').replace(/[<>:"/\\|?*]/g, '_');
      const files = fs.readdirSync(outputDir);
      const match = files.find(f => f.toLowerCase().includes(cleanTitle.toLowerCase()));
      if (match) {
        finalPath = path.join(outputDir, match);
      } else {
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
  } catch (_) {}
  return finalPath;
}

function runDownload(job, callbacks = {}) {
  const activeYtDlp = findYtDlp();
  if (!activeYtDlp) {
    return Promise.reject(new Error('yt-dlp nie znaleziony. Uruchom: wavesconv tools install'));
  }
  const { onProgress, onLog } = callbacks;
  const args = buildDownloadArgs(job);
  let detectedPath = '';

  return new Promise((resolve, reject) => {
    const proc = spawn(activeYtDlp, args);
    if (callbacks.onSpawn) callbacks.onSpawn(proc);

    proc.stdout.on('data', d => {
      const line = d.toString().trim();
      const mDest = line.match(/Destination:\s+(.+)/i) ||
        line.match(/Merging formats into\s+"([^"]+)"/i) ||
        line.match(/Merging formats into\s+(.+)/i) ||
        line.match(/\[download\]\s+(.+?)\s+has already been downloaded/i);
      if (mDest) detectedPath = mDest[1].trim();
      const m = line.match(/(\d+\.?\d*)%/);
      if (m && onProgress) onProgress(parseFloat(m[1]), line);
      if (onLog) onLog(line);
    });

    proc.stderr.on('data', d => {
      if (onLog) onLog(d.toString().trim());
    });

    proc.on('close', code => {
      if (code === 0) {
        const finalPath = resolveDownloadedPath(job, job.outputDir, detectedPath);
        let fileSize = 0;
        if (finalPath && fs.existsSync(finalPath)) {
          fileSize = fs.statSync(finalPath).size;
        }
        resolve({ success: true, size: fileSize, path: finalPath });
      } else {
        reject(new Error(`yt-dlp zakończył się kodem ${code}`));
      }
    });
    proc.on('error', reject);
  });
}

function runConvert(job, callbacks = {}) {
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) {
    return Promise.reject(new Error('ffmpeg nie znaleziony. Uruchom: wavesconv tools install'));
  }
  const { inputPath, outputPath, bitrate, videoBitrate, resolution, gifStart, gifDuration } = job;
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
        if (videoBitrate) args.push('-b:v', videoBitrate);
        else args.push('-crf', '28', '-b:v', '0');
        args.push('-c:a', 'libopus');
        if (bitrate) args.push('-b:a', bitrate);
        else args.push('-b:a', '128k');
      } else {
        args.push('-c:v', 'libx264', '-preset', 'fast');
        if (videoBitrate) args.push('-b:v', videoBitrate);
        else args.push('-crf', '18');
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

  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpeg, args);
    if (callbacks.onSpawn) callbacks.onSpawn(proc);
    let errOut = '';
    proc.stderr.on('data', d => {
      const line = d.toString();
      errOut += line;
      const t = line.match(/time=(\d+:\d+:\d+)/);
      if (t && callbacks.onProgress) callbacks.onProgress(t[1]);
    });
    proc.on('close', code => {
      code === 0 ? resolve({ success: true }) : reject(new Error(errOut.slice(-300) || `ffmpeg kod ${code}`));
    });
    proc.on('error', reject);
  });
}

function isYouTubeUrl(str) {
  return /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/i.test((str || '').trim());
}

function parseDeepLink(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed.toLowerCase().startsWith('wavesconverter://')) return null;

  try {
    const u = new URL(trimmed);
    const action = (u.hostname || 'open').toLowerCase();
    const params = u.searchParams;

    let targetUrl = params.get('url') || params.get('link');
    if (!targetUrl) {
      let pathPart = u.pathname.replace(/^\//, '');
      if (pathPart) {
        try { pathPart = decodeURIComponent(pathPart); } catch (_) {}
        if (/^https?:\/\//i.test(pathPart)) targetUrl = pathPart;
      }
    }
    if (targetUrl) {
      try { targetUrl = decodeURIComponent(targetUrl); } catch (_) {}
    }

    return {
      action,
      url: targetUrl || null,
      file: params.get('file') || null,
      autoQueue: action === 'queue' || params.get('queue') === '1',
      autoStart: params.get('start') === '1',
      format: params.get('format') || null,
      quality: params.get('quality') || params.get('q') || null,
      audioOnly: params.get('audio') === '1' || params.get('type') === 'audio',
      bitrate: params.get('bitrate') || null,
    };
  } catch {
    return null;
  }
}

function findDeepLinkInArgv(argv) {
  return (argv || process.argv).find(a => typeof a === 'string' && a.toLowerCase().startsWith('wavesconverter://')) || null;
}

function getDefaultDownloadDir() {
  return path.join(os.homedir(), 'Downloads');
}

module.exports = {
  getUserDataDir,
  getBinDir,
  getDefaultDownloadDir,
  findYtDlp,
  findFfmpeg,
  ensureYtDlp,
  fetchInfo,
  buildDownloadArgs,
  runDownload,
  runConvert,
  isYouTubeUrl,
  parseDeepLink,
  findDeepLinkInArgv,
};
