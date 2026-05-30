let queue=[], fetchedItems=[], isPlaylist=false, qRunning=false, qPaused=false;
let settings={ outputDir:'', concurrent:2, videoFormat:'mp4', audioFormat:'mp3', quality:'best', filenameTemplate:'%(title)s' };

window.addEventListener('DOMContentLoaded', async () => {
  settings.outputDir = await window.api.getDefaultDir();
  loadSettings();
  initWindowControls(); initTabs(); initDownloadTab(); initConvertTab(); initQueueTab(); initSettingsTab(); initIpc();
  checkStatus(); renderQueue(); applySettings();
  const v = await window.api.getVersion().catch(()=>'1.0.0');
  document.getElementById('versionTag').textContent = 'v'+v;
});

function initWindowControls() {
  document.getElementById('btnMin').onclick   = () => window.api.minimize();
  document.getElementById('btnMax').onclick   = () => window.api.maximize();
  document.getElementById('btnClose').onclick = () => window.api.close();
  window.api.onWindowState(s => { document.getElementById('btnMax').title = s==='maximized'?'Restore':'Maximize'; });
}

function initTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c=>c.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('tab-'+tab.dataset.tab).classList.add('active');
    });
  });
}

function toast(msg, type='info') {
  const stack = document.getElementById('toastStack');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<div class="toast-dot"></div><span>${escHtml(msg)}</span>`;
  stack.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(()=>el.remove(), 280); }, 3200);
}

async function checkStatus() {
  const [hasYt, hasFf] = await Promise.all([window.api.checkYtdlp(), window.api.checkFfmpeg()]);
  const yt = document.getElementById('statusYtdlp'), ff = document.getElementById('statusFfmpeg');
  yt.textContent = hasYt?'✓ Installed':'✗ Not found'; yt.className=`sys-val ${hasYt?'ok':'missing'}`;
  ff.textContent = hasFf?'✓ Installed':'✗ Not found'; ff.className=`sys-val ${hasFf?'ok':'missing'}`;
  const ind = document.getElementById('statusIndicators'); ind.innerHTML='';
  [['yt-dlp',hasYt],['ffmpeg',hasFf]].forEach(([name,ok])=>{
    const d=document.createElement('div'); d.className=`si ${ok?'ok':'missing'}`; d.title=`${name}: ${ok?'OK':'Not found'}`; ind.appendChild(d);
  });
}

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
  if(!url) return toast('Enter a URL first','warning');
  const btn=document.getElementById('btnFetch');
  btn.disabled=true;
  btn.querySelector('.btn-fetch-text').textContent='Fetching…';
  btn.querySelector('.btn-fetch-icon').innerHTML='<div class="spinner"></div>';
  hide('singleSection'); hide('playlistSection');
  try {
    const items = await window.api.fetchInfo(url);
    fetchedItems=items;
    if(items.length===1){ isPlaylist=false; renderSingle(items[0]); }
    else { isPlaylist=true; renderPlaylist(items); }
  } catch(e) { toast('Error: '+e.message,'error'); }
  finally {
    btn.disabled=false;
    btn.querySelector('.btn-fetch-text').textContent='Fetch';
    btn.querySelector('.btn-fetch-icon').innerHTML='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>';
  }
}

function renderSingle(item) {
  const hero=document.getElementById('videoHero');
  const thumb=item.thumbnail||(item.thumbnails||[])[0]?.url||'';
  const dur=item.duration?fmtDur(item.duration):'';
  hero.innerHTML=`${thumb?`<img class="vh-thumb" src="${thumb}" onerror="this.style.display='none'" alt="">`:'<div class="vh-thumb-placeholder"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="7" width="20" height="13" rx="2"/></svg></div>'}
    <div class="vh-info"><div class="vh-title">${escHtml(item.title||item.id)}</div><div class="vh-meta">
    ${item.uploader?`<span class="vh-chip">👤 ${escHtml(item.uploader)}</span>`:''}
    ${dur?`<span class="vh-chip">⏱ ${dur}</span>`:''}
    ${item.view_count?`<span class="vh-chip">👁 ${fmtN(item.view_count)}</span>`:''}
    </div></div>`;
  show('singleSection');
  document.getElementById('singleOutputDir').value=settings.outputDir;
  updateSingleType('video');
}

function renderPlaylist(items) {
  document.getElementById('playlistName').textContent=items[0]?.playlist_title||items[0]?.playlist||'Playlist';
  document.getElementById('playlistSub').textContent=`${items.length} videos`;
  const cont=document.getElementById('playlistItems'); cont.innerHTML='';
  items.forEach((item,idx)=>{
    const thumb=item.thumbnail||(item.thumbnails||[])[0]?.url||'';
    const dur=item.duration?fmtDur(item.duration):'';
    const div=document.createElement('div'); div.className='pitem selected'; div.dataset.idx=idx;
    div.innerHTML=`<input type="checkbox" class="pcheck" data-idx="${idx}" checked>
      <span class="pitem-num">${idx+1}</span>
      ${thumb?`<img class="pitem-thumb" src="${thumb}" onerror="this.style.display='none'" alt="">`:''}
      <div class="pitem-info"><div class="pitem-title">${escHtml(item.title||item.id)}</div>${dur?`<div class="pitem-dur">⏱ ${dur}</div>`:''}</div>
      <div class="pitem-overrides">
        <select class="ov-type" data-idx="${idx}" title="Type"><option value="">↑ global</option><option value="video">Video</option><option value="audio">Audio</option></select>
        <select class="ov-fmt" data-idx="${idx}" title="Format"><option value="">↑ global</option><option value="mp4">MP4</option><option value="mkv">MKV</option><option value="mp3">MP3</option><option value="wav">WAV</option><option value="flac">FLAC</option></select>
        <select class="ov-q" data-idx="${idx}" title="Quality"><option value="">↑ global</option><option value="best">Best</option><option value="1080p">1080p</option><option value="720p">720p</option><option value="480p">480p</option></select>
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
  if(!fetchedItems.length) return toast('Fetch a video first','warning');
  const item=fetchedItems[0], type=getPillVal('singleTypePills');
  pushJob(buildJob(item,{ type, fmt:document.getElementById('singleFormat').value, quality:document.getElementById('singleQuality').value, bitrate:document.getElementById('singleBitrate').value, filename:getFilename('singleFilenameTemplate','singleCustomFilename'), outputDir:document.getElementById('singleOutputDir').value||settings.outputDir, url:item.url||item.webpage_url||document.getElementById('urlInput').value.trim() }));
  toast('Added to queue','success'); goQueue();
}

function addPlaylistToQueue() {
  const checks=[...document.querySelectorAll('.pcheck')].filter(c=>c.checked);
  if(!checks.length) return toast('Select at least one video','warning');
  const gType=getPillVal('globalTypePills'), gFmt=document.getElementById('globalFormat').value, gQ=document.getElementById('globalQuality').value, gBr=document.getElementById('globalBitrate').value, gFile=getFilename('globalFilenameTemplate','globalCustomFilename'), outputDir=document.getElementById('playlistOutputDir').value||settings.outputDir;
  checks.forEach(cb=>{
    const idx=parseInt(cb.dataset.idx), item=fetchedItems[idx];
    const ovType=document.querySelector(`.ov-type[data-idx="${idx}"]`)?.value||'', ovFmt=document.querySelector(`.ov-fmt[data-idx="${idx}"]`)?.value||'', ovQ=document.querySelector(`.ov-q[data-idx="${idx}"]`)?.value||'';
    pushJob(buildJob(item,{ type:ovType||gType, fmt:ovFmt||gFmt, quality:ovQ||gQ, bitrate:gBr, filename:gFile, outputDir, url:item.url||item.webpage_url||`https://www.youtube.com/watch?v=${item.id}` }));
  });
  toast(`Added ${checks.length} item${checks.length>1?'s':''} to queue`,'success'); goQueue();
}

function buildJob(item,opts) {
  return { id:`job-${Date.now()}-${Math.random().toString(36).slice(2,7)}`, title:item.title||item.id||'Untitled', thumbnail:item.thumbnail||(item.thumbnails||[])[0]?.url||'', url:opts.url, audioOnly:opts.type==='audio', outputFormat:opts.fmt, quality:opts.quality, bitrate:opts.bitrate, outputDir:opts.outputDir, filename:opts.filename, status:'pending', progress:0, log:'' };
}
function getFilename(selId,inputId) { const v=document.getElementById(selId).value; return v==='custom'?document.getElementById(inputId).value.trim()||'%(title)s':v; }
function pushJob(job) { queue.push(job); renderQueue(); bumpBadge(); }
function goQueue() { document.querySelector('[data-tab="queue"]').click(); }

function initConvertTab() {
  document.getElementById('btnChooseFile').addEventListener('click', async()=>{ const f=await window.api.chooseFile(); if(f) document.getElementById('convertInput').value=f; });
  document.getElementById('btnConvertBrowse').addEventListener('click', async()=>{ const d=await window.api.chooseFolder(); if(d) document.getElementById('convertOutputDir').value=d; });
  document.getElementById('btnConvert').addEventListener('click', runConvert);
}

async function runConvert() {
  const input=document.getElementById('convertInput').value;
  if(!input) return toast('Select an input file','warning');
  const outputDir=document.getElementById('convertOutputDir').value||settings.outputDir, fmt=document.getElementById('convertFormat').value, resolution=document.getElementById('convertResolution').value, bitrate=document.getElementById('convertBitrate').value, vBitrate=document.getElementById('convertVideoBitrate').value;
  let name=document.getElementById('convertFilename').value.trim();
  if(!name) name=input.split('/').pop().replace(/\.[^.]+$/,'')+'_converted';
  const outputPath=`${outputDir}/${name}.${fmt}`;
  const wrap=document.getElementById('convertProgressWrap'), bar=document.getElementById('convertBar'), lbl=document.getElementById('convertLabel');
  wrap.classList.remove('hidden'); bar.style.width='5%'; lbl.textContent='Converting…';
  const btn=document.getElementById('btnConvert'); btn.disabled=true;
  try {
    await window.api.convertFile({ id:`conv-${Date.now()}`, inputPath:input, outputPath, bitrate, videoBitrate:vBitrate, resolution });
    bar.style.width='100%'; lbl.textContent='✓ Done — '+outputPath; toast('Conversion complete!','success');
  } catch(e) { lbl.textContent='✗ Error: '+e.message; toast('Conversion failed','error'); }
  finally { btn.disabled=false; }
}

function initQueueTab() {
  document.getElementById('btnStartQueue').addEventListener('click', startQueue);
  document.getElementById('btnPauseQueue').addEventListener('click', pauseQueue);
  document.getElementById('btnClearDone').addEventListener('click', ()=>{ queue=queue.filter(j=>!['done','error','cancelled'].includes(j.status)); renderQueue(); bumpBadge(); });
  document.getElementById('btnClearAll').addEventListener('click', ()=>{ queue.filter(j=>j.status==='downloading').forEach(j=>window.api.cancelDownload(j.id)); queue=[]; renderQueue(); bumpBadge(); });
}

function renderQueue() {
  const list=document.getElementById('queueList');
  if(!queue.length) { list.innerHTML=`<div class="empty-queue"><svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3" cy="6" r="1" fill="currentColor"/><circle cx="3" cy="12" r="1" fill="currentColor"/><circle cx="3" cy="18" r="1" fill="currentColor"/></svg><p>Queue is empty</p><span>Add videos from the Download tab</span></div>`; updateQueueStats(); return; }
  list.innerHTML='';
  queue.forEach(job=>{
    const div=document.createElement('div'); div.className=`qitem ${job.status}`; div.id=`qitem-${job.id}`;
    const tags=[job.audioOnly?'🎵 Audio':'🎬 Video',(job.outputFormat||'?').toUpperCase(),job.quality&&!job.audioOnly?job.quality:'',job.bitrate||''].filter(Boolean).join(' · ');
    const actions=[];
    if(job.status==='downloading') actions.push(`<button class="btn-ghost-sm danger" onclick="cancelJob('${job.id}')">Cancel</button>`);
    if(job.status==='done') actions.push(`<button class="btn-ghost-sm" onclick="openJobFolder('${escHtml(job.outputDir)}')">Open Folder</button>`);
    if(['error','cancelled'].includes(job.status)) actions.push(`<button class="btn-ghost-sm" onclick="retryJob('${job.id}')">Retry</button>`);
    if(['pending','error','cancelled'].includes(job.status)) actions.push(`<button class="btn-ghost-sm danger" onclick="removeJob('${job.id}')">Remove</button>`);
    div.innerHTML=`<div class="qitem-header">${job.thumbnail?`<img class="qitem-thumb" src="${job.thumbnail}" onerror="this.style.display='none'" alt="">`:'<div class="qitem-thumb"></div>'}<div class="qitem-info"><div class="qitem-title">${escHtml(job.title)}</div><div class="qitem-meta"><span class="qbadge ${job.status}">${capFirst(job.status)}</span><span class="qitem-tags">${escHtml(tags)}</span></div></div><div class="qitem-actions">${actions.join('')}</div></div>
    ${['downloading','done'].includes(job.status)?`<div class="qitem-prog"><div class="qprog-bar"><div class="qprog-fill" style="width:${job.progress}%"></div></div><div class="qprog-label"><span>${job.status==='done'?'Complete':job.progress.toFixed(1)+'%'}</span></div></div>`:''}
    ${job.status==='error'?`<div class="qitem-error">⚠ ${escHtml(job.error||'Unknown error')}</div>`:''}
    ${job.status==='downloading'?`<div class="qitem-log" id="log-${job.id}">${escHtml(job.log)}</div>`:''}`;
    list.appendChild(div);
  });
  updateQueueStats();
}

function updateQueueStats() {
  const done=queue.filter(j=>j.status==='done').length, pending=queue.filter(j=>j.status==='pending').length, total=queue.length;
  document.getElementById('queueStats').textContent=total?`${done}/${total} done · ${pending} pending`:'';
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
  btn.innerHTML=qPaused?`<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21"/></svg> Resume`:`<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> Pause`;
}

async function processQueue() {
  while(qRunning) {
    if(qPaused) { await sleep(400); continue; }
    const maxC=parseInt(settings.concurrent)||2, active=queue.filter(j=>j.status==='downloading').length;
    if(active>=maxC) { await sleep(400); continue; }
    const next=queue.find(j=>j.status==='pending');
    if(!next) { if(!queue.some(j=>j.status==='downloading')) { qRunning=false; break; } await sleep(400); continue; }
    next.status='downloading'; renderQueue(); bumpBadge();
    window.api.startDownload(next).then(()=>{ next.status='done'; next.progress=100; renderQueue(); bumpBadge(); toast(`✓ ${next.title}`,'success'); }).catch(e=>{ next.status='error'; next.error=e.message; renderQueue(); bumpBadge(); toast(`✗ ${next.title}`,'error'); });
    await sleep(200);
  }
}

window.cancelJob=id=>{ const j=queue.find(x=>x.id===id); if(j){ window.api.cancelDownload(id); j.status='cancelled'; renderQueue(); bumpBadge(); } };
window.removeJob=id=>{ queue=queue.filter(x=>x.id!==id); renderQueue(); bumpBadge(); };
window.retryJob=id=>{ const j=queue.find(x=>x.id===id); if(j){ j.status='pending'; j.progress=0; j.log=''; j.error=''; renderQueue(); if(!qRunning) startQueue(); } };
window.openJobFolder=dir=>window.api.openFolder(dir);

function initSettingsTab() {
  document.getElementById('btnSettingsDir').addEventListener('click', async()=>{ const d=await window.api.chooseFolder(); if(d) document.getElementById('settingsDir').value=d; });
  document.getElementById('btnSaveSettings').addEventListener('click', saveAndApply);
  document.getElementById('btnCheckUpdate').addEventListener('click', async()=>{ document.getElementById('updateStatusText').textContent='Checking…'; await window.api.checkUpdate(); });
  document.getElementById('btnInstallUpdate').addEventListener('click', ()=>window.api.installUpdate());
  document.getElementById('settingsDir').value=settings.outputDir;
  document.getElementById('settingsConcurrent').value=settings.concurrent;
  document.getElementById('settingsVideoFormat').value=settings.videoFormat;
  document.getElementById('settingsAudioFormat').value=settings.audioFormat;
  document.getElementById('settingsQuality').value=settings.quality;
  document.getElementById('settingsFilename').value=settings.filenameTemplate;
}

function saveAndApply() {
  settings.outputDir=document.getElementById('settingsDir').value;
  settings.concurrent=document.getElementById('settingsConcurrent').value;
  settings.videoFormat=document.getElementById('settingsVideoFormat').value;
  settings.audioFormat=document.getElementById('settingsAudioFormat').value;
  settings.quality=document.getElementById('settingsQuality').value;
  settings.filenameTemplate=document.getElementById('settingsFilename').value;
  saveSettings(); applySettings(); toast('Settings saved','success');
}

function applySettings() {
  ['singleOutputDir','playlistOutputDir','convertOutputDir'].forEach(id=>{ const el=document.getElementById(id); if(el&&!el.value) el.value=settings.outputDir; });
  const sd=document.getElementById('settingsDir'); if(sd) sd.value=settings.outputDir;
}
function saveSettings() { try{ localStorage.setItem('wc2_settings',JSON.stringify(settings)); }catch(_){} }
function loadSettings() { try{ const s=localStorage.getItem('wc2_settings'); if(s) Object.assign(settings,JSON.parse(s)); }catch(_){} }

function initIpc() {
  window.api.onProgress(({id,progress})=>{ const j=queue.find(x=>x.id===id); if(!j) return; j.progress=progress; const f=document.querySelector(`#qitem-${id} .qprog-fill`); if(f) f.style.width=progress+'%'; const l=document.querySelector(`#qitem-${id} .qprog-label span`); if(l) l.textContent=progress.toFixed(1)+'%'; });
  window.api.onLog(({id,line})=>{ const j=queue.find(x=>x.id===id); if(j) j.log=line; const el=document.getElementById(`log-${id}`); if(el) el.textContent=line; });
  window.api.onConvertProgress(({time})=>{ const l=document.getElementById('convertLabel'); if(l) l.textContent=`Converting… ${time}`; const b=document.getElementById('convertBar'); if(b){ const c=parseFloat(b.style.width)||5; if(c<90) b.style.width=(c+1.5)+'%'; } });
  window.api.onUpdateStatus(info=>{
    const pill=document.getElementById('updatePill'), txt=document.getElementById('updatePillText'), stxt=document.getElementById('updateStatusText');
    if(info.type==='available'||info.type==='ready'){ pill.classList.remove('hidden'); txt.textContent=`v${info.version} ${info.type==='ready'?'ready':'available'}`; toast(`Update v${info.version} ${info.type==='ready'?'ready — click Install':'available'}`,info.type==='ready'?'success':'info'); }
    if(info.type==='latest') stxt.textContent="You're on the latest version ✓";
    if(info.type==='downloading') stxt.textContent=`Downloading update… ${info.percent}%`;
    if(info.type==='error') stxt.textContent='Update check failed: '+info.message;
    if(info.type==='dev') stxt.textContent='Updates only work in production builds';
  });
}

function escHtml(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function fmtDur(s){ if(!s) return ''; const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=Math.floor(s%60); return h?`${h}:${p(m)}:${p(sec)}`:`${m}:${p(sec)}`; function p(n){return String(n).padStart(2,'0');} }
function fmtN(n){ if(!n) return ''; if(n>=1e9) return (n/1e9).toFixed(1)+'B'; if(n>=1e6) return (n/1e6).toFixed(1)+'M'; if(n>=1e3) return (n/1e3).toFixed(1)+'K'; return String(n); }
function capFirst(s){ return s?s[0].toUpperCase()+s.slice(1):''; }
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
function show(id){ document.getElementById(id).classList.remove('hidden'); }
function hide(id){ document.getElementById(id).classList.add('hidden'); }
