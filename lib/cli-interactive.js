'use strict';

const readline = require('readline');
const path = require('path');
const fs = require('fs');
const engine = require('./engine');
const ui = require('./cli-ui');

function defaultSession() {
  return {
    output: engine.getDefaultDownloadDir(),
    format: 'mp4',
    audioOnly: false,
    quality: 'best',
    bitrate: '',
    filename: '%(title)s',
  };
}

function sessionToFlags(session) {
  return {
    output: session.output,
    format: session.format,
    audio: session.audioOnly,
    quality: session.quality,
    bitrate: session.bitrate,
    filename: session.filename,
  };
}

function extractYouTubeUrls(text) {
  return engine.extractMediaUrls(text);
}

function printSession(color, session) {
  const mode = session.audioOnly ? 'audio' : 'wideo';
  const fmt = session.format;
  ui.info(
    color,
    `Tryb: ${mode} · ${fmt} · ${session.quality} · folder: ${session.output}`
  );
}

function printInteractiveHelp(color) {
  console.log('');
  ui.info(color, 'Wklej link YouTube i naciśnij Enter — pobieranie startuje automatycznie.');
  console.log(ui.c(color, ui.palette.dim, '  Komendy:'));
  const cmds = [
    ['/help', 'Ta pomoc'],
    ['/info <url>', 'Podgląd bez pobierania'],
    ['/audio', 'Tryb audio (mp3 domyślnie)'],
    ['/video', 'Tryb wideo (mp4 domyślnie)'],
    ['/fmt mp3', 'Format: mp4, mp3, webm, mkv…'],
    ['/q 1080p', 'Jakość: best, 1080p, 720p…'],
    ['/folder', 'Zmień folder pobierania'],
    ['/folder C:\\Videos', 'Ustaw folder od razu'],
    ['/status', 'Narzędzia yt-dlp / ffmpeg'],
    ['/install', 'Zainstaluj yt-dlp'],
    ['/quit', 'Wyjście (lub Ctrl+C)'],
  ];
  for (const [cmd, desc] of cmds) {
    console.log('  ' + ui.c(color, ui.palette.cyan, cmd.padEnd(22)) + ui.c(color, ui.palette.dim, desc));
  }
  console.log('');
}

async function runInteractive(handlers, version, color) {
  const session = defaultSession();
  let ytDlpReady = false;

  ui.printBanner(version, color);
  printSession(color, session);
  printInteractiveHelp(color);

  const promptText = color
    ? ui.c(true, ui.palette.pink, '🔗 ') + ui.c(true, ui.palette.bold, 'Wklej link') + ui.c(true, ui.palette.dim, ' › ')
    : 'link> ';

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
    historySize: 100,
  });

  const ensureTools = async () => {
    if (ytDlpReady && engine.findYtDlp()) return;
    const spin = new ui.Spinner('Przygotowanie yt-dlp', color);
    spin.start();
    try {
      await engine.ensureYtDlp(msg => spin.draw(msg));
      spin.succeed('Gotowe');
      ytDlpReady = true;
    } catch (e) {
      spin.fail(e.message);
      throw e;
    }
  };

  const askLine = (question) => new Promise(resolve => {
    rl.question(question, answer => resolve(answer.trim()));
  });

  const processSlashCommand = async (line) => {
    const parts = line.slice(1).trim().split(/\s+/);
    const cmd = (parts[0] || '').toLowerCase();
    const arg = parts.slice(1).join(' ');

    switch (cmd) {
      case 'help':
      case 'h':
      case '?':
        printInteractiveHelp(color);
        return;
      case 'quit':
      case 'exit':
      case 'q':
        ui.info(color, 'Do zobaczenia! 🌊');
        rl.close();
        return 'exit';
      case 'audio':
      case 'a':
        session.audioOnly = true;
        if (!['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg'].includes(session.format)) {
          session.format = 'mp3';
        }
        ui.success(color, `Tryb audio · format: ${session.format}`);
        printSession(color, session);
        return;
      case 'video':
      case 'v':
        session.audioOnly = false;
        if (['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg'].includes(session.format)) {
          session.format = 'mp4';
        }
        ui.success(color, `Tryb wideo · format: ${session.format}`);
        printSession(color, session);
        return;
      case 'fmt':
      case 'format':
      case 'f':
        if (!arg) {
          ui.warn(color, 'Użyj: /fmt mp3  lub  /fmt mp4');
          return;
        }
        session.format = arg.toLowerCase();
        if (['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg'].includes(session.format)) {
          session.audioOnly = true;
        }
        ui.success(color, `Format: ${session.format}`);
        printSession(color, session);
        return;
      case 'q':
      case 'quality':
        if (!arg) {
          ui.warn(color, 'Użyj: /q 1080p  lub  /q best');
          return;
        }
        session.quality = arg;
        ui.success(color, `Jakość: ${session.quality}`);
        printSession(color, session);
        return;
      case 'folder':
      case 'o':
      case 'output':
        if (arg) {
          const dir = path.resolve(arg);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          session.output = dir;
          ui.success(color, 'Folder: ' + dir);
        } else {
          const entered = await askLine(
            color ? ui.c(true, ui.palette.cyan, 'Ścieżka folderu: ') : 'Folder: '
          );
          if (entered) {
            const dir = path.resolve(entered);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            session.output = dir;
            ui.success(color, 'Folder: ' + dir);
          }
        }
        printSession(color, session);
        return;
      case 'status':
        ui.kv(color, 'yt-dlp', engine.findYtDlp() || 'BRAK', !!engine.findYtDlp());
        ui.kv(color, 'ffmpeg', engine.findFfmpeg() || 'BRAK', !!engine.findFfmpeg());
        return;
      case 'install':
        await handlers.toolsInstall(color);
        ytDlpReady = true;
        return;
      case 'info':
      case 'i': {
        const url = arg || '';
        if (!url || !engine.isSupportedMediaUrl(url)) {
          ui.warn(color, 'Użyj: /info <url> (YouTube lub Instagram)');
          return;
        }
        await handlers.info(url, {}, color);
        return;
      }
      case 'clear':
        console.clear();
        ui.printBanner(version, color);
        printSession(color, session);
        return;
      default:
        ui.warn(color, `Nieznana komenda: /${cmd} — wpisz /help`);
    }
  };

  rl.setPrompt(promptText);

  return new Promise(resolve => {
    rl.on('close', () => resolve(0));

    const loop = () => {
      rl.prompt();
    };

    rl.on('line', async line => {
      const trimmed = line.trim();
      rl.pause();

      try {
        if (!trimmed) {
          rl.resume();
          loop();
          return;
        }

        if (trimmed.startsWith('/')) {
          const result = await processSlashCommand(trimmed);
          if (result === 'exit') {
            resolve(0);
            return;
          }
          rl.resume();
          loop();
          return;
        }

        const urls = extractYouTubeUrls(trimmed);
        if (!urls.length) {
          ui.warn(color, 'Nie wykryto linku YouTube/Instagram. Wklej URL lub wpisz /help');
          rl.resume();
          loop();
          return;
        }

        await ensureTools();

        for (let i = 0; i < urls.length; i++) {
          if (urls.length > 1) {
            ui.info(color, `Pobieranie ${i + 1}/${urls.length}`);
          }
          await handlers.download(urls[i], sessionToFlags(session), color);
        }
      } catch (e) {
        ui.error(color, e.message || String(e));
      }

      rl.resume();
      loop();
    });

    rl.on('SIGINT', () => {
      console.log('');
      ui.info(color, 'Wyjście (Ctrl+C)');
      rl.close();
      resolve(0);
    });

    loop();
  });
}

module.exports = { runInteractive, defaultSession };
