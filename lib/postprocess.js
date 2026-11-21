'use strict';

const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const DEFAULT_WHITELIST = {
  optimizer: {
    command: path.join(__dirname, '..', 'bin', 'optimizer'),
    args: []
  }
};

function whitelist() {
  const raw = process.env.POSTPROCESS_WHITELIST || '';
  if (!raw) return DEFAULT_WHITELIST;
  try {
    const value = JSON.parse(raw);
    if (!value || Array.isArray(value) || typeof value !== 'object') return {};
    return value;
  } catch (err) {
    console.error('[postprocess] POSTPROCESS_WHITELIST tidak valid: ' + err.message);
    return {};
  }
}

function allowedApps() {
  return Object.keys(whitelist());
}

function commandFor(key) {
  const entry = whitelist()[String(key)];
  if (!entry) return null;
  if (typeof entry === 'string') return { command: entry, args: [] };
  if (entry && typeof entry === 'object' && typeof entry.command === 'string') {
    return {
      command: entry.command,
      args: Array.isArray(entry.args) ? entry.args.map(String) : []
    };
  }
  return null;
}

function safeSegment(value) {
  return path.basename(String(value || ''))
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 120) || 'job';
}

async function createWorkDir(jobId) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'smartstitch-' + safeSegment(jobId) + '-'));
  await fsp.mkdir(path.join(dir, 'combined'), { recursive: true });
  await fsp.mkdir(path.join(dir, 'output'), { recursive: true });
  return dir;
}

async function writeWorkFile(workDir, kind, relativeName, buffer) {
  const sub = kind === 'combined' ? 'combined' : 'output';
  const relative = String(relativeName || 'file')
    .replace(/\\/g, '/')
    .split('/')
    .map(safeSegment)
    .join('/');
  const file = path.join(workDir, sub, relative);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, buffer);
  return file;
}

function parseArgs(text) {
  const source = String(text || '');
  if (source.length > 4000) throw new Error('Argumen pasca-pemrosesan terlalu panjang.');

  const out = [];
  let current = '';
  let quote = null;
  let started = false;

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === '\\' && quote === '"' && i + 1 < source.length) current += source[++i];
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (started) {
        out.push(current);
        current = '';
        started = false;
      }
      continue;
    }
    current += ch;
    started = true;
  }
  if (started) out.push(current);
  if (out.length > 64) throw new Error('Argumen pasca-pemrosesan terlalu banyak.');
  if (out.some((value) => value.indexOf('\0') !== -1)) {
    throw new Error('Argumen pasca-pemrosesan mengandung karakter tidak valid.');
  }
  return out;
}

function substituteArgs(args, workDir) {
  const stitched = path.join(workDir, 'combined');
  const processed = path.join(workDir, 'output');
  return args.map((value) => value
    .split('[stitched]').join(stitched)
    .split('[processed]').join(processed));
}

function runPostprocess(appKey, argText, workDir, report) {
  const resolved = commandFor(appKey);
  if (!resolved) return Promise.reject(new Error('Aplikasi pasca-pemrosesan tidak diizinkan.'));

  let args;
  try {
    args = resolved.args.concat(substituteArgs(parseArgs(argText), workDir));
  } catch (err) {
    return Promise.reject(err);
  }

  const timeout = Number(process.env.POSTPROCESS_TIMEOUT_MS) || 60000;
  const maxOutput = Number(process.env.POSTPROCESS_MAX_OUTPUT) || 1048576;

  return new Promise((resolve, reject) => {
    const child = spawn(resolved.command, args, {
      cwd: workDir,
      shell: false,
      windowsHide: true,
      env: process.env
    });
    let stdout = '';
    let stderr = '';
    let killed = false;
    let killReason = '';
    let settled = false;

    const fail = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    };

    const stop = (reason) => {
      if (killed) return;
      killed = true;
      killReason = reason;
      child.kill();
    };

    const timer = setTimeout(() => {
      stop('Pasca-pemrosesan melebihi batas waktu ' + timeout + ' ms.');
      fail(new Error(killReason));
    }, timeout);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
      if (stdout.length > maxOutput) stop('Output pasca-pemrosesan terlalu besar.');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
      if (stderr.length > maxOutput) stop('Output pasca-pemrosesan terlalu besar.');
    });
    child.on('error', (err) => {
      if (err && err.code === 'ENOENT') {
        fail(new Error('Aplikasi pasca-pemrosesan tidak ditemukan di server. Periksa path pada POSTPROCESS_WHITELIST.'));
        return;
      }
      fail(new Error('Gagal menjalankan pasca-pemrosesan: ' + err.message));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (killed) {
        fail(new Error(killReason || 'Pasca-pemrosesan dihentikan.'));
        return;
      }
      if (report) report('Pasca-pemrosesan selesai, kode keluar ' + code);
      if (code !== 0) {
        fail(new Error('Pasca-pemrosesan gagal (kode ' + code + '): ' + stderr.trim()));
        return;
      }
      if (settled) return;
      settled = true;
      resolve({
        exitCode: code,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        args
      });
    });
  });
}

async function readOutputFiles(workDir) {
  const root = path.join(workDir, 'output');
  const out = [];

  async function walk(dir, relative) {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const next = relative ? relative + '/' + entry.name : entry.name;
      if (entry.isDirectory()) await walk(full, next);
      else if (entry.isFile()) out.push({ name: next, buffer: await fsp.readFile(full) });
    }
  }

  await walk(root, '');
  return out;
}

async function cleanupWorkDir(workDir) {
  if (!workDir) return;
  await fsp.rm(workDir, { recursive: true, force: true });
}

module.exports = {
  allowedApps,
  cleanupWorkDir,
  createWorkDir,
  readOutputFiles,
  runPostprocess,
  writeWorkFile
};
