'use strict';

const sharp = require('sharp');
const agPsd = require('ag-psd');

agPsd.initializeCanvas(
  () => { throw new Error('Canvas tidak tersedia.'); },
  (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) })
);

const FORMATS = new Set(['.png', '.jpg', '.webp', '.bmp', '.tiff', '.tga', '.psd', '.psb']);
const INPUT_FORMATS = new Set(['.png', '.jpg', '.jpeg', '.jfif', '.webp', '.bmp', '.tif', '.tiff', '.tga', '.psd', '.psb']);
const MAX_CANVAS_WIDTH = Number(process.env.MAX_CANVAS_WIDTH) || 16384;
const MAX_CANVAS_HEIGHT = Number(process.env.MAX_CANVAS_HEIGHT) || 32767;
const PSD_MEMORY_LIMIT = Number(process.env.MAX_PSD_MEMORY) || 512 * 1024 * 1024;

function naturalCompare(a, b) {
  const ax = /(\d+|\D+)/g;
  const bx = /(\d+|\D+)/g;
  const A = String(a).toLowerCase().match(ax);
  const B = String(b).toLowerCase().match(ax);
  for (let i = 0; i < Math.min(A.length, B.length); i++) {
    if (A[i] !== B[i]) {
      return /^\d/.test(A[i]) ? parseInt(A[i], 10) - parseInt(B[i], 10) : A[i] < B[i] ? -1 : 1;
    }
  }
  return A.length - B.length;
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function extensionOf(name) {
  const match = String(name).toLowerCase().match(/\.[^.]+$/);
  return match ? match[0] : '';
}

function isSupportedInput(name) {
  return INPUT_FORMATS.has(extensionOf(name));
}

function toRelativePath(value) {
  return String(value || 'file').replace(/\\/g, '/').replace(/^\.\//, '');
}

function groupInputsByDirectory(inputs) {
  const groups = new Map();
  for (const input of inputs) {
    const relative = toRelativePath(input.relativePath || input.name);
    const slash = relative.lastIndexOf('/');
    const dir = slash === -1 ? '' : relative.slice(0, slash);
    const name = slash === -1 ? relative : relative.slice(slash + 1);
    if (!name) continue;
    if (!groups.has(dir)) groups.set(dir, []);
    groups.get(dir).push(Object.assign({}, input, { name, relativePath: relative, dir }));
  }
  return Array.from(groups.entries())
    .sort((a, b) => naturalCompare(a[0] || '.', b[0] || '.'))
    .map(([dir, items]) => ({ dir, inputs: items }));
}

function joinRelative(dir, name) {
  return dir ? dir + '/' + name : name;
}

function parseSettings(raw) {
  let outputType = String(raw.outputType || raw.output_type || '.tga').toLowerCase();
  if (!outputType.startsWith('.')) outputType = '.' + outputType;
  if (outputType === '.jpeg') outputType = '.jpg';
  if (outputType === '.tif') outputType = '.tiff';
  if (!FORMATS.has(outputType)) outputType = '.tga';

  const enforceType = clampNumber(raw.enforce != null ? raw.enforce : raw.enforce_type, 0, 2, 2);
  const detectorType = clampNumber(raw.detector != null ? raw.detector : raw.detector_type, 0, 1, 1);
  const runPost = raw.runPost != null ? raw.runPost : raw.run_postprocess;
  const direction = String(raw.direction || raw.orientation || 'vertical').toLowerCase() === 'horizontal'
    ? 'horizontal'
    : 'vertical';
  const gridMode = String(raw.gridMode || raw.grid_mode || 'custom').toLowerCase() === 'count'
    ? 'count'
    : 'custom';

  return {
    direction,
    grid_mode: gridMode,
    image_count: Math.trunc(clampNumber(raw.imageCount != null ? raw.imageCount : raw.image_count, 1, 1000, 4)),
    output_type: outputType,
    lossy_quality: clampNumber(raw.quality != null ? raw.quality : raw.lossy_quality, 1, 100, 100),
    split_height: Math.trunc(clampNumber(raw.height != null ? raw.height : raw.split_height, 1, 999999999, 5000)),
    enforce_type: Math.trunc(enforceType),
    enforce_width: Math.trunc(clampNumber(raw.customWidth != null ? raw.customWidth : raw.enforce_width, 1, 999999999, 720)),
    detector_type: Math.trunc(detectorType),
    senstivity: clampNumber(raw.sensitivity != null ? raw.sensitivity : raw.senstivity, 1, 100, 90),
    scan_step: Math.trunc(clampNumber(raw.scanStep != null ? raw.scanStep : raw.scan_step, 1, 25, 5)),
    ignorable_pixels: Math.trunc(clampNumber(raw.ignoreMargin != null ? raw.ignoreMargin : raw.ignorable_pixels, 0, 999999, 5)),
    run_postprocess: runPost === true || runPost === 'true' || runPost === '1' || runPost === 'on'
  };
}

function pad(n, len) {
  let s = String(n);
  while (s.length < len) s = '0' + s;
  return s;
}

function uniqueSorted(values) {
  values.sort((a, b) => a - b);
  return values.filter((v, i) => i === 0 || v !== values[i - 1]);
}

function directSlices(height, splitHeight) {
  const out = [0];
  let y = splitHeight;
  while (y < height) {
    out.push(y);
    y += splitHeight;
  }
  if (out[out.length - 1] !== height - 1) out.push(height - 1);
  return uniqueSorted(out);
}

function gridShape(count, direction) {
  const n = Math.trunc(clampNumber(count, 1, 1000, 4));
  const vertical = String(direction || 'vertical') !== 'horizontal';
  let best = null;

  for (let smaller = 1; smaller * smaller <= n; smaller++) {
    if (n % smaller !== 0) continue;
    if (smaller === 1 && n > 2) continue;
    const larger = n / smaller;
    const diff = larger - smaller;
    if (!best || diff < best.diff) best = { smaller, larger, diff };
  }

  let rows;
  let cols;
  if (best) {
    rows = vertical ? best.larger : best.smaller;
    cols = vertical ? best.smaller : best.larger;
  } else {
    const side = Math.max(1, Math.round(Math.sqrt(n)));
    const other = Math.ceil(n / side);
    rows = vertical ? other : side;
    cols = vertical ? side : other;
  }

  const columnsPerRow = [];
  let remaining = n;
  for (let row = 0; row < rows; row++) {
    const rowCols = Math.ceil(remaining / (rows - row));
    columnsPerRow.push(rowCols);
    remaining -= rowCols;
  }

  return {
    rows,
    cols: Math.max.apply(null, columnsPerRow),
    columnsPerRow,
    exact: Boolean(best),
    count: n
  };
}

const CRC_TABLE = (function () {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function zipStore(entries) {
  const parts = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = Buffer.isBuffer(entry.buffer) ? entry.buffer : Buffer.from(entry.buffer);
    const crc = crc32(data);
    const size = data.length;

    if (size > 0xFFFFFFFF || offset > 0xFFFFFFFF) throw new Error('Ukuran ZIP melebihi batas 4 GB.');

    const local = Buffer.alloc(30 + name.length);
    const lv = new DataView(local.buffer, local.byteOffset, local.byteLength);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint16(8, 0, true);
    lv.setUint16(10, 0, true);
    lv.setUint16(12, 0, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    name.copy(local, 30);

    const center = Buffer.alloc(46 + name.length);
    const cv = new DataView(center.buffer, center.byteOffset, center.byteLength);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    name.copy(center, 46);

    parts.push(local, data);
    central.push(center);
    offset += local.length + data.length;
  }

  const centralSize = central.reduce((sum, item) => sum + item.length, 0);
  const end = Buffer.alloc(22);
  const ev = new DataView(end.buffer, end.byteOffset, end.byteLength);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  return Buffer.concat(parts.concat(central, [end]));
}

async function encodeTga(buffer) {
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const width = info.width;
  const height = info.height;
  if (width > 0xFFFF || height > 0xFFFF) {
    throw new Error('TGA hanya mendukung dimensi sampai 65535 piksel.');
  }

  const header = Buffer.alloc(18);
  header[2] = 2;
  header.writeUInt16LE(width, 12);
  header.writeUInt16LE(height, 14);
  header[16] = 24;
  header[17] = 0;

  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    const src = (height - 1 - y) * width * 4;
    const dst = y * width * 3;
    for (let x = 0; x < width; x++) {
      const p = src + x * 4;
      const q = dst + x * 3;
      pixels[q] = data[p + 2];
      pixels[q + 1] = data[p + 1];
      pixels[q + 2] = data[p];
    }
  }
  return Buffer.concat([header, pixels]);
}

async function encodeSlice(buffer, format, quality) {
  if (format === '.tga') return encodeTga(buffer);
  if (format === '.psd' || format === '.psb') return encodePsdLike(buffer, format === '.psb');

  let pipeline = sharp(buffer);
  if (format === '.jpg') pipeline = pipeline.jpeg({ quality, mozjpeg: true });
  else if (format === '.webp') pipeline = pipeline.webp({ quality });
  else if (format === '.bmp') pipeline = pipeline.bmp();
  else if (format === '.tiff') pipeline = pipeline.tiff({ quality });
  else pipeline = pipeline.png({ compressionLevel: 6 });
  return pipeline.toBuffer();
}

function raw8BitBuffer(imageData) {
  const data = imageData.data;
  if (data instanceof Uint8Array || data instanceof Uint8ClampedArray) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  }
  const out = Buffer.alloc(imageData.width * imageData.height * 4);
  if (data instanceof Uint16Array) {
    for (let i = 0; i < out.length; i++) out[i] = data[i] >>> 8;
    return out;
  }
  if (data instanceof Float32Array) {
    for (let i = 0; i < out.length; i++) {
      out[i] = Math.max(0, Math.min(255, Math.round(data[i] * 255)));
    }
    return out;
  }
  throw new Error('Format piksel PSD tidak didukung.');
}

async function decodePsd(buffer, name) {
  let psd;
  try {
    psd = agPsd.readPsd(buffer, {
      useRawData: true,
      skipLayerImageData: true,
      skipThumbnail: true,
      skipLinkedFilesData: true,
      imageResourcesWhitelist: [],
      totalMemoryLimit: PSD_MEMORY_LIMIT
    });
  } catch (err) {
    throw new Error('PSD tidak terbaca: ' + err.message);
  }
  if (!psd.width || !psd.height) throw new Error('Dimensi PSD tidak terbaca.');
  if (psd.width > MAX_CANVAS_WIDTH || psd.height > MAX_CANVAS_HEIGHT) {
    throw new Error('PSD terlalu besar (' + psd.width + '×' + psd.height + '). Batas server ' + MAX_CANVAS_WIDTH + '×' + MAX_CANVAS_HEIGHT + '.');
  }
  let imageData;
  try {
    imageData = agPsd.getCompositeImageData(psd);
  } catch (err) {
    throw new Error('Gagal mendekode gambar PSD: ' + err.message);
  }
  if (!imageData || !imageData.data || imageData.width !== psd.width || imageData.height !== psd.height) {
    throw new Error('PSD tidak memiliki gambar gabungan.');
  }
  return sharp(raw8BitBuffer(imageData), {
    raw: { width: psd.width, height: psd.height, channels: 4 }
  }).png().toBuffer();
}

async function encodePsdLike(buffer, psb) {
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const imageData = {
    width: info.width,
    height: info.height,
    data: Buffer.from(data)
  };
  const document = {
    width: info.width,
    height: info.height,
    imageData,
    children: [{ name: 'Background', imageData }]
  };
  return agPsd.writePsdBuffer(document, { psb });
}

async function normalizeInputs(inputs, report) {
  const normalized = [];
  for (const input of inputs) {
    try {
      const ext = extensionOf(input.name);
      const source = ext === '.psd' || ext === '.psb'
        ? await decodePsd(input.buffer, input.name)
        : input.buffer;
      const buffer = await sharp(source, { limitInputPixels: false }).png().toBuffer();
      const meta = await sharp(buffer).metadata();
      if (!meta.width || !meta.height) throw new Error('Dimensi gambar tidak terbaca.');
      normalized.push({ name: input.name, buffer, width: meta.width, height: meta.height });
    } catch (err) {
      throw new Error('Gagal membaca ' + input.name + ': ' + err.message);
    }
  }
  normalized.sort((a, b) => naturalCompare(a.name, b.name));
  report('Dimuat ' + normalized.length + ' gambar dan diurutkan secara natural.');
  return normalized;
}

async function alignSecondToFirst(inputs, report) {
  const first = inputs[0];
  const second = inputs[1];
  if (first.width === second.width && first.height === second.height) return inputs;

  const buffer = await sharp(second.buffer)
    .resize({ width: first.width, height: first.height, fit: 'cover', position: 'centre' })
    .png()
    .toBuffer();
  report('Auto-fit 2 gambar: ' + second.name + ' disamakan ke ' + first.width + '×' + first.height + ' mengikuti ' + first.name + '.');
  return [first, Object.assign({}, second, { buffer, width: first.width, height: first.height })];
}

async function resizeImages(inputs, settings, report) {
  if (settings.enforce_type === 0) return inputs.slice();

  const horizontal = settings.direction === 'horizontal';
  const primary = horizontal ? 'height' : 'width';
  const secondary = horizontal ? 'width' : 'height';
  const sizes = inputs.map((item) => item[primary]);
  const target = settings.enforce_type === 2
    ? Math.max(1, settings.enforce_width)
    : Math.min.apply(null, sizes);
  const out = [];

  for (const item of inputs) {
    if (item[primary] === target) {
      out.push(item);
      continue;
    }
    const opposite = Math.floor((item[secondary] / item[primary]) * target);
    if (opposite <= 0) {
      report('Gambar dilewati karena ' + secondary + ' resize menjadi 0: ' + item.name);
      continue;
    }
    const width = horizontal ? opposite : target;
    const height = horizontal ? target : opposite;
    const buffer = await sharp(item.buffer)
      .resize({ width, height, fit: 'fill' })
      .png()
      .toBuffer();
    out.push({ name: item.name, buffer, width, height });
  }

  const label = horizontal ? 'tinggi' : 'lebar';
  const autoLabel = horizontal ? 'tinggi terkecil' : 'lebar terkecil';
  report('Samakan ' + label + ' ke ' + target + 'px (' + (settings.enforce_type === 2 ? 'manual' : 'otomatis / ' + autoLabel) + ')');
  return out;
}

async function combineImages(inputs, settings, report) {
  const horizontal = settings.direction === 'horizontal';
  const width = horizontal
    ? inputs.reduce((sum, item) => sum + item.width, 0)
    : Math.max.apply(null, inputs.map((item) => item.width));
  const height = horizontal
    ? Math.max.apply(null, inputs.map((item) => item.height))
    : inputs.reduce((sum, item) => sum + item.height, 0);

  if (width > MAX_CANVAS_WIDTH || height > MAX_CANVAS_HEIGHT) {
    throw new Error('Gambar gabungan terlalu besar (' + width + '×' + height + '). Batas server ' + MAX_CANVAS_WIDTH + '×' + MAX_CANVAS_HEIGHT + '.');
  }

  let offset = 0;
  const composite = inputs.map((item) => {
    const placement = horizontal
      ? { input: item.buffer, left: offset, top: 0 }
      : { input: item.buffer, left: 0, top: offset };
    offset += horizontal ? item.width : item.height;
    return placement;
  });

  const buffer = await sharp({
    create: { width, height, channels: 3, background: { r: 0, g: 0, b: 0 } }
  })
    .composite(composite)
    .png()
    .toBuffer();

  report('Gabungkan ' + inputs.length + ' gambar → ' + width + '×' + height + (horizontal ? ' (horizontal)' : ' (vertikal)'));
  return { buffer, width, height };
}

async function pixelSlices(combined, settings, report) {
  const { data, info } = await sharp(combined.buffer, { limitInputPixels: false })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const horizontal = settings.direction === 'horizontal';
  const w = info.width;
  const h = info.height;
  const gray = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = Math.floor((data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114 + 500) / 1000);
  }

  const threshold = Math.floor(255 * (1 - (settings.senstivity / 100)));
  const ignorable = Math.max(0, settings.ignorable_pixels | 0);
  const step = Math.max(1, settings.scan_step | 0);
  const split = Math.max(1, settings.split_height | 0);
  const length = horizontal ? w : h;
  const across = horizontal ? h : w;
  const bounds = [0];
  let row = split;
  let moveUp = true;

  while (row < length) {
    const safeRow = Math.max(0, row);
    let canSlice = true;

    for (let i = ignorable + 1; i < across - ignorable; i++) {
      const current = horizontal ? gray[i * w + safeRow] : gray[safeRow * w + i];
      const previous = horizontal ? gray[i * w + safeRow - 1] : gray[safeRow * w + i - 1];
      const diff = current - previous;
      if (diff > threshold || diff < -threshold) {
        canSlice = false;
        break;
      }
    }

    if (canSlice) {
      bounds.push(safeRow);
      row = safeRow + split;
      moveUp = true;
      continue;
    }
    if (safeRow - bounds[bounds.length - 1] <= 0.4 * split) {
      row = bounds[bounds.length - 1] + split;
      moveUp = false;
    }
    if (moveUp) {
      row = safeRow - step;
      continue;
    }
    row = safeRow + step;
  }

  if (bounds[bounds.length - 1] !== length - 1) bounds.push(length - 1);
  report('Smart detector: ' + (bounds.length - 1) + ' slice, threshold ' + threshold + '.');
  return uniqueSorted(bounds);
}

function linearRegions(combined, bounds, horizontal) {
  const regions = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const start = bounds[i];
    const size = bounds[i + 1] - start;
    if (size <= 0) continue;
    regions.push({
      index: regions.length,
      left: horizontal ? start : 0,
      top: horizontal ? 0 : start,
      width: horizontal ? size : combined.width,
      height: horizontal ? combined.height : size
    });
  }
  return regions;
}

function gridRegions(combined, shape, report) {
  const maxCols = Math.max.apply(null, shape.columnsPerRow);
  if (shape.rows > combined.height || maxCols > combined.width || shape.count > combined.width * combined.height) {
    throw new Error('Jumlah gambar (' + shape.count + ') tidak muat pada kanvas ' + combined.width + '×' + combined.height + '.');
  }

  const regions = [];
  for (let row = 0; row < shape.rows; row++) {
    const top = Math.floor(combined.height * row / shape.rows);
    const bottom = row === shape.rows - 1 ? combined.height : Math.floor(combined.height * (row + 1) / shape.rows);
    const colsInRow = shape.columnsPerRow[row];
    for (let col = 0; col < colsInRow; col++) {
      const left = Math.floor(combined.width * col / colsInRow);
      const right = col === colsInRow - 1 ? combined.width : Math.floor(combined.width * (col + 1) / colsInRow);
      regions.push({
        index: regions.length,
        left,
        top,
        width: right - left,
        height: bottom - top
      });
    }
  }

  const layout = shape.exact
    ? shape.rows + '×' + shape.cols
    : shape.rows + ' baris × maks. ' + shape.cols + ' kolom (' + shape.columnsPerRow.join(',') + ')';
  report('Image Count: ' + shape.count + ' gambar → grid ' + layout + '.');
  return regions;
}

async function emitRegions(combined, regions, settings, onOutput) {
  const outputs = [];
  for (const region of regions) {
    const piece = await sharp(combined.buffer, { limitInputPixels: false })
      .extract({ left: region.left, top: region.top, width: region.width, height: region.height })
      .png()
      .toBuffer();
    const buffer = await encodeSlice(piece, settings.output_type, settings.lossy_quality);
    const name = pad(region.index + 1, 2) + settings.output_type;

    if (onOutput) await onOutput(name, buffer);

    outputs.push({ name, buffer, width: region.width, height: region.height });
  }
  return outputs;
}

async function processImages(inputs, settings, hooks) {
  hooks = hooks || {};
  const report = hooks.report || function () {};
  const onOutput = hooks.onOutput || null;
  const onCombined = hooks.onCombined || null;
  const horizontal = settings.direction === 'horizontal';

  const normalized = await normalizeInputs(inputs, report);
  const aligned = settings.direction === 'horizontal' && normalized.length === 2
    ? await alignSecondToFirst(normalized, report)
    : normalized;
  const countMode = settings.grid_mode === 'count';
  const effective = countMode ? Object.assign({}, settings, { enforce_type: 1 }) : settings;
  if (countMode) report('Image Count aktif — ukuran gabungan otomatis dan pemotongan grid.');
  const resized = await resizeImages(aligned, effective, report);
  if (!resized.length) throw new Error('Tidak ada gambar setelah penyesuaian ukuran.');
  const combined = await combineImages(resized, effective, report);

  if (onCombined) await onCombined('combined.png', combined.buffer);

  let regions;
  let shape = null;
  if (countMode) {
    shape = gridShape(settings.image_count, settings.direction);
    regions = gridRegions(combined, shape, report);
  } else {
    const bounds = settings.detector_type === 1
      ? await pixelSlices(combined, settings, report)
      : directSlices(horizontal ? combined.width : combined.height, settings.split_height);
    report('Blok potong: ' + bounds.join(', '));
    regions = linearRegions(combined, bounds, horizontal);
  }

  const outputs = await emitRegions(combined, regions, settings, onOutput);

  report('Dihasilkan ' + outputs.length + ' potongan gambar.');
  const zipBuffer = zipStore(outputs);

  return {
    zipBuffer,
    outputs: outputs.map((item) => ({ name: item.name, width: item.width, height: item.height, size: item.buffer.length })),
    stats: {
      inputs: normalized.length,
      combinedWidth: combined.width,
      combinedHeight: combined.height,
      slices: outputs.length,
      grid: shape ? { rows: shape.rows, cols: shape.cols, columnsPerRow: shape.columnsPerRow.slice(), exact: shape.exact } : null,
      zipSize: zipBuffer.length
    }
  };
}

async function processInputGroups(inputs, settings, hooks) {
  const groups = groupInputsByDirectory(inputs);
  if (!groups.length) throw new Error('Tidak ada gambar yang dikirim.');

  const baseHooks = hooks || {};
  const outputs = [];
  const entries = [];
  let totalInputs = 0;

  for (const group of groups) {
    const localOutputs = [];
    const scopedHooks = {};

    scopedHooks.report = baseHooks.report
      ? (message) => baseHooks.report(group.dir ? group.dir + ': ' + message : message)
      : null;
    scopedHooks.onCombined = baseHooks.onCombined
      ? (name, buffer) => baseHooks.onCombined(joinRelative(group.dir, name), buffer)
      : null;
    scopedHooks.onOutput = async (name, buffer) => {
      const relative = joinRelative(group.dir, name);
      localOutputs.push({ name: relative, buffer });
      if (baseHooks.onOutput) await baseHooks.onOutput(relative, buffer);
    };

    const result = await processImages(group.inputs, settings, scopedHooks);
    totalInputs += result.stats.inputs;
    result.outputs.forEach((item, index) => {
      outputs.push(Object.assign({}, item, { relativePath: localOutputs[index].name }));
      entries.push({ name: localOutputs[index].name, buffer: localOutputs[index].buffer });
    });
  }

  const zipBuffer = zipStore(entries);
  return {
    zipBuffer,
    outputs,
    stats: {
      groups: groups.length,
      inputs: totalInputs,
      slices: outputs.length,
      zipSize: zipBuffer.length
    }
  };
}

module.exports = {
  FORMATS,
  INPUT_FORMATS,
  gridShape,
  groupInputsByDirectory,
  isSupportedInput,
  naturalCompare,
  parseSettings,
  processImages,
  processInputGroups,
  zipStore
};
