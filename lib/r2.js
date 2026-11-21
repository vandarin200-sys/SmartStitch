'use strict';

const crypto = require('crypto');
const path = require('path');
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const REQUIRED_ENV = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'];

let client = null;

function configured() {
  return REQUIRED_ENV.every((name) => Boolean(process.env[name])) || Boolean(process.env.R2_ENDPOINT && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET);
}

function missingEnv() {
  if (configured()) return [];
  if (process.env.R2_ENDPOINT) {
    return ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'].filter((name) => !process.env[name]);
  }
  return REQUIRED_ENV.filter((name) => !process.env[name]);
}

function getClient() {
  if (!configured()) throw new Error('R2 belum dikonfigurasi. Set ' + missingEnv().join(', ') + '.');
  if (client) return client;

  const endpoint = process.env.R2_ENDPOINT || 'https://' + process.env.R2_ACCOUNT_ID + '.r2.cloudflarestorage.com';
  client = new S3Client({
    endpoint,
    region: process.env.R2_REGION || 'auto',
    forcePathStyle: true,
    maxAttempts: 3,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
    }
  });
  return client;
}

function contentTypeOf(name) {
  const ext = path.extname(name).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.bmp') return 'image/bmp';
  if (ext === '.tif' || ext === '.tiff') return 'image/tiff';
  if (ext === '.tga') return 'image/x-tga';
  return 'application/octet-stream';
}

function safeName(name) {
  return path.basename(String(name || 'file'))
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 120) || 'file';
}

function isValidJobId(jobId) {
  return /^[A-Za-z0-9_-]{1,64}$/.test(String(jobId || ''));
}

function inputKeyFor(jobId, index, name) {
  return 'smartstitch/tmp/' + jobId + '/input/' + String(index + 1).padStart(3, '0') + '-' + safeName(name);
}

function isInputKey(jobId, key) {
  const prefix = 'smartstitch/tmp/' + jobId + '/input/';
  const value = String(key || '');
  return value.startsWith(prefix) && /^[0-9]{3}-[A-Za-z0-9._-]+$/.test(value.slice(prefix.length));
}

async function createPresignedUpload(files) {
  const s3 = getClient();
  const bucket = process.env.R2_BUCKET;
  if (!bucket) throw new Error('R2_BUCKET belum dikonfigurasi.');
  const expiresIn = Math.trunc(Number(process.env.R2_PRESIGN_EXPIRES)) || 900;
  const jobId = crypto.randomUUID();
  const uploads = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const key = inputKeyFor(jobId, i, file.name);
    const url = await getSignedUrl(s3, new PutObjectCommand({
      Bucket: bucket,
      Key: key
    }), { expiresIn });
    uploads.push({
      key,
      url,
      method: 'PUT',
      name: String(file.name || 'file'),
      relativePath: String(file.relativePath || file.name || 'file').replace(/\\/g, '/'),
      size: Math.trunc(Number(file.size)) || 0
    });
  }

  return { jobId, expiresIn, uploads };
}

async function getObjectBuffer(key) {
  const s3 = getClient();
  const bucket = process.env.R2_BUCKET;
  if (!bucket) throw new Error('R2_BUCKET belum dikonfigurasi.');
  const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const bytes = await object.Body.transformToByteArray();
  return Buffer.from(bytes);
}

async function cleanupJob(jobId) {
  if (!isValidJobId(jobId)) throw new Error('Job ID tidak valid.');
  const s3 = getClient();
  const bucket = process.env.R2_BUCKET;
  if (!bucket) throw new Error('R2_BUCKET belum dikonfigurasi.');
  const prefix = 'smartstitch/tmp/' + jobId + '/';
  let token = null;
  let deleted = 0;

  do {
    const listed = await s3.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken: token
    }));
    const objects = (listed.Contents || []).map((item) => ({ Key: item.Key }));
    if (objects.length) {
      await s3.send(new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: objects, Quiet: true }
      }));
      deleted += objects.length;
    }
    token = listed.NextContinuationToken || null;
  } while (token);

  return { deleted };
}

function createUploadSession(jobId, initialKeys) {
  const id = jobId || crypto.randomUUID();
  const bucket = process.env.R2_BUCKET;
  const prefix = 'smartstitch/tmp/' + id;
  const keys = Array.isArray(initialKeys) ? initialKeys.slice() : [];

  return {
    jobId: id,
    keys() {
      return keys.slice();
    },
    adopt(kind, name) {
      const key = prefix + '/' + safeName(kind) + '/' + safeName(name);
      if (!keys.includes(key)) keys.push(key);
      return key;
    },
    async put(kind, name, buffer) {
      const s3 = getClient();
      if (!bucket) throw new Error('R2_BUCKET belum dikonfigurasi.');
      const key = prefix + '/' + safeName(kind) + '/' + safeName(name);
      await s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: buffer,
        ContentType: contentTypeOf(name),
        CacheControl: 'no-store'
      }));
      keys.push(key);
      return key;
    },
    async cleanup() {
      if (!keys.length) return { deleted: 0, failed: 0 };
      const s3 = getClient();
      let deleted = 0;
      let failed = 0;

      for (let i = 0; i < keys.length; i += 500) {
        const batch = keys.slice(i, i + 500).map((key) => ({ Key: key }));
        try {
          await s3.send(new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: batch, Quiet: true }
          }));
          deleted += batch.length;
        } catch (err) {
          failed += batch.length;
          console.error('[r2] cleanup gagal untuk ' + batch.length + ' objek: ' + err.message);
        }
      }

      keys.length = 0;
      return { deleted, failed };
    }
  };
}

module.exports = {
  configured,
  missingEnv,
  cleanupJob,
  createPresignedUpload,
  createUploadSession,
  getObjectBuffer,
  inputKeyFor,
  isInputKey,
  isValidJobId
};
