'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const Busboy = require('busboy');

const {
  cleanupJob,
  configured,
  missingEnv,
  createPresignedUpload,
  createUploadSession,
  getObjectBuffer,
  isInputKey,
  isValidJobId
} = require('./lib/r2');
const {
  gridShape,
  parseSettings,
  processInputGroups,
  naturalCompare,
  isSupportedInput
} = require('./lib/processor');
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT) || 3000;
const ROOT = path.join(__dirname, 'public');

const MAX_FILES = Number(process.env.MAX_FILES) || 60;
const MAX_FILE_SIZE = Number(process.env.MAX_FILE_SIZE) || 25 * 1024 * 1024;
const MAX_TOTAL_SIZE = Number(process.env.MAX_TOTAL_SIZE) || 500 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.psd': 'image/vnd.adobe.photoshop',
  '.psb': 'application/octet-stream',
  '.zip': 'application/zip'
};

function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function statusForError(err) {
  const message = String(err && err.message ? err.message : err);
  if (message.includes('R2 belum')) return 503;
  if (
    message.includes('Format tidak didukung') ||
    message.includes('Tidak ada gambar') ||
    message.includes('Ukuran') ||
    message.includes('Terlalu banyak') ||
    message.includes('Gagal membaca') ||
    message.includes('tidak diizinkan') ||
    message.includes('belum dipilih') ||
    message.includes('multipart') ||
    message.includes('JSON') ||
    message.includes('Job ID') ||
    message.includes('Objek')
  ) return 400;
  return 500;
}

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const contentType = String(req.headers['content-type'] || '');
    if (!contentType.startsWith('multipart/form-data')) {
      reject(new Error('Content-Type harus multipart/form-data.'));
      return;
    }

    let parser;
    try {
      parser = Busboy({
        headers: req.headers,
        limits: {
          files: MAX_FILES + 1,
          fileSize: MAX_FILE_SIZE,
          fields: 40,
          parts: MAX_FILES + 50
        }
      });
    } catch (err) {
      reject(err);
      return;
    }

    const fields = {};
    const files = [];
    let total = 0;
    let limitError = null;

    parser.on('field', (name, value) => {
      fields[name] = value;
    });

    parser.on('file', (name, stream, info) => {
      const isFolderFile = name.startsWith('file:');
      if (name !== 'files' && !isFolderFile) {
        stream.resume();
        return;
      }

      let relativePath = info.filename || 'file';
      if (isFolderFile) {
        try { relativePath = decodeURIComponent(name.slice(5)); }
        catch (err) { relativePath = info.filename || 'file'; }
      }
      relativePath = String(relativePath).replace(/\\/g, '/');
      const basename = path.basename(relativePath) || 'file';

      const chunks = [];
      stream.on('limit', () => {
        limitError = 'Ukuran file melebihi batas: ' + basename;
      });
      stream.on('data', (chunk) => {
        chunks.push(chunk);
        total += chunk.length;
        if (total > MAX_TOTAL_SIZE) limitError = 'Total ukuran gambar melebihi batas.';
      });
      stream.on('end', () => {
        if (files.length >= MAX_FILES) {
          limitError = 'Terlalu banyak file gambar.';
          return;
        }
        files.push({
          name: basename,
          relativePath,
          mime: info.mimeType || 'application/octet-stream',
          buffer: Buffer.concat(chunks)
        });
      });
    });

    parser.on('filesLimit', () => { limitError = 'Terlalu banyak file gambar.'; });
    parser.on('fieldsLimit', () => { limitError = 'Terlalu banyak field.'; });
    parser.on('partsLimit', () => { limitError = 'Terlalu banyak bagian dalam request.'; });
    parser.on('error', reject);
    parser.on('finish', () => {
      if (limitError) reject(new Error(limitError));
      else resolve({ fields, files });
    });

    req.pipe(parser);
  });
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    const contentType = String(req.headers['content-type'] || '');
    if (!contentType.startsWith('application/json')) {
      reject(new Error('Content-Type harus application/json.'));
      return;
    }

    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > 1024 * 1024) {
        reject(new Error('Body JSON terlalu besar.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('error', reject);
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (err) {
        reject(new Error('JSON tidak valid.'));
      }
    });
  });
}

function normalizeUploadedInputs(payload) {
  const jobId = String(payload.jobId || '');
  if (!isValidJobId(jobId)) throw new Error('Job ID tidak valid.');

  const raw = Array.isArray(payload.inputs) ? payload.inputs : [];
  if (!raw.length) throw new Error('Tidak ada gambar yang dikirim.');
  if (raw.length > MAX_FILES) throw new Error('Terlalu banyak file gambar.');

  return raw.map((item) => {
    if (!isInputKey(jobId, item.key)) throw new Error('Objek upload tidak valid.');
    const name = path.basename(String(item.name || 'file'));
    const relativePath = String(item.relativePath || name).replace(/\\/g, '/');
    const size = Math.trunc(Number(item.size));
    if (!Number.isFinite(size) || size < 0 || size > MAX_FILE_SIZE) {
      throw new Error('Ukuran file melebihi batas: ' + name);
    }
    return { key: item.key, name, relativePath, size };
  });
}

async function handlePresign(req, res) {
  try {
    if (!configured()) {
      sendJson(res, 503, { error: 'Cloudflare R2 belum dikonfigurasi.', missing: missingEnv() });
      return;
    }

    const payload = await parseJsonBody(req);
    const raw = Array.isArray(payload.files) ? payload.files : [];
    if (!raw.length) throw new Error('Tidak ada gambar yang dikirim.');
    if (raw.length > MAX_FILES) throw new Error('Terlalu banyak file gambar.');

    let total = 0;
    const files = raw.map((item) => {
      const name = path.basename(String(item.name || 'file'));
      const size = Math.trunc(Number(item.size));
      if (!Number.isFinite(size) || size < 0 || size > MAX_FILE_SIZE) {
        throw new Error('Ukuran file melebihi batas: ' + name);
      }
      total += size;
      return {
        name,
        relativePath: String(item.relativePath || name).replace(/\\/g, '/'),
        size
      };
    });
    if (total > MAX_TOTAL_SIZE) throw new Error('Total ukuran gambar melebihi batas.');

    const rejected = files.filter((item) => !isSupportedInput(item.name));
    if (rejected.length) {
      throw new Error('Format tidak didukung: ' + rejected.map((item) => item.name).join(', '));
    }

    const result = await createPresignedUpload(files);
    sendJson(res, 200, result);
  } catch (err) {
    console.error('[presign] gagal: ' + (err && err.stack ? err.stack : err));
    if (!res.writableEnded && !res.destroyed) {
      sendJson(res, statusForError(err), { error: err && err.message ? err.message : String(err) });
    }
  }
}

async function handleUploadCleanup(req, res) {
  try {
    if (!configured()) {
      sendJson(res, 503, { error: 'Cloudflare R2 belum dikonfigurasi.', missing: missingEnv() });
      return;
    }
    const payload = await parseJsonBody(req);
    const result = await cleanupJob(payload.jobId);
    sendJson(res, 200, result);
  } catch (err) {
    console.error('[upload-cleanup] gagal: ' + (err && err.stack ? err.stack : err));
    if (!res.writableEnded && !res.destroyed) {
      sendJson(res, statusForError(err), { error: err && err.message ? err.message : String(err) });
    }
  }
}

async function handleProcess(req, res) {
  let session = null;

  try {
    if (!configured()) {
      sendJson(res, 503, {
        error: 'Cloudflare R2 belum dikonfigurasi.',
        missing: missingEnv()
      });
      return;
    }

    const started = Date.now();
    const contentType = String(req.headers['content-type'] || '');
    const fromR2 = contentType.startsWith('application/json');
    let fields;
    let inputs;
    let jobId;

    if (fromR2) {
      const payload = await parseJsonBody(req);
      const uploaded = normalizeUploadedInputs(payload);
      jobId = String(payload.jobId);
      session = createUploadSession(jobId, uploaded.map((item) => item.key));
      fields = payload.settings || payload.fields || payload;
      inputs = [];
      let total = 0;

      for (const item of uploaded) {
        const buffer = await getObjectBuffer(item.key);
        if (buffer.length > MAX_FILE_SIZE) {
          throw new Error('Ukuran file melebihi batas: ' + item.name);
        }
        total += buffer.length;
        if (total > MAX_TOTAL_SIZE) throw new Error('Total ukuran gambar melebihi batas.');
        inputs.push({ name: item.name, relativePath: item.relativePath, buffer });
      }
    } else {
      const parsed = await parseMultipart(req);
      fields = parsed.fields;
      inputs = parsed.files;
    }

    inputs = inputs.slice()
      .sort((a, b) => naturalCompare(a.relativePath || a.name, b.relativePath || b.name));

    if (!inputs.length) throw new Error('Tidak ada gambar yang dikirim.');

    const rejected = inputs.filter((item) => !isSupportedInput(item.name));
    if (rejected.length) {
      throw new Error('Format tidak didukung: ' + rejected.map((item) => item.name).join(', '));
    }

    const settings = parseSettings(fields);
    const grid = settings.grid_mode === 'count' ? gridShape(settings.image_count, settings.direction) : null;

    if (!fromR2) {
      session = createUploadSession();
      jobId = session.jobId;
      for (let i = 0; i < inputs.length; i++) {
        await session.put('input', String(i + 1).padStart(3, '0') + '-' + inputs[i].name, inputs[i].buffer);
      }
    }

    const result = await processInputGroups(inputs, settings, {
      report(message) {
        console.log('[' + jobId + '] ' + message);
      },
      async onCombined(name, buffer) {
        await session.put('combined', name, buffer);
      },
      async onOutput(name, buffer) {
        await session.put('output', name, buffer);
      }
    });

    const zipBuffer = result.zipBuffer;
    const cleaned = await session.cleanup();
    session = null;

    if (res.writableEnded || res.destroyed) return;

    res.writeHead(200, {
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="smartstitch_slices.zip"',
      'Content-Length': zipBuffer.length,
      'Cache-Control': 'no-store',
      'X-Job-Id': jobId,
      'X-Processed-Slices': String(result.outputs.length),
      'X-Grid-Mode': settings.grid_mode,
      'X-Grid-Shape': grid ? grid.rows + 'x' + grid.cols : '',
      'X-Input-Dirs': String(result.stats.groups),
      'X-Process-Ms': String(Date.now() - started),
      'X-R2-Deleted': String(cleaned.deleted),
      'X-R2-Cleanup-Failed': String(cleaned.failed)
    });
    res.end(zipBuffer);
  } catch (err) {
    console.error('[process] gagal: ' + (err && err.stack ? err.stack : err));
    if (session) {
      try { await session.cleanup(); } catch (cleanupErr) { console.error('[r2] cleanup darurat gagal: ' + cleanupErr.message); }
    }
    if (res.writableEnded || res.destroyed) return;
    sendJson(res, statusForError(err), {
      error: err && err.message ? err.message : String(err)
    });
  }
}

function serveStatic(req, res, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad request');
    return;
  }

  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const file = path.resolve(ROOT, relative);

  if (!file.startsWith(ROOT + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
}

function createApp() {
  const server = http.createServer((req, res) => {
    let urlPath = '/';
    try {
      urlPath = (req.url || '/').split('?')[0];
    } catch (err) {
      sendJson(res, 400, { error: 'Bad request' });
      return;
    }

    if (urlPath === '/api/config') {
      if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'Gunakan GET untuk /api/config.' });
        return;
      }
      sendJson(res, 200, { filename: { prefixMaxLength: 40, startMax: 999999 } });
      return;
    }

    if (urlPath === '/api/presign') {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'Gunakan POST untuk /api/presign.' });
        return;
      }
      handlePresign(req, res);
      return;
    }

    if (urlPath === '/api/upload-cleanup') {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'Gunakan POST untuk /api/upload-cleanup.' });
        return;
      }
      handleUploadCleanup(req, res);
      return;
    }

    if (urlPath === '/api/process') {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'Gunakan POST untuk /api/process.' });
        return;
      }
      handleProcess(req, res);
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { error: 'Method tidak diizinkan.' });
      return;
    }

    serveStatic(req, res, urlPath);
  });

  server.requestTimeout = 15 * 60 * 1000;
  server.headersTimeout = 60 * 1000;
  server.keepAliveTimeout = 30 * 1000;
  return server;
}

module.exports = {
  createApp,
  handlePresign,
  handleProcess,
  handleUploadCleanup,
  parseMultipart,
  sendJson,
  serveStatic,
  statusForError
};

if (require.main === module) {
  createApp().listen(PORT, HOST, () => {
    console.log('SmartStitch Web running at http://' + HOST + ':' + PORT);
    if (configured()) console.log('Cloudflare R2: ready (bucket ' + process.env.R2_BUCKET + ')');
    else console.log('Cloudflare R2: not configured. Set ' + missingEnv().join(', ') + '.');
  });
}
