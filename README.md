<div align="center">

<img src="https://raw.githubusercontent.com/idunnowhytf/wavesconvsite/main/docs/og.png" alt="WavesConverter" width="100%"/>

<br/>

<h1>
  <img src="https://img.shields.io/badge/WavesConverter-v1.2.0-7c3aed?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cGF0aCBkPSJNMiAxMyBRNCA3IDYgMTMgUTggMTkgMTAgMTMgUTEyIDcgMTQgMTMgUTE2IDE5IDE4IDEzIFEyMCA3IDIyIDEzIiBzdHJva2U9IiNjMDg0ZmMiIHN0cm9rZS13aWR0aD0iMi41IiBzdHJva2UtbGluZWNhcD0icm91bmQiLz48L3N2Zz4=" alt="WavesConverter v1.2.0"/>
</h1>

**Download anything. Convert everything.**

A premium desktop app for macOS & Windows that downloads YouTube videos and playlists,
converts any media file — all offline, no account needed, completely free.

<br/>

[![Download](https://img.shields.io/badge/⬇_Download-macOS_&_Windows-7c3aed?style=for-the-badge)](https://idunnowhytf.github.io/wavesconvsite/#download)
[![Website](https://img.shields.io/badge/🌐_Website-wavesconverter-a855f7?style=for-the-badge)](https://idunnowhytf.github.io/wavesconvsite/)
[![Releases](https://img.shields.io/github/v/release/idunnowhytf/wavesconvsite?style=for-the-badge&color=d946ef&label=Latest)](https://github.com/idunnowhytf/wavesconvsite/releases)
[![License](https://img.shields.io/badge/License-ISC-6d28d9?style=for-the-badge)](LICENSE)

<br/>

</div>

---

## ✨ Features

| | Feature | Description |
|---|---|---|
| 📋 | **Playlist Support** | Download entire playlists or cherry-pick individual videos. Override format & quality per item. |
| ⚡ | **Concurrent Queue** | Run multiple downloads simultaneously. Pause, resume, retry — full control. |
| 🔢 | **Batch Paste** | Paste multiple YouTube URLs at once. Batch panel appears with shared format settings. |
| 📊 | **ETA & Speed** | Live download speed (e.g. `3.2 MiB/s`) and time remaining (`ETA 00:42`) on every active item. |
| 🎛️ | **Quality Control** | 360p → 4K for video, 96 → 320 kbps for audio. Apply globally or per video. |
| 🔄 | **Local File Converter** | Convert any media file — change container, resolution, bitrate. No internet needed. |
| 📖 | **Download History** | Every completed download logged with file path, format, and date. |
| ⌨️ | **Keyboard Shortcuts** | `⌘V` paste & fetch, `⌘D` queue, `⌘1–5` tabs, `Space` start/pause. |
| 🔔 | **Native Notifications** | System notification when a download finishes — even if the app is in the background. |
| 🔒 | **100% Offline** | No servers, no accounts, no analytics. Powered by `yt-dlp` + `ffmpeg` bundled inside. |
| ✨ | **Auto Updates** | Silent background updates via GitHub Releases. One click to install. |

---

## 📥 Download

| Platform | Link |
|---|---|
| 🍎 **macOS Apple Silicon** (M1/M2/M3/M4) | [WavesConverter-arm64.dmg](https://github.com/idunnowhytf/wavesconvsite/releases/latest/download/WavesConverter-1.0.0-arm64.dmg) |
| 🍎 **macOS Intel** (x64) | [WavesConverter.dmg](https://github.com/idunnowhytf/wavesconvsite/releases/latest/download/WavesConverter-1.0.0.dmg) |
| 🪟 **Windows 10+** (x64) | [WavesConverter-Setup.exe](https://github.com/idunnowhytf/wavesconvsite/releases/latest/download/WavesConverter.Setup.1.0.0.exe) |

> **Windows users:** SmartScreen may show a warning since the app isn't signed with a paid certificate.
> Click **"More info" → "Run anyway"** to proceed. The source code is fully open and auditable here.

---

## 🚀 Quick Start

### Download a video
1. Paste any YouTube URL into the input field (or press `⌘V` to auto-paste)
2. Click **Fetch** — video metadata loads instantly
3. Pick your format (`MP4`, `MP3`, `WAV`…) and quality (`1080p`, `4K`, `320kbps`…)
4. Click **Add to Queue**, switch to the Queue tab, hit **Start**

### Batch download
Paste multiple YouTube URLs (newline or space separated) — WavesConverter detects them automatically and switches to batch mode. Set format once, add all to queue.

### Convert a local file
Drag any media file onto the **Convert** tab, pick the output format and settings, click **Convert**.

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `⌘V` | Paste URL & auto-fetch (from anywhere in the app) |
| `⌘↵` | Fetch the current URL |
| `⌘D` | Add fetched video to queue |
| `⌘K` | Focus the URL input |
| `⌘1` – `⌘5` | Switch between tabs |
| `Space` | Start / pause queue (in Queue tab) |
| `⌘⇧C` | Clear completed items from queue |

---

## 🛠️ Tech Stack

- **[Electron](https://www.electronjs.org/)** — cross-platform desktop shell
- **[yt-dlp](https://github.com/yt-dlp/yt-dlp)** — YouTube downloading engine
- **[ffmpeg](https://ffmpeg.org/)** — media conversion & processing
- **[@ffmpeg-installer/ffmpeg](https://github.com/nicehash/easy-ffmpeg-installer)** — bundled ffmpeg binary
- **[electron-updater](https://www.electron.build/auto-update)** — automatic updates via GitHub Releases

---

## 🏗️ Build from Source

```bash
# Clone the repository
git clone https://github.com/idunnowhytf/wavesconvsite.git
cd wavesconvsite

# Install dependencies
npm install

# Run in development
npx electron .

# Build for macOS
npx electron-builder --mac --publish never

# Build for Windows (works from macOS via Wine)
npx electron-builder --win --x64 --publish never
```

> **Requirements:** Node.js 18+, npm

---

## 📁 Project Structure

```
wavesconvsite/
├── main.js          # Electron main process — IPC, yt-dlp spawning, ffmpeg
├── preload.js       # Context bridge — exposes safe APIs to renderer
├── renderer.js      # UI logic — queue, history, batch paste, ETA
├── index.html       # App shell — tabs, layout
├── style.css        # App styles — glassmorphism dark purple theme
├── assets/
│   ├── icon.icns    # macOS app icon
│   ├── icon.ico     # Windows app icon
│   └── icon.png     # Generic icon
└── docs/            # GitHub Pages website
    ├── index.html   # Landing page
    ├── changelog.html
    └── docs.html
```

---

## 📋 Changelog

See [**Releases →**](https://github.com/idunnowhytf/wavesconvsite/releases) for full version history.

| Version | Highlights |
|---|---|
| **v1.2.0** | Batch paste for multiple URLs, ETA & speed display on downloads |
| **v1.1.0** | Download history tab, keyboard shortcuts, native notifications, drag & drop, Windows support |
| **v1.0.0** | Initial release — macOS only |

---

## 🤝 Contributing

Found a bug or have a feature idea? [Open an issue](https://github.com/idunnowhytf/wavesconvsite/issues) — all feedback welcome.

---

## ⚖️ Legal

WavesConverter uses `yt-dlp` and `ffmpeg` under their respective open-source licenses.
Downloading copyrighted content without permission may violate YouTube's Terms of Service and local laws.
This tool is intended for downloading content you own or have permission to download.

---

<div align="center">

**[Website](https://idunnowhytf.github.io/wavesconvsite/) · [Releases](https://github.com/idunnowhytf/wavesconvsite/releases) · [Docs](https://idunnowhytf.github.io/wavesconvsite/docs.html) · [Changelog](https://idunnowhytf.github.io/wavesconvsite/changelog.html)**

<br/>

Made with ❤️ using Electron, yt-dlp & ffmpeg · Free & Open Source

</div>
