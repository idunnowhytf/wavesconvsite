#!/usr/bin/env node
'use strict';

const path = require('path');
const fs = require('fs');
const engine = require('./lib/engine');
const ui = require('./lib/cli-ui');
const { runInteractive } = require('./lib/cli-interactive');

const VERSION = require('./package.json').version;

function parseArgs(argv) {
  const args = [...argv];
  const positional = [];
  const flags = {};

  while (args.length) {
    const a = args[0];
    if (a === '--') {
      args.shift();
      positional.push(...args);
      break;
    }
    if (a.startsWith('--')) {
      const key = a.slice(2);
      args.shift();
      if (['help', 'version', 'audio', 'plain', 'json'].includes(key)) {
        flags[key] = true;
      } else if (args.length) {
        flags[key] = args.shift();
      } else {
        flags[key] = true;
      }
    } else if (a.startsWith('-') && a.length === 2) {
      const key = a.slice(1);
      args.shift();
      const map = { o: 'output', f: 'format', q: 'quality', a: 'audio' };
      const flagKey = map[key] || key;
      if (key === 'a') flags.audio = true;
      else if (args.length) flags[flagKey] = args.shift();
    } else {
      positional.push(args.shift());
    }
  }
  return { positional, flags };
}

async function cmdToolsInstall(color) {
  const spin = new ui.Spinner('Instalacja yt-dlp', color);
  spin.start();
  try {
    await engine.ensureYtDlp(msg => spin.draw(msg));
    spin.succeed('yt-dlp zainstalowany');
  } catch (e) {
    spin.fail(e.message);
    throw e;
  }
  ui.kv(color, 'yt-dlp', engine.findYtDlp() || 'błąd', !!engine.findYtDlp());
  ui.kv(color, 'ffmpeg', engine.findFfmpeg() || 'brak (zainstaluj systemowo)', !!engine.findFfmpeg());
}

function cmdToolsStatus(color) {
  ui.printBanner(VERSION, color);
  ui.kv(color, 'yt-dlp', engine.findYtDlp() || 'BRAK', !!engine.findYtDlp());
  ui.kv(color, 'ffmpeg', engine.findFfmpeg() || 'BRAK', !!engine.findFfmpeg());
  ui.kv(color, 'userData', engine.getUserDataDir());
  console.log('');
}

async function cmdInfo(url, flags, color) {
  const spin = new ui.Spinner('Pobieranie metadanych', color);
  spin.start();
  let items;
  try {
    items = await engine.fetchInfo(url, { cookiesPath: process.env.WAVESCONVERTER_COOKIES || '' });
    spin.succeed(`${items.length} element(ów)`);
  } catch (e) {
    spin.fail(e.message);
    throw e;
  }

  if (flags.json || !color) {
    console.log(JSON.stringify(items, null, 2));
    return;
  }

  if (items.length === 1) {
    ui.printVideoCard(color, items[0]);
    return;
  }

  ui.info(color, `Playlista: ${items.length} pozycji`);
  items.slice(0, 15).forEach((item, i) => {
    const title = (item.title || item.id || '?').slice(0, 50);
    console.log(ui.c(color, ui.palette.cyan, `  ${String(i + 1).padStart(2)}. `) + title);
  });
  if (items.length > 15) {
    console.log(ui.c(color, ui.palette.dim, `  … i ${items.length - 15} więcej`));
  }
  console.log('');
}

async function cmdDownload(url, flags, color) {
  if (!engine.isSupportedMediaUrl(url)) {
    throw new Error('Nieobsługiwany URL. Użyj linku YouTube lub Instagram (post / Reel / Stories).');
  }

  const setupSpin = new ui.Spinner('Przygotowanie yt-dlp', color);
  setupSpin.start();
  try {
    await engine.ensureYtDlp(msg => setupSpin.draw(msg));
    setupSpin.succeed('Silnik gotowy');
  } catch (e) {
    setupSpin.fail(e.message);
    throw e;
  }

  const outputDir = path.resolve(flags.output || engine.getDefaultDownloadDir());
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const audioOnly = !!flags.audio || ['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg'].includes((flags.format || '').toLowerCase());
  const format = flags.format || (audioOnly ? 'mp3' : 'mp4');

  let title = 'download';
  const metaSpin = new ui.Spinner('Wczytywanie metadanych', color);
  metaSpin.start();
  try {
    const items = await engine.fetchInfo(url, { cookiesPath: process.env.WAVESCONVERTER_COOKIES || '' });
    if (items[0]) title = items[0].title || items[0].id || title;
    metaSpin.succeed(title.slice(0, 52) + (title.length > 52 ? '…' : ''));
  } catch (_) {
    metaSpin.succeed('Metadane pominięte');
  }

  const job = {
    id: 'cli-' + Date.now(),
    title,
    url,
    platform: engine.getMediaPlatform(url),
    cookiesPath: process.env.WAVESCONVERTER_COOKIES || '',
    audioOnly,
    outputFormat: format,
    quality: flags.quality || 'best',
    bitrate: flags.bitrate || '',
    outputDir,
    filename: flags.filename || '%(title)s',
  };

  ui.info(color, `Folder: ${outputDir}`);
  ui.info(color, `Format: ${format}${audioOnly ? ' (audio)' : ''} · Jakość: ${job.quality}`);
  console.log('');

  const bar = new ui.ProgressBar('Pobieranie', color);
  bar.start();

  const result = await engine.runDownload(job, {
    onProgress: (pct, line) => {
      const detail = line.replace(/\[download\]\s*/i, '').trim();
      bar.update(pct, detail);
    },
    onLog: line => {
      if (/\bERROR\b/i.test(line)) ui.warn(color, line.slice(0, 100));
    },
  });

  bar.succeed(`Zapisano · ${ui.formatBytes(result.size || 0)}`);
  if (result.path) {
    ui.success(color, result.path);
  } else {
    ui.warn(color, 'Sprawdź folder docelowy (ścieżka nie wykryta automatycznie)');
  }
  console.log('');
}

async function cmdConvert(inputPath, flags, color) {
  const ffmpeg = engine.findFfmpeg();
  if (!ffmpeg) throw new Error('ffmpeg nie znaleziony — zainstaluj ffmpeg lub użyj aplikacji desktop');

  const resolvedIn = path.resolve(inputPath);
  if (!fs.existsSync(resolvedIn)) throw new Error('Plik nie istnieje: ' + resolvedIn);

  const format = (flags.format || 'mp4').toLowerCase();
  let outputPath = flags.output ? path.resolve(flags.output) : null;

  if (!outputPath) {
    const base = path.basename(resolvedIn, path.extname(resolvedIn));
    outputPath = path.join(path.dirname(resolvedIn), base + '.' + format);
  } else if (fs.existsSync(outputPath) && fs.statSync(outputPath).isDirectory()) {
    const base = path.basename(resolvedIn, path.extname(resolvedIn));
    outputPath = path.join(outputPath, base + '.' + format);
  }

  const job = {
    id: 'cli-convert-' + Date.now(),
    inputPath: resolvedIn,
    outputPath,
    bitrate: flags.bitrate || '',
    videoBitrate: flags['video-bitrate'] || '',
    resolution: flags.quality || 'original',
    gifStart: flags['gif-start'] || '00:00:00',
    gifDuration: flags['gif-duration'] || 5,
  };

  ui.info(color, `Wejście: ${path.basename(resolvedIn)}`);
  ui.info(color, `Wyjście: ${outputPath}`);

  const spin = new ui.Spinner('Konwersja ffmpeg', color);
  spin.start();

  await engine.runConvert(job, {
    onProgress: t => spin.draw(t),
  });

  spin.succeed('Konwersja zakończona');
  ui.success(color, outputPath);
  console.log('');
}

async function run(argv) {
  const { positional, flags } = parseArgs(argv);
  const color = ui.useColor() && !flags.plain;

  if (flags.help || positional[0] === 'help') {
    ui.printHelp(VERSION, color);
    return 0;
  }
  if (flags.version) {
    if (color) ui.printBanner(VERSION, true);
    else console.log(VERSION);
    return 0;
  }

  const cmd = positional[0];

  // wavesconv — tryb interaktywny (wklej linki w konsoli)
  if (!cmd || cmd === 'interactive' || cmd === 'i') {
    if (!process.stdin.isTTY) {
      ui.error(color, 'Tryb interaktywny wymaga terminala. Użyj: wavesconv download <url>');
      return 1;
    }
    return runInteractive(
      {
        download: cmdDownload,
        info: cmdInfo,
        toolsInstall: cmdToolsInstall,
      },
      VERSION,
      color
    );
  }

  if (color && cmd !== 'tools') {
    ui.printBanner(VERSION, true);
  }

  try {
    switch (cmd) {
      case 'download': {
        const url = positional[1];
        if (!url) throw new Error('Podaj URL: wavesconv download <url>');
        await cmdDownload(url, flags, color);
        return 0;
      }
      case 'info': {
        const url = positional[1];
        if (!url) throw new Error('Podaj URL: wavesconv info <url>');
        await cmdInfo(url, flags, color);
        return 0;
      }
      case 'convert': {
        const file = positional[1];
        if (!file) throw new Error('Podaj plik: wavesconv convert <plik>');
        await cmdConvert(file, flags, color);
        return 0;
      }
      case 'tools': {
        const sub = positional[1];
        if (sub === 'install') await cmdToolsInstall(color);
        else if (sub === 'status') cmdToolsStatus(color);
        else throw new Error('Użyj: wavesconv tools install|status');
        return 0;
      }
      default:
        throw new Error('Nieznane polecenie: ' + cmd);
    }
  } catch (e) {
    ui.error(color, e.message || String(e));
    return 1;
  }
}

function shouldRunAsCli(argv) {
  const args = argv || process.argv.slice(1);
  if (args.includes('--cli')) return true;
  const first = args.find(a => !a.startsWith('-') && a !== process.execPath);
  return ['download', 'info', 'convert', 'tools', 'help'].includes(first);
}

if (require.main === module) {
  run(process.argv.slice(2)).then(code => process.exit(code));
}

module.exports = { run, shouldRunAsCli };
