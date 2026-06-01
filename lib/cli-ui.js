'use strict';

const tty = process.stdout.isTTY;

const ESC = '\x1b[';
const reset = `${ESC}0m`;

const palette = {
  purple: `${ESC}38;2;192;132;252m`,
  pink: `${ESC}38;2;232;121;249m`,
  violet: `${ESC}38;2;124;58;237m`,
  cyan: `${ESC}38;2;34;211;238m`,
  green: `${ESC}38;2;74;222;128m`,
  yellow: `${ESC}38;2;250;204;21m`,
  red: `${ESC}38;2;248;113;113m`,
  dim: `${ESC}2m`,
  bold: `${ESC}1m`,
};

function useColor() {
  if (process.env.NO_COLOR !== undefined) return false;
  if (process.env.WAVESCONV_PLAIN === '1') return false;
  if (process.argv.includes('--plain')) return false;
  return tty;
}

function c(enabled, code, text) {
  if (!enabled) return String(text);
  return `${code}${text}${reset}`;
}

function gradientLine(enabled, text) {
  if (!enabled) return text;
  const chars = [...text];
  const stops = [
    [192, 132, 252],
    [216, 126, 251],
    [232, 121, 249],
    [196, 116, 248],
    [168, 85, 247],
  ];
  return chars.map((ch, i) => {
    const t = chars.length <= 1 ? 0 : i / (chars.length - 1);
    const idx = Math.min(stops.length - 1, Math.floor(t * (stops.length - 1)));
    const [r, g, b] = stops[idx];
    return `${ESC}38;2;${r};${g};${b}m${ch}`;
  }).join('') + reset;
}

function printBanner(version, enabled) {
  const wave = '～～～～～～～～～～～～～～～～～～～～～～～～～～～～～';
  const title = `  WavesConverter CLI  v${version}  `;
  console.log('');
  console.log(c(enabled, palette.dim, '  ' + gradientLine(enabled, wave)));
  console.log(c(enabled, palette.bold, gradientLine(enabled, title)));
  console.log(c(enabled, palette.dim, '  ' + gradientLine(enabled, wave)));
  console.log(c(enabled, palette.dim, '  Download anything · Convert everything\n'));
}

function printHelp(version, enabled) {
  printBanner(version, enabled);
  const rows = [
    ['Polecenia', ''],
    ['  download <url>', 'Pobierz wideo/audio z YouTube'],
    ['  info <url>', 'Metadane (kolorowy podgląd lub JSON)'],
    ['  convert <plik>', 'Konwertuj plik lokalny'],
    ['  tools install', 'Zainstaluj yt-dlp'],
    ['  tools status', 'Status yt-dlp i ffmpeg'],
    ['  (bez argumentów)', 'Tryb interaktywny — wklej linki w konsoli'],
    ['', ''],
    ['Opcje download', ''],
    ['  -o, --output <dir>', 'Folder docelowy'],
    ['  -f, --format <fmt>', 'mp4, mp3, webm…'],
    ['  -q, --quality <q>', 'best, 1080p, 720p…'],
    ['  -a, --audio', 'Tylko audio'],
    ['  --plain', 'Bez kolorów i animacji'],
    ['', ''],
    ['Przykłady', ''],
    ['  wavesconv download URL -a -f mp3', ''],
    ['  wavesconv convert film.mp4 -f mp3', ''],
  ];
  for (const [cmd, desc] of rows) {
    if (!cmd && !desc) { console.log(''); continue; }
    if (desc === '' && cmd && !cmd.startsWith(' ')) {
      console.log(c(enabled, palette.pink, `\n  ${cmd}`));
      continue;
    }
    if (cmd.startsWith('  ') && !cmd.includes('<') && desc === '') {
      console.log(c(enabled, palette.cyan, `    ${cmd.trim()}`));
      continue;
    }
    console.log(
      c(enabled, palette.cyan, cmd.padEnd(28)) +
      c(enabled, palette.dim, desc)
    );
  }
  console.log('');
}

class Spinner {
  constructor(text, enabled) {
    this.text = text;
    this.enabled = enabled && tty;
    this.frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    this.colors = [palette.purple, palette.pink, palette.violet, palette.cyan];
    this.i = 0;
    this.timer = null;
  }

  start() {
    if (!this.enabled) {
      process.stderr.write(this.text + '…\n');
      return;
    }
    this.timer = setInterval(() => this.draw(), 80);
    this.draw();
  }

  draw(extra = '') {
    if (!this.enabled) return;
    const frame = this.frames[this.i % this.frames.length];
    const color = this.colors[Math.floor(this.i / 2) % this.colors.length];
    const line = `${color}${frame}${reset} ${palette.bold}${this.text}${reset}${extra ? palette.dim + ' · ' + extra + reset : ''}`;
    process.stderr.write(`\r\x1b[2K${line}`);
    this.i++;
  }

  succeed(msg) {
    this.stop();
    process.stderr.write(c(this.enabled, palette.green, `✔ ${msg || this.text}\n`));
  }

  fail(msg) {
    this.stop();
    process.stderr.write(c(this.enabled, palette.red, `✖ ${msg || this.text}\n`));
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.enabled) process.stderr.write('\r\x1b[2K');
  }
}

class ProgressBar {
  constructor(label, enabled, width = 32) {
    this.label = label;
    this.enabled = enabled && tty;
    this.width = width;
    this.pct = 0;
    this.detail = '';
    this.pulse = 0;
    this.timer = null;
  }

  start() {
    if (!this.enabled) return;
    this.timer = setInterval(() => {
      this.pulse = (this.pulse + 1) % 4;
      this.render();
    }, 120);
    this.render();
  }

  update(pct, detail = '') {
    this.pct = Math.max(0, Math.min(100, pct));
    if (detail) this.detail = detail.slice(0, 42);
    if (!this.enabled) {
      const r = Math.floor(this.pct);
      if (r % 10 === 0 && r !== this._lastPlain) {
        this._lastPlain = r;
        process.stderr.write(`  ${r}%\n`);
      }
      return;
    }
    this.render();
  }

  render() {
    if (!this.enabled) return;
    const filled = Math.round((this.pct / 100) * this.width);
    const blocks = ['░', '▒', '▓', '█'];
    let bar = '';
    for (let i = 0; i < this.width; i++) {
      if (i < filled) bar += c(true, palette.pink, '█');
      else if (i === filled) bar += c(true, palette.purple, blocks[this.pulse]);
      else bar += c(true, palette.dim, '░');
    }
    const pctStr = `${String(Math.floor(this.pct)).padStart(3)}%`;
    const line = `${c(true, palette.bold, this.label)} ${bar} ${c(true, palette.cyan, pctStr)}${this.detail ? c(true, palette.dim, '  ' + this.detail) : ''}`;
    process.stdout.write(`\r\x1b[2K${line}`);
  }

  succeed(msg) {
    if (this.timer) clearInterval(this.timer);
    this.pct = 100;
    if (this.enabled) {
      this.render();
      process.stdout.write('\n');
      process.stderr.write(c(true, palette.green, `✔ ${msg}\n`));
    } else {
      process.stderr.write(msg + '\n');
    }
  }

  fail(msg) {
    if (this.timer) clearInterval(this.timer);
    if (this.enabled) process.stdout.write('\n');
    process.stderr.write(c(this.enabled, palette.red, `✖ ${msg}\n`));
  }
}

function info(enabled, msg) {
  process.stderr.write(c(enabled, palette.cyan, '◆ ') + msg + '\n');
}

function success(enabled, msg) {
  process.stderr.write(c(enabled, palette.green, '✔ ') + c(enabled, palette.bold, msg) + '\n');
}

function warn(enabled, msg) {
  process.stderr.write(c(enabled, palette.yellow, '⚠ ') + msg + '\n');
}

function error(enabled, msg) {
  process.stderr.write(c(enabled, palette.red, '✖ ') + c(enabled, palette.bold, msg) + '\n');
}

function kv(enabled, key, value, ok) {
  const icon = ok === true ? c(enabled, palette.green, '●') : ok === false ? c(enabled, palette.red, '○') : c(enabled, palette.purple, '●');
  process.stderr.write(`  ${icon} ${c(enabled, palette.dim, key + ':')} ${c(enabled, ok === false ? palette.red : palette.bold, value)}\n`);
}

function printVideoCard(enabled, item) {
  const title = item.title || item.id || 'Bez tytułu';
  const uploader = item.uploader || '—';
  const dur = item.duration ? formatDuration(item.duration) : '—';
  const views = item.view_count ? formatViews(item.view_count) : '—';
  console.log('');
  console.log(c(enabled, palette.bold, gradientLine(enabled, '  ' + title.slice(0, 56))));
  kv(enabled, 'Kanał', uploader);
  kv(enabled, 'Czas', dur);
  kv(enabled, 'Wyświetlenia', views);
  if (item.webpage_url || item.url) kv(enabled, 'URL', item.webpage_url || item.url);
  console.log('');
}

function formatDuration(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatViews(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}

function formatBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / (1024 * 1024)).toFixed(2) + ' MB';
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

module.exports = {
  useColor,
  palette,
  c,
  printBanner,
  printHelp,
  Spinner,
  ProgressBar,
  info,
  success,
  warn,
  error,
  kv,
  printVideoCard,
  formatBytes,
  sleep,
  gradientLine,
};
