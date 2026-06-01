const isMac = navigator.platform.toLowerCase().includes('mac') || navigator.userAgent.toLowerCase().includes('mac');
let queue=[], fetchedItems=[], isPlaylist=false, qRunning=false, qPaused=false;
let settings={ outputDir:'', concurrent:2, videoFormat:'mp4', audioFormat:'mp3', quality:'best', filenameTemplate:'%(title)s', animations:'yes' };
let downloadHistory=[];

window.addEventListener('DOMContentLoaded', async () => {
  settings.outputDir = await window.api.getDefaultDir();
  loadSettings();
  loadHistory();
  initWindowControls(); initTabs(); initDownloadTab(); initConvertTab(); initQueueTab(); initHistoryTab(); initSettingsTab(); initIpc();
  initKeyboardShortcuts(); initDragDrop();
  checkStatus(); renderQueue(); renderHistory(); applySettings();
  if (localStorage.getItem('wc2_first_launch') !== 'false') {
    const overlay = document.getElementById('welcomeOverlay');
    if (overlay) overlay.classList.remove('hidden');
    const currentAnim = settings.animations || 'yes';
    window.selectWelcomeAnim(currentAnim);
  }
  if (window.api.onDeepLink) {
    window.api.onDeepLink(payload => handleDeepLink(payload));
  }
  if (window.api.onClipboardSearchTrigger) {
    window.api.onClipboardSearchTrigger(async (text) => {
      if (!text) return;
      const cleanText = text.trim();
      const isYt = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+$/i.test(cleanText);
      if (isYt) {
        const urlInput = document.getElementById('urlInput');
        if (urlInput) {
          if (urlInput.value.trim() === cleanText) return;
          urlInput.value = cleanText;
          switchTab('download');
          const btnFetch = document.getElementById('btnFetch');
          if (btnFetch) btnFetch.click();
          toast('Wykryto link YouTube w schowku — wyszukiwanie... 🔍', 'info');
        }
      }
    });
  }
  const v = await window.api.getVersion().catch(()=>'1.0.0');
  document.getElementById('versionTag').textContent = 'v'+v;
  requestNotificationPermission();
});

/* ─── Window Controls ─── */
function initWindowControls() {
  document.getElementById('btnMin').onclick   = () => window.api.minimize();
  document.getElementById('btnMax').onclick   = () => window.api.maximize();
  document.getElementById('btnClose').onclick = () => window.api.close();
  window.api.onWindowState(s => { document.getElementById('btnMax').title = s==='maximized'?'Restore':'Maximize'; });
}

/* ─── Tabs ─── */
const TAB_ORDER = ['download','convert','queue','history','settings'];
function initTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });
}
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active', t.dataset.tab===name));
  document.querySelectorAll('.tab-content').forEach(c=>c.classList.toggle('active', c.id==='tab-'+name));
}

/* ─── Toast ─── */
function toast(msg, type='info') {
  const stack = document.getElementById('toastStack');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<div class="toast-dot"></div><span>${escHtml(msg)}</span>`;
  stack.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(()=>el.remove(), 280); }, 3200);
}

/* ─── System Notifications ─── */
function requestNotificationPermission() {
  if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}
function sysNotify(title, body) {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission === 'granted') {
    new Notification(title, { body, silent: false });
  }
}

/* ─── Status ─── */
async function checkStatus() {
  const [hasYt, hasFf] = await Promise.all([window.api.checkYtdlp(), window.api.checkFfmpeg()]);
  const yt = document.getElementById('statusYtdlp'), ff = document.getElementById('statusFfmpeg');
  yt.textContent = hasYt?'✓ Zainstalowano':'✗ Brak'; yt.className=`sys-val ${hasYt?'ok':'missing'}`;
  ff.textContent = hasFf?'✓ Zainstalowano':'✗ Brak'; ff.className=`sys-val ${hasFf?'ok':'missing'}`;
  const ind = document.getElementById('statusIndicators'); ind.innerHTML='';
  [['yt-dlp',hasYt],['ffmpeg',hasFf]].forEach(([name,ok])=>{
    const d=document.createElement('div'); d.className=`si ${ok?'ok':'missing'}`; d.title=`${name}: ${ok?'OK':'Brak'}`; ind.appendChild(d);
  });
  
  // Pokaż/ukryj komunikat obok czerwonych kropek
  const prompt = document.getElementById('installPrompt');
  if (prompt) {
    if (!hasYt || !hasFf) prompt.classList.remove('hidden');
    else prompt.classList.add('hidden');
  }
}

function updateShortcutsUI() {
  const grid = document.getElementById('shortcutsGrid');
  if (!grid) return;
  const mod = isMac ? '⌘' : 'Ctrl+';
  const enter = isMac ? '↵' : 'Enter';
  const shift = isMac ? '⇧' : 'Shift+';
  const shortcuts = [
    { key: 'Alt+Shift+W', desc: 'Pokaż / ukryj program w tle (globalny skrót)' },
    { key: `${mod}V`, desc: 'Wklej URL i wyszukaj automatycznie' },
    { key: `${mod}${enter}`, desc: 'Wyszukaj URL' },
    { key: `${mod}D`, desc: 'Dodaj do kolejki' },
    { key: `${mod}1–5`, desc: 'Przełącz zakładki' },
    { key: `${mod}${shift}C`, desc: 'Wyczyść ukończone pozycje' },
    { key: 'Space', desc: 'Uruchom / wstrzymaj kolejkę (w zakładce Kolejka)' }
  ];
  grid.innerHTML = shortcuts.map(s => `
    <div class="shortcut-row"><kbd>${s.key}</kbd><span>${s.desc}</span></div>
  `).join('');
}

/* ─── Keyboard Shortcuts ─── */
function initKeyboardShortcuts() {
  updateShortcutsUI();
  document.addEventListener('keydown', e => {
    const mod = isMac ? e.metaKey : e.ctrlKey;
    if (!mod) {
      // Space = start/pause queue if queue tab is active
      if (e.code === 'Space' && document.getElementById('tab-queue').classList.contains('active') && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
        e.preventDefault();
        if (!qRunning) startQueue(); else pauseQueue();
      }
      return;
    }
    // Cmd+1-5 → switch tabs
    const tabKeys = {'1':'download','2':'convert','3':'queue','4':'history','5':'settings'};
    if (tabKeys[e.key]) { e.preventDefault(); switchTab(tabKeys[e.key]); return; }

    switch(e.key) {
      case 'v':
      case 'V':
        // If not in a text field, auto-focus URL input and let paste land there
        if (document.activeElement !== document.getElementById('urlInput') &&
            document.activeElement.tagName !== 'INPUT' &&
            document.activeElement.tagName !== 'TEXTAREA') {
          e.preventDefault();
          switchTab('download');
          const inp = document.getElementById('urlInput');
          inp.focus();
          // Read clipboard and paste
          navigator.clipboard.readText().then(text => {
            if (text && (text.includes('youtube.com') || text.includes('youtu.be'))) {
              inp.value = text;
              setTimeout(() => doFetch(), 100);
              toast('Wklejono link — wyszukiwanie…', 'info');
            }
          }).catch(()=>{});
        }
        break;
      case 'Enter':
        if (document.getElementById('tab-download').classList.contains('active')) {
          e.preventDefault(); doFetch();
        }
        break;
      case 'd':
      case 'D':
        e.preventDefault();
        if (fetchedItems.length) {
          if (isPlaylist) addPlaylistToQueue(); else addSingleToQueue();
        } else {
          toast('Najpierw wyszukaj wideo','warning');
        }
        break;
      case 'K':
      case 'k':
        e.preventDefault();
        // Cmd+K = focus URL input
        switchTab('download');
        document.getElementById('urlInput').focus();
        document.getElementById('urlInput').select();
        break;
      case 'Shift':
        break;
    }
    // Cmd+Shift+C = clear done
    if (e.shiftKey && (e.key === 'C' || e.key === 'c')) {
      e.preventDefault();
      queue = queue.filter(j=>!['done','error','cancelled'].includes(j.status));
      renderQueue(); bumpBadge(); toast('Wyczyszczono ukończone pozycje','info');
    }
  });
}

/* ─── Deep link (wavesconverter://…) ─── */
async function handleDeepLink(payload) {
  if (!payload) return;
  const action = payload.action || 'open';

  if (action === 'open') {
    switchTab('download');
    return;
  }

  if (payload.url && !/^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/i.test(payload.url)) {
    toast('Deep link: nieprawidłowy URL YouTube', 'warning');
    return;
  }

  if (payload.url) {
    switchTab('download');
    document.getElementById('urlInput').value = payload.url;

    if (payload.format) {
      const fmt = payload.format.toLowerCase();
      const isAudio = payload.audioOnly || ['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg'].includes(fmt);
      if (isAudio) {
        document.querySelectorAll('#singleTypePills .pill').forEach(p => p.classList.toggle('active', p.dataset.val === 'audio'));
        updateSingleType('audio');
      }
      const fmtSel = document.getElementById('singleFormat');
      if (fmtSel && [...fmtSel.options].some(o => o.value === fmt)) fmtSel.value = fmt;
    }
    if (payload.quality) {
      const qSel = document.getElementById('singleQuality');
      if (qSel && [...qSel.options].some(o => o.value === payload.quality)) qSel.value = payload.quality;
    }
    if (payload.bitrate) {
      const brSel = document.getElementById('singleBitrate');
      if (brSel) brSel.value = payload.bitrate;
    }

    toast('Otwarto link z deep link — wyszukiwanie…', 'info');
    await doFetch();

    if (payload.autoQueue && fetchedItems.length) {
      if (isPlaylist) addPlaylistToQueue();
      else addSingleToQueue();
      if (payload.autoStart) startQueue();
      toast(payload.autoStart ? 'Dodano do kolejki i uruchomiono' : 'Dodano do kolejki z deep link', 'success');
    }
    return;
  }

  if (action === 'convert' && payload.file) {
    switchTab('convert');
    setConvertInput(payload.file);
    toast('Załadowano plik z deep link', 'info');
  }
}

/* ─── Download Tab ─── */
function initDownloadTab() {
  const inp = document.getElementById('urlInput');
  document.getElementById('btnFetch').addEventListener('click', doFetch);
  inp.addEventListener('keydown', e=>{ if(e.key==='Enter') doFetch(); });
  initPills('singleTypePills', val=>updateSingleType(val));
  initPills('globalTypePills', val=>updateGlobalType(val));
  document.getElementById('singleFilenameTemplate').addEventListener('change', ()=>toggle('singleCustomWrap', document.getElementById('singleFilenameTemplate').value==='custom'));
  document.getElementById('globalFilenameTemplate').addEventListener('change', ()=>toggle('globalCustomWrap', document.getElementById('globalFilenameTemplate').value==='custom'));
  document.getElementById('btnSingleBrowse').addEventListener('click', async()=>{ const d=await window.api.chooseFolder(); if(d) document.getElementById('singleOutputDir').value=d; });
  document.getElementById('btnPlaylistBrowse').addEventListener('click', async()=>{ const d=await window.api.chooseFolder(); if(d) document.getElementById('playlistOutputDir').value=d; });
  document.getElementById('btnAddSingle').addEventListener('click', addSingleToQueue);
  document.getElementById('btnAddToQueue').addEventListener('click', addPlaylistToQueue);
  document.getElementById('btnSelAll').addEventListener('click', ()=>setAllChecked(true));
  document.getElementById('btnSelNone').addEventListener('click', ()=>setAllChecked(false));
}

function initPills(containerId, onChange) {
  document.querySelectorAll(`#${containerId} .pill`).forEach(pill=>{
    pill.addEventListener('click', ()=>{
      document.querySelectorAll(`#${containerId} .pill`).forEach(p=>p.classList.remove('active'));
      pill.classList.add('active'); onChange(pill.dataset.val);
    });
  });
}
function getPillVal(id) { const a=document.querySelector(`#${id} .pill.active`); return a?a.dataset.val:'video'; }
function updateSingleType(type) { fillFormatSelect('singleFormat',type); toggle('singleQualityWrap',type==='video'); }
function updateGlobalType(type) { fillFormatSelect('globalFormat',type); toggle('globalQualityWrap',type==='video'); }
function fillFormatSelect(selId,type) {
  const sel=document.getElementById(selId), cur=sel.value;
  const opts=type==='audio'?['mp3','wav','flac','aac','m4a','ogg']:['mp4','mkv','mov','webm','avi'];
  sel.innerHTML=opts.map(f=>`<option value="${f}">${f.toUpperCase()}</option>`).join('');
  if(opts.includes(cur)) sel.value=cur;
}
function toggle(id,show) { const el=document.getElementById(id); show?el.classList.remove('hidden'):el.classList.add('hidden'); }

async function doFetch() {
  const url = document.getElementById('urlInput').value.trim();
  if(!url) return toast('Najpierw wprowadź URL','warning');
  const btn=document.getElementById('btnFetch');
  btn.disabled=true;
  btn.querySelector('.btn-fetch-text').textContent='Pobieranie…';
  btn.querySelector('.btn-fetch-icon').innerHTML='<div class="spinner"></div>';
  hide('singleSection'); hide('playlistSection');
  try {
    const items = await window.api.fetchInfo(url);
    fetchedItems=items;
    if(items.length===1){ isPlaylist=false; renderSingle(items[0]); }
    else { isPlaylist=true; renderPlaylist(items); }
  } catch(e) { toast('Błąd: '+e.message,'error'); }
  finally {
    btn.disabled=false;
    btn.querySelector('.btn-fetch-text').textContent='Wyszukaj';
    btn.querySelector('.btn-fetch-icon').innerHTML='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>';
  }
}

function renderSingle(item) {
  const hero=document.getElementById('videoHero');
  const thumb=item.thumbnail||(item.thumbnails||[])[0]?.url||'';
  const dur=item.duration?fmtDur(item.duration):'';
  hero.innerHTML=`${thumb?`<img class="vh-thumb" src="${thumb}" onerror="this.style.display='none'" alt="">`:'<div class="vh-thumb-placeholder"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="7" width="20" height="13" rx="2"/></svg></div>'}
    <div class="vh-info">
      <div class="vh-title">${escHtml(item.title||item.id)}</div>
      <div class="vh-meta">
        ${item.uploader?`<span class="vh-chip">👤 ${escHtml(item.uploader)}</span>`:''}
        ${dur?`<span class="vh-chip">⏱ ${dur}</span>`:''}
        ${item.view_count?`<span class="vh-chip">👁 ${fmtN(item.view_count)}</span>`:''}
        ${thumb?`<button class="btn-ghost-sm" id="btnDownloadThumb" style="margin-left:auto; display:inline-flex; align-items:center; gap:4px; padding:3px 8px; font-size:11px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Miniaturka HD</button>`:''}
      </div>
    </div>`;
  
  const btnThumb = hero.querySelector('#btnDownloadThumb');
  if (btnThumb) {
    btnThumb.onclick = async (e) => {
      e.preventDefault();
      const outputDir = document.getElementById('singleOutputDir').value || settings.outputDir;
      const cleanTitle = (item.title || item.id || 'thumbnail').replace(/[<>:"/\\|?*]/g, '_');
      const targetPath = `${outputDir}/${cleanTitle}_miniaturka.jpg`;
      
      btnThumb.disabled = true;
      btnThumb.textContent = 'Pobieranie…';
      try {
        await window.api.downloadThumbnail({ url: thumb, dest: targetPath });
        toast('Miniaturka pobrana pomyślnie!', 'success');
      } catch (err) {
        toast('Błąd pobierania miniaturki: ' + err.message, 'error');
      } finally {
        btnThumb.disabled = false;
        btnThumb.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Miniaturka HD`;
      }
    };
  }

  const maxH = item.height || (item.formats && Array.isArray(item.formats)
    ? Math.max(...item.formats.map(f => f.vcodec !== 'none' ? (f.height || 0) : 0))
    : 0);
  const qSelect = document.getElementById('singleQuality');
  if (qSelect) {
    const bestOpt = qSelect.querySelector('option[value="best"]');
    if (bestOpt) {
      bestOpt.textContent = maxH ? `Najlepsza (${maxH}p)` : 'Najlepsza';
    }
  }
  
  show('singleSection');
  document.getElementById('singleOutputDir').value=settings.outputDir;
  updateSingleType('video');
}

function renderPlaylist(items) {
  document.getElementById('playlistName').textContent=items[0]?.playlist_title||items[0]?.playlist||'Playlista';
  document.getElementById('playlistSub').textContent=`${items.length} filmów`;
  const cont=document.getElementById('playlistItems'); cont.innerHTML='';
  items.forEach((item,idx)=>{
    const thumb=item.thumbnail||(item.thumbnails||[])[0]?.url||'';
    const dur=item.duration?fmtDur(item.duration):'';
    const maxH = item.height || (item.formats && Array.isArray(item.formats)
      ? Math.max(...item.formats.map(f => f.vcodec !== 'none' ? (f.height || 0) : 0))
      : 0);
    const bestText = maxH ? `Najlepsza (${maxH}p)` : 'Najlepsza';
    const div=document.createElement('div'); div.className='pitem selected'; div.dataset.idx=idx;
    div.innerHTML=`<input type="checkbox" class="pcheck" data-idx="${idx}" checked>
      <span class="pitem-num">${idx+1}</span>
      ${thumb?`<img class="pitem-thumb" src="${thumb}" onerror="this.style.display='none'" alt="">`:''}
      <div class="pitem-info"><div class="pitem-title">${escHtml(item.title||item.id)}</div>${dur?`<div class="pitem-dur">⏱ ${dur}</div>`:''}</div>
      <div class="pitem-overrides">
        <select class="ov-type" data-idx="${idx}" title="Typ"><option value="">↑ globalne</option><option value="video">Wideo</option><option value="audio">Audio</option></select>
        <select class="ov-fmt" data-idx="${idx}" title="Format"><option value="">↑ globalne</option><option value="mp4">MP4</option><option value="mkv">MKV</option><option value="mp3">MP3</option><option value="wav">WAV</option><option value="flac">FLAC</option></select>
        <select class="ov-q" data-idx="${idx}" title="Jakość"><option value="">↑ globalne</option><option value="best">${bestText}</option><option value="1080p">1080p</option><option value="720p">720p</option><option value="480p">480p</option></select>
      </div>`;
    div.querySelector('.pcheck').addEventListener('change', e=>div.classList.toggle('selected',e.target.checked));
    cont.appendChild(div);
  });
  show('playlistSection');
  document.getElementById('playlistOutputDir').value=settings.outputDir;
  updateGlobalType('video');
}

function setAllChecked(val) {
  document.querySelectorAll('.pcheck').forEach(cb=>{ cb.checked=val; cb.closest('.pitem').classList.toggle('selected',val); });
}

function addSingleToQueue() {
  if(!fetchedItems.length) return toast('Najpierw wyszukaj wideo','warning');
  const item=fetchedItems[0], type=getPillVal('singleTypePills');
  pushJob(buildJob(item,{ type, fmt:document.getElementById('singleFormat').value, quality:document.getElementById('singleQuality').value, bitrate:document.getElementById('singleBitrate').value, filename:getFilename('singleFilenameTemplate','singleCustomFilename'), outputDir:document.getElementById('singleOutputDir').value||settings.outputDir, url:item.url||item.webpage_url||document.getElementById('urlInput').value.trim() }));
  toast(`Dodano do kolejki, naciśnij ${isMac ? '⌘3' : 'Ctrl+3'} aby wyświetlić`,'success'); goQueue();
}

function addPlaylistToQueue() {
  const checks=[...document.querySelectorAll('.pcheck')].filter(c=>c.checked);
  if(!checks.length) return toast('Zaznacz co najmniej jedno wideo','warning');
  const gType=getPillVal('globalTypePills'), gFmt=document.getElementById('globalFormat').value, gQ=document.getElementById('globalQuality').value, gBr=document.getElementById('globalBitrate').value, gFile=getFilename('globalFilenameTemplate','globalCustomFilename'), outputDir=document.getElementById('playlistOutputDir').value||settings.outputDir;
  checks.forEach(cb=>{
    const idx=parseInt(cb.dataset.idx), item=fetchedItems[idx];
    const ovType=document.querySelector(`.ov-type[data-idx="${idx}"]`)?.value||'', ovFmt=document.querySelector(`.ov-fmt[data-idx="${idx}"]`)?.value||'', ovQ=document.querySelector(`.ov-q[data-idx="${idx}"]`)?.value||'';
    pushJob(buildJob(item,{ type:ovType||gType, fmt:ovFmt||gFmt, quality:ovQ||gQ, bitrate:gBr, filename:gFile, outputDir, url:item.url||item.webpage_url||`https://www.youtube.com/watch?v=${item.id}` }));
  });
  toast(`Dodano ${checks.length} ${checks.length === 1 ? 'element' : 'elementów'} do kolejki`,'success'); goQueue();
}

function buildJob(item,opts) {
  return { id:`job-${Date.now()}-${Math.random().toString(36).slice(2,7)}`, title:item.title||item.id||'Bez tytułu', thumbnail:item.thumbnail||(item.thumbnails||[])[0]?.url||'', url:opts.url, audioOnly:opts.type==='audio', outputFormat:opts.fmt, quality:opts.quality, bitrate:opts.bitrate, outputDir:opts.outputDir, filename:opts.filename, status:'pending', progress:0, log:'' };
}
function getFilename(selId,inputId) { const v=document.getElementById(selId).value; return v==='custom'?document.getElementById(inputId).value.trim()||'%(title)s':v; }
function pushJob(job) { queue.push(job); renderQueue(); bumpBadge(); }
function goQueue() { switchTab('queue'); }

/* ─── Convert Tab ─── */
function initConvertTab() {
  document.getElementById('btnChooseFile').addEventListener('click', async()=>{ const f=await window.api.chooseFile(); if(f) setConvertInput(f); });
  document.getElementById('btnConvertBrowse').addEventListener('click', async()=>{ const d=await window.api.chooseFolder(); if(d) document.getElementById('convertOutputDir').value=d; });
  document.getElementById('btnConvert').addEventListener('click', runConvert);
  
  document.getElementById('convertFormat').addEventListener('change', e => {
    const isGif = e.target.value === 'gif';
    toggle('gifOptionsRow', isGif);
    toggle('convertResolutionWrap', !isGif);
    toggle('convertBitrateWrap', !isGif);
    toggle('convertVideoBitrateWrap', !isGif);
  });
}

function setConvertInput(path) {
  document.getElementById('convertInput').value = path;
  const zone = document.getElementById('convertDropZone');
  const name = path.split(/[/\\]/).pop();
  zone.classList.add('has-file');
  zone.innerHTML = `<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg><span>${escHtml(name)}</span><span class="drop-hint">Przeciągnij inny plik, aby go zastąpić</span>`;
}

/* ─── Drag & Drop ─── */
function initDragDrop() {
  const zone = document.getElementById('convertDropZone');
  const mediaExts = /\.(mp4|mkv|avi|mov|webm|mp3|wav|flac|aac|m4a|ogg|m4v|ts|wmv)$/i;

  zone.addEventListener('dragenter', e=>{ e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragover',  e=>{ e.preventDefault(); e.dataTransfer.dropEffect='copy'; zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', e=>{ if(!zone.contains(e.relatedTarget)) zone.classList.remove('drag-over'); });
  zone.addEventListener('drop', e=>{
    e.preventDefault(); zone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (!file) return;
    if (!mediaExts.test(file.name)) return toast('Rozszerzenie pliku nie jest obsługiwane','warning');
    // Electron gives us a real path via file.path
    const filePath = file.path || file.name;
    setConvertInput(filePath);
    // Switch to convert tab if not already there
    switchTab('convert');
    toast(`Wczytano plik: ${file.name}`,'success');
  });

  // Also allow dropping anywhere in the app to open convert tab
  document.addEventListener('dragover', e=>e.preventDefault());
  document.addEventListener('drop', e=>{
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file || !mediaExts.test(file.name)) return;
    const filePath = file.path || file.name;
    setConvertInput(filePath);
    switchTab('convert');
    toast(`Wczytano plik — gotowy do konwersji`,'success');
  });
}

async function runConvert() {
  const input=document.getElementById('convertInput').value;
  if(!input) return toast('Wybierz plik wejściowy','warning');
  const outputDir=document.getElementById('convertOutputDir').value||settings.outputDir, fmt=document.getElementById('convertFormat').value, resolution=document.getElementById('convertResolution').value, bitrate=document.getElementById('convertBitrate').value, vBitrate=document.getElementById('convertVideoBitrate').value;
  let name=document.getElementById('convertFilename').value.trim();
  if(!name) name=input.split(/[/\\]/).pop().replace(/\.[^.]+$/,'')+'_skonwertowany';
  const outputPath=`${outputDir}/${name}.${fmt}`;
  const wrap=document.getElementById('convertProgressWrap'), bar=document.getElementById('convertBar'), lbl=document.getElementById('convertLabel');
  wrap.classList.remove('hidden'); bar.style.width='5%'; lbl.textContent='Konwertowanie…';
  const btn=document.getElementById('btnConvert'); btn.disabled=true;
  
  const gifStart=document.getElementById('gifStart').value.trim();
  const gifDuration=parseInt(document.getElementById('gifDuration').value)||5;
  
  try {
    await window.api.convertFile({ id:`conv-${Date.now()}`, inputPath:input, outputPath, bitrate, videoBitrate:vBitrate, resolution, gifStart, gifDuration });
    bar.style.width='100%'; lbl.textContent='✓ Ukończono — '+outputPath; toast('Konwersja zakończona pomyślnie!','success');
    sysNotify('WavesConverter', `✓ Konwersja zakończona: ${name}.${fmt}`);
  } catch(e) { lbl.textContent='✗ Błąd: '+e.message; toast('Konwersja nie powiodła się','error'); }
  finally { btn.disabled=false; }
}

/* ─── Queue Tab ─── */
function initQueueTab() {
  document.getElementById('btnStartQueue').addEventListener('click', startQueue);
  document.getElementById('btnPauseQueue').addEventListener('click', pauseQueue);
  document.getElementById('btnClearDone').addEventListener('click', ()=>{ queue=queue.filter(j=>!['done','error','cancelled'].includes(j.status)); renderQueue(); bumpBadge(); });
  document.getElementById('btnClearAll').addEventListener('click', ()=>{ queue.filter(j=>j.status==='downloading').forEach(j=>window.api.cancelDownload(j.id)); queue=[]; renderQueue(); bumpBadge(); });
}

function renderQueue() {
  const list=document.getElementById('queueList');
  if(!queue.length) { list.innerHTML=`<div class="empty-queue"><svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3" cy="6" r="1" fill="currentColor"/><circle cx="3" cy="12" r="1" fill="currentColor"/><circle cx="3" cy="18" r="1" fill="currentColor"/></svg><p>Kolejka jest pusta</p><span>Dodaj wideo z zakładki Pobierz · <kbd style="font-size:10px;padding:1px 5px;background:rgba(124,58,237,0.15);border:1px solid rgba(168,85,247,0.25);border-radius:4px;color:#a78bfa">${isMac ? '⌘1' : 'Ctrl+1'}</kbd> aby tam przejść</span></div>`; updateQueueStats(); return; }
  list.innerHTML='';
  queue.forEach(job=>{
    const div=document.createElement('div'); div.className=`qitem ${job.status}`; div.id=`qitem-${job.id}`;
    const tags=[job.audioOnly?'🎵 Audio':'🎬 Wideo',(job.outputFormat||'?').toUpperCase(),job.quality&&!job.audioOnly?job.quality:'',job.bitrate||''].filter(Boolean).join(' · ');
    const actions=[];
    if(job.status==='downloading') actions.push(`<button class="btn-ghost-sm danger" onclick="cancelJob('${job.id}')">Anuluj</button>`);
    if(job.status==='done') actions.push(`<button class="btn-ghost-sm" onclick="openJobFolder('${escAttr(job.outputDir)}')">Otwórz folder</button>`);
    if(['error','cancelled'].includes(job.status)) actions.push(`<button class="btn-ghost-sm" onclick="retryJob('${job.id}')">Ponów</button>`);
    if(['pending','error','cancelled'].includes(job.status)) actions.push(`<button class="btn-ghost-sm danger" onclick="removeJob('${job.id}')">Usuń</button>`);
    div.innerHTML=`<div class="qitem-header">${job.thumbnail?`<img class="qitem-thumb" src="${job.thumbnail}" onerror="this.style.display='none'" alt="">`:'<div class="qitem-thumb"></div>'}<div class="qitem-info"><div class="qitem-title">${escHtml(job.title)}</div><div class="qitem-meta"><span class="qbadge ${job.status}">${translateStatus(job.status)}</span><span class="qitem-tags">${escHtml(tags)}</span></div></div><div class="qitem-actions">${actions.join('')}</div></div>
    ${['downloading','done'].includes(job.status)?`<div class="qitem-prog"><div class="qprog-bar"><div class="qprog-fill" style="width:${job.progress}%"></div></div><div class="qprog-label"><span>${job.status==='done'?'Ukończono':job.progress.toFixed(1)+'%'}</span></div></div>`:''}
    ${job.status==='error'?`<div class="qitem-error">⚠ ${escHtml(job.error||'Nieznany błąd')}</div>`:''}
    ${job.status==='downloading'?`<div class="qitem-log" id="log-${job.id}">${escHtml(job.log)}</div>`:''}`;
    list.appendChild(div);
  });
  updateQueueStats();
}

function updateQueueStats() {
  const done=queue.filter(j=>j.status==='done').length, pending=queue.filter(j=>j.status==='pending').length, total=queue.length;
  document.getElementById('queueStats').textContent=total?`${done}/${total} ukończono · ${pending} oczekuje`:'';
}

function bumpBadge() {
  const badge=document.getElementById('queueBadge');
  badge.textContent=queue.filter(j=>!['done','cancelled'].includes(j.status)).length;
  badge.classList.remove('bump'); void badge.offsetWidth; badge.classList.add('bump');
}

async function startQueue() {
  if(qRunning) return; qPaused=false; qRunning=true; processQueue();
}

function pauseQueue() {
  qPaused=!qPaused;
  const btn=document.getElementById('btnPauseQueue');
  btn.innerHTML=qPaused?`<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21"/></svg> Wznów`:`<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> Wstrzymaj`;
}

async function processQueue() {
  while(qRunning) {
    if(qPaused) { await sleep(400); continue; }
    const maxC=parseInt(settings.concurrent)||2, activeCount=queue.filter(j=>j.status==='downloading').length;
    if(activeCount>=maxC) { await sleep(400); continue; }
    const next=queue.find(j=>j.status==='pending');
    if(!next) { if(!queue.some(j=>j.status==='downloading')) { qRunning=false; break; } await sleep(400); continue; }
    next.status='downloading'; renderQueue(); bumpBadge();
    window.api.startDownload(next).then((res)=>{
      next.status='done'; next.progress=100;
      next.size = res?.size || 0;
      next.filePath = res?.path || '';
      renderQueue(); bumpBadge();
      toast(`✓ ${next.title}`,'success');
      sysNotify('Pobieranie zakończone', next.title);
      addToHistory(next);
    }).catch(e=>{
      next.status='error'; next.error=e.message; renderQueue(); bumpBadge();
      toast(`✗ ${next.title}`,'error');
      sysNotify('Pobieranie nie powiodło się', next.title);
    });
    await sleep(200);
  }
}

window.cancelJob=id=>{ const j=queue.find(x=>x.id===id); if(j){ window.api.cancelDownload(id); j.status='cancelled'; renderQueue(); bumpBadge(); } };
window.removeJob=id=>{ queue=queue.filter(x=>x.id!==id); renderQueue(); bumpBadge(); };
window.retryJob=id=>{ const j=queue.find(x=>x.id===id); if(j){ j.status='pending'; j.progress=0; j.log=''; j.error=''; renderQueue(); if(!qRunning) startQueue(); } };
window.openJobFolder=dir=>window.api.openFolder(dir);

/* ─── History Tab ─── */
function initHistoryTab() {
  document.getElementById('btnClearHistory').addEventListener('click', ()=>{
    if(!downloadHistory.length) return;
    downloadHistory=[]; saveHistory(); renderHistory();
    toast('Historia wyczyszczona','info');
  });
}

function addToHistory(job) {
  const entry = {
    id: job.id,
    title: job.title,
    thumbnail: job.thumbnail,
    outputFormat: job.outputFormat,
    quality: job.quality,
    audioOnly: job.audioOnly,
    outputDir: job.outputDir,
    filePath: job.filePath || '',
    size: job.size || 0,
    date: new Date().toISOString()
  };
  downloadHistory.unshift(entry);
  if(downloadHistory.length > 200) downloadHistory = downloadHistory.slice(0,200);
  saveHistory(); renderHistory();
}

function renderHistory() {
  updateStatsDashboard();
  const list = document.getElementById('historyList');
  const badge = document.getElementById('historyBadge');
  if(!downloadHistory.length) {
    list.innerHTML=`<div class="empty-history"><svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 15"/></svg><p>Brak pobrań</p><span>Ukończone pobrania pojawią się tutaj</span></div>`;
    badge.style.display='none';
    document.getElementById('historyStats').textContent='';
    return;
  }
  badge.style.display='inline-flex';
  badge.textContent = downloadHistory.length > 99 ? '99+' : downloadHistory.length;
  document.getElementById('historyStats').textContent = `${downloadHistory.length} ${downloadHistory.length===1?'pobranie':'pobrań'}`;
  list.innerHTML='';
  downloadHistory.forEach(entry=>{
    const div=document.createElement('div'); div.className='hitem';
    const tags=[entry.audioOnly?'🎵 Audio':'🎬 Wideo',(entry.outputFormat||'?').toUpperCase(),entry.quality&&!entry.audioOnly?entry.quality:''].filter(Boolean).join(' · ');
    const dateStr=fmtDate(entry.date);
    div.innerHTML=`${entry.thumbnail?`<img class="hitem-thumb" src="${entry.thumbnail}" onerror="this.style.display='none'" alt="">`:'<div class="hitem-thumb"></div>'}
      <div class="hitem-info">
        <div class="hitem-title">${escHtml(entry.title)}</div>
        <div class="hitem-meta"><span>${escHtml(tags)}</span><span>${escHtml(entry.outputDir||'')}</span></div>
      </div>
      <div class="hitem-date">${escHtml(dateStr)}</div>
      <button class="btn-ghost-sm" onclick="window.api.openFolder('${escAttr(entry.outputDir)}')">Otwórz</button>
      <button class="btn-ghost-sm" style="margin-left: 6px;" onclick="shareFile('${escAttr(entry.filePath || '')}', '${escAttr(entry.title || '')}', '${escAttr(entry.outputDir || '')}', '${escAttr(entry.outputFormat || 'mp4')}')">📲 Wyślij na telefon</button>`;
    list.appendChild(div);
  });
}

function saveHistory() { try{ localStorage.setItem('wc2_history',JSON.stringify(downloadHistory)); }catch(_){} }
function loadHistory() { try{ const h=localStorage.getItem('wc2_history'); if(h) downloadHistory=JSON.parse(h); }catch(_){} }

/* ─── Settings Tab ─── */
function initSettingsTab() {
  document.getElementById('btnSettingsDir').addEventListener('click', async()=>{ const d=await window.api.chooseFolder(); if(d) document.getElementById('settingsDir').value=d; });
  document.getElementById('btnSaveSettings').addEventListener('click', saveAndApply);
  
  // Komunikat o brakujących bibliotekach obok czerwonych kropek
  const prompt = document.getElementById('installPrompt');
  if (prompt) {
    prompt.addEventListener('click', () => {
      switchTab('settings');
      runInstallTools();
    });
  }

  document.getElementById('btnCheckUpdate').addEventListener('click', async()=>{
    const stxt = document.getElementById('updateStatusText');
    stxt.textContent = 'Sprawdzanie…';
    try {
      const res = await window.api.checkUpdate();
      if (res) {
        if (res.type === 'dev') stxt.textContent = 'Aktualizacje działają tylko w wersji produkcyjnej';
        else if (res.type === 'error') stxt.textContent = 'Błąd aktualizacji: ' + (res.message || 'Nieznany błąd');
      }
    } catch (e) {
      stxt.textContent = 'Błąd aktualizacji: ' + e.message;
    }
  });
  document.getElementById('btnInstallUpdate').addEventListener('click', ()=>window.api.installUpdate());
  document.getElementById('btnInstallTools').addEventListener('click', runInstallTools);
  document.getElementById('settingsDir').value=settings.outputDir;
  document.getElementById('settingsConcurrent').value=settings.concurrent;
  document.getElementById('settingsVideoFormat').value=settings.videoFormat;
  document.getElementById('settingsAudioFormat').value=settings.audioFormat;
  document.getElementById('settingsQuality').value=settings.quality;
  document.getElementById('settingsFilename').value=settings.filenameTemplate;
  const sa = document.getElementById('settingsAnimations');
  if (sa) sa.value = settings.animations || 'yes';
}

async function runInstallTools() {
  const btn = document.getElementById('btnInstallTools');
  const wrap = document.getElementById('sysInstallProgressWrap');
  const bar = document.getElementById('sysInstallProgressBar');
  const lbl = document.getElementById('sysInstallProgressLabel');
  
  btn.disabled = true;
  wrap.classList.remove('hidden');
  bar.style.background = '';
  bar.style.width = '5%';
  lbl.textContent = 'Rozpoczynanie instalacji...';
  
  try {
    await window.api.installTools();
    bar.style.width = '100%';
    lbl.textContent = 'Narzędzia zainstalowane pomyślnie! ✓';
    toast('Narzędzia zainstalowane pomyślnie!', 'success');
    await checkStatus();
  } catch (e) {
    bar.style.width = '100%';
    bar.style.background = 'var(--danger)';
    lbl.textContent = 'Instalacja nie powiodła się: ' + e.message;
    toast('Instalacja nie powiodła się: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

function saveAndApply() {
  settings.outputDir=document.getElementById('settingsDir').value;
  settings.concurrent=document.getElementById('settingsConcurrent').value;
  settings.videoFormat=document.getElementById('settingsVideoFormat').value;
  settings.audioFormat=document.getElementById('settingsAudioFormat').value;
  settings.quality=document.getElementById('settingsQuality').value;
  settings.filenameTemplate=document.getElementById('settingsFilename').value;
  const sa = document.getElementById('settingsAnimations');
  if (sa) settings.animations = sa.value;
  saveSettings(); applySettings(); toast('Ustawienia zapisane','success');
}

function applySettings() {
  ['singleOutputDir','playlistOutputDir','convertOutputDir'].forEach(id=>{ const el=document.getElementById(id); if(el&&!el.value) el.value=settings.outputDir; });
  const sd=document.getElementById('settingsDir'); if(sd) sd.value=settings.outputDir;
  const sa = document.getElementById('settingsAnimations');
  if (sa) sa.value = settings.animations || 'yes';
  document.body.classList.toggle('no-animations', settings.animations === 'no');
}
function saveSettings() { try{ localStorage.setItem('wc2_settings',JSON.stringify(settings)); }catch(_){} }
function loadSettings() { try{ const s=localStorage.getItem('wc2_settings'); if(s) Object.assign(settings,JSON.parse(s)); }catch(_){} }

/* Onboarding Animations Selectors */
let welcomeSelectedAnim = 'yes';
window.selectWelcomeAnim = function(anim) {
  welcomeSelectedAnim = anim;
  const yesCard = document.getElementById('welcomeAnimYes');
  const noCard = document.getElementById('welcomeAnimNo');
  if (anim === 'yes') {
    if (yesCard) yesCard.classList.add('active');
    if (noCard) noCard.classList.remove('active');
    document.body.classList.remove('no-animations');
  } else {
    if (yesCard) yesCard.classList.remove('active');
    if (noCard) noCard.classList.add('active');
    document.body.classList.add('no-animations');
  }
};

window.closeWelcomeOnboarding = function() {
  settings.animations = welcomeSelectedAnim;
  saveSettings();
  applySettings();
  localStorage.setItem('wc2_first_launch', 'false');
  const overlay = document.getElementById('welcomeOverlay');
  if (overlay) {
    overlay.classList.add('out');
    setTimeout(() => {
      overlay.classList.add('hidden');
    }, 300);
  }
  toast('Ustawienia zapisane!', 'success');
};

/* ─── IPC ─── */
function initIpc() {
  window.api.onProgress(({id,progress})=>{ const j=queue.find(x=>x.id===id); if(!j) return; j.progress=progress; const f=document.querySelector(`#qitem-${id} .qprog-fill`); if(f) f.style.width=progress+'%'; const l=document.querySelector(`#qitem-${id} .qprog-label span`); if(l) l.textContent=progress.toFixed(1)+'%'; });
  window.api.onLog(({id,line})=>{ const j=queue.find(x=>x.id===id); if(j) j.log=line; const el=document.getElementById(`log-${id}`); if(el) el.textContent=line; });
  window.api.onConvertProgress(({time})=>{ const l=document.getElementById('convertLabel'); if(l) l.textContent=`Konwertowanie… ${time}`; const b=document.getElementById('convertBar'); if(b){ const c=parseFloat(b.style.width)||5; if(c<90) b.style.width=(c+1.5)+'%'; } });
  window.api.onUpdateStatus(info=>{
    const pill=document.getElementById('updatePill');
    const txt=document.getElementById('updatePillText');
    const btn=document.getElementById('btnInstallUpdate');
    const stxt=document.getElementById('updateStatusText');
    
    if(info.type==='available') {
      pill.classList.remove('hidden');
      txt.textContent=`Wykryto v${info.version}`;
      btn.textContent='Pobieranie aktualizacji...';
      btn.disabled=true;
    }
    if(info.type==='downloading') {
      pill.classList.remove('hidden');
      btn.textContent=`Pobieranie… ${info.percent}%`;
      btn.disabled=true;
      if (stxt) stxt.textContent=`Pobieranie aktualizacji… ${info.percent}%`;
    }
    if(info.type==='ready') {
      pill.classList.remove('hidden');
      txt.textContent=`Aktualizacja v${info.version} gotowa!`;
      btn.textContent='Zainstaluj i uruchom ponownie';
      btn.disabled=false;
      toast(`Aktualizacja v${info.version} jest gotowa. Kliknij "Zainstaluj i uruchom ponownie", aby zaktualizować aplikację.`, 'success');
    }
    if(info.type==='latest' && stxt) stxt.textContent="Używasz najnowszej wersji ✓";
    if(info.type==='error') {
      if (stxt) stxt.textContent='Błąd aktualizacji: '+info.message;
      toast('Błąd aktualizacji: '+info.message, 'error');
    }
    if(info.type==='dev' && stxt) stxt.textContent='Aktualizacje działają tylko w wersji produkcyjnej';
  });
  window.api.onInstallStatus(({ status, progress, message }) => {
    const bar = document.getElementById('sysInstallProgressBar');
    const lbl = document.getElementById('sysInstallProgressLabel');
    if (bar) bar.style.width = progress + '%';
    if (lbl) lbl.textContent = message;
  });
}

/* ─── Helpers ─── */
function escHtml(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function escAttr(s){ return String(s||'').replace(/'/g,"\\'").replace(/\\/g,'\\\\'); }
function fmtDur(s){ if(!s) return ''; const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=Math.floor(s%60); return h?`${h}:${p(m)}:${p(sec)}`:`${m}:${p(sec)}`; function p(n){return String(n).padStart(2,'0');} }
function fmtN(n){ if(!n) return ''; if(n>=1e9) return (n/1e9).toFixed(1)+'B'; if(n>=1e6) return (n/1e6).toFixed(1)+'M'; if(n>=1e3) return (n/1e3).toFixed(1)+'K'; return String(n); }
function fmtDate(iso){ try{ const d=new Date(iso); const now=new Date(); const diff=now-d; if(diff<60000) return 'Przed chwilą'; if(diff<3600000) return Math.floor(diff/60000)+'m temu'; if(diff<86400000) return Math.floor(diff/3600000)+'g temu'; if(diff<604800000) return Math.floor(diff/86400000)+'dni temu'; return d.toLocaleDateString(); }catch(_){ return ''; } }
function capFirst(s){ return s?s[0].toUpperCase()+s.slice(1):''; }
function translateStatus(s) {
  const m = { pending: 'Oczekuje', downloading: 'Pobieranie', done: 'Ukończono', error: 'Błąd', cancelled: 'Anulowano' };
  return m[s] || s;
}
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
function show(id){ document.getElementById(id).classList.remove('hidden'); }
function hide(id){ document.getElementById(id).classList.add('hidden'); }

function updateStatsDashboard() {
  const statFiles = document.getElementById('statFiles');
  const statSize = document.getElementById('statSize');
  const statTime = document.getElementById('statTime');
  if (!statFiles || !statSize || !statTime) return;

  const totalFiles = downloadHistory.length;
  statFiles.textContent = totalFiles;

  let totalBytes = 0;
  downloadHistory.forEach(item => {
    totalBytes += (item.size || 0);
  });
  
  if (totalBytes === 0) {
    statSize.textContent = '0 MB';
  } else if (totalBytes >= 1e9) {
    statSize.textContent = (totalBytes / 1e9).toFixed(1) + ' GB';
  } else {
    statSize.textContent = (totalBytes / 1e6).toFixed(1) + ' MB';
  }

  const savedMinutes = Math.round((totalFiles * 30) / 60);
  statTime.textContent = savedMinutes === 0 ? '< 1 min' : `${savedMinutes} min`;
}

window.shareFile = async (filePath, title, outputDir, ext) => {
  let path = filePath;
  if (!path && outputDir && title) {
    const isWin = navigator.platform.toLowerCase().includes('win') || navigator.userAgent.toLowerCase().includes('win');
    const separator = isWin ? '\\' : '/';
    const cleanTitle = title.replace(/[<>:"/\\|?*]/g, '_');
    path = outputDir + separator + cleanTitle + '.' + ext;
  }
  
  const overlay = document.getElementById('shareOverlay');
  const qrImage = document.getElementById('shareQrImage');
  const qrLoading = document.getElementById('shareQrLoading');
  const urlText = document.getElementById('shareUrlText');
  
  if (!overlay || !qrImage || !qrLoading || !urlText) return;
  
  qrImage.style.display = 'none';
  qrLoading.style.display = 'block';
  qrLoading.textContent = 'Generowanie kodu QR…';
  urlText.textContent = 'Trwa uruchamianie serwera…';
  overlay.classList.remove('hidden');
  
  try {
    const res = await window.api.startShareServer({ filePath: path, fileName: title + '.' + ext });
    if (res && res.qrDataUrl && res.shareUrl) {
      qrImage.src = res.qrDataUrl;
      qrImage.style.display = 'block';
      qrLoading.style.display = 'none';
      urlText.textContent = res.shareUrl;
    } else {
      throw new Error('Nie otrzymano kodu QR');
    }
  } catch (err) {
    qrLoading.textContent = 'Błąd uruchamiania serwera ✗';
    urlText.textContent = err.message || 'Nieznany błąd';
  }
};

async function closeShareModal() {
  await window.api.stopShareServer();
  const overlay = document.getElementById('shareOverlay');
  if (overlay) overlay.classList.add('hidden');
}

const btnStopShare = document.getElementById('btnStopShare');
if (btnStopShare) {
  btnStopShare.addEventListener('click', closeShareModal);
}

const btnShareClose = document.getElementById('btnShareClose');
if (btnShareClose) {
  btnShareClose.addEventListener('click', closeShareModal);
}

const shareOverlay = document.getElementById('shareOverlay');
if (shareOverlay) {
  shareOverlay.addEventListener('click', (e) => {
    if (e.target === shareOverlay) {
      closeShareModal();
    }
  });
}
