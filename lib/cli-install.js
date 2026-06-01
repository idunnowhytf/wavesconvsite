'use strict';

const { spawn } = require('child_process');

function run(cmd, args = []) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { shell: true, windowsHide: true });
    let out = '';
    let err = '';
    proc.stdout?.on('data', d => { out += d.toString(); });
    proc.stderr?.on('data', d => { err += d.toString(); });
    proc.on('error', reject);
    proc.on('close', code => {
      if (code === 0) resolve((out || err).trim());
      else reject(new Error((err || out || `Kod wyjścia ${code}`).trim().slice(0, 400)));
    });
  });
}

async function checkCliEnvironment() {
  const result = { node: null, npm: null, cli: null, cliInstalled: false };
  try {
    result.node = await run('node', ['--version']);
  } catch (e) {
    result.nodeError = e.message;
    return result;
  }
  try {
    result.npm = await run('npm', ['--version']);
  } catch (e) {
    result.npmError = e.message;
  }
  try {
    result.cli = await run('wavesconv', ['--version']);
    result.cliInstalled = true;
  } catch (_) {
    result.cliInstalled = false;
  }
  return result;
}

function installCliGlobal(onStatus) {
  const notify = (data) => { if (onStatus) onStatus(data); };
  return new Promise((resolve, reject) => {
    notify({ status: 'installing', message: 'Instalacja wavesconv z npm…', progress: 10 });
    const proc = spawn('npm', ['install', '-g', 'wavesconv@latest'], {
      shell: true,
      windowsHide: true,
    });
    let err = '';
    proc.stderr?.on('data', d => {
      err += d.toString();
      notify({ status: 'installing', message: d.toString().trim().slice(-80) || 'Instalowanie…', progress: 50 });
    });
    proc.stdout?.on('data', d => {
      notify({ status: 'installing', message: d.toString().trim().slice(-80) || 'Instalowanie…', progress: 70 });
    });
    proc.on('error', reject);
    proc.on('close', async code => {
      if (code !== 0) {
        reject(new Error(err.trim() || `npm zakończył się kodem ${code}`));
        return;
      }
      notify({ status: 'verifying', message: 'Sprawdzanie instalacji…', progress: 90 });
      try {
        const ver = await run('wavesconv', ['--version']);
        resolve({ success: true, version: ver });
      } catch (e) {
        reject(new Error('Instalacja zakończona, ale polecenie wavesconv nie działa. Uruchom terminal ponownie lub dodaj npm global bin do PATH.'));
      }
    });
  });
}

module.exports = { checkCliEnvironment, installCliGlobal, run };
