'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const {
  encodeIco,
  parseSettings,
  processImages,
  processInputGroups
} = require('./lib/processor');

function makeSettings(overrides) {
  return parseSettings(Object.assign({
    grid_mode: 'resize',
    output_type: '.png',
    resize_width: 48,
    resize_height: 48,
    resize_method: 'fit',
    ico_sizes: []
  }, overrides || {}));
}

async function solidImage(width, height) {
  return sharp({
    create: { width, height, channels: 4, background: { r: 225, g: 30, b: 60, alpha: 1 } }
  }).png().toBuffer();
}

function quadrantPixels(width, height) {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      if (x < 50) {
        data[offset] = 255;
      } else if (x < 150) {
        data[offset + 1] = 255;
      } else {
        data[offset + 2] = 255;
      }
      data[offset + 3] = 255;
    }
  }
  return data;
}

function transparentCornerPixels(width, height) {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = 255;
    data[i * 4 + 3] = 255;
  }
  data[3] = 0;
  return data;
}

async function rawPng(width, height, data) {
  return sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

async function pixelAt(buffer, width, height, x, y) {
  const { data } = await sharp(buffer, { limitInputPixels: false })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const offset = (y * width + x) * 4;
  return Array.from(data.slice(offset, offset + 4));
}

function readZip(buffer) {
  const entries = [];
  let offset = 0;
  while (offset + 30 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const size = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const start = offset + 30 + nameLength + extraLength;
    entries.push({
      name: buffer.slice(offset + 30, offset + 30 + nameLength).toString('utf8'),
      buffer: buffer.slice(start, start + size)
    });
    offset = start + size;
  }
  return entries;
}

function parseIco(buffer) {
  assert.equal(buffer.readUInt16LE(0), 0);
  assert.equal(buffer.readUInt16LE(2), 1);
  const count = buffer.readUInt16LE(4);
  const entries = [];
  for (let i = 0; i < count; i++) {
    const offset = 6 + i * 16;
    entries.push({
      width: buffer[offset] || 256,
      height: buffer[offset + 1] || 256,
      planes: buffer.readUInt16LE(offset + 4),
      bitCount: buffer.readUInt16LE(offset + 6),
      size: buffer.readUInt32LE(offset + 8),
      dataOffset: buffer.readUInt32LE(offset + 12)
    });
    entries[i].data = buffer.slice(
      entries[i].dataOffset,
      entries[i].dataOffset + entries[i].size
    );
  }
  return { count, entries };
}

function input(name, buffer) {
  return { name, relativePath: name, buffer };
}

test('1. Satu gambar di-resize menjadi 48x48', async () => {
  const result = await processInputGroups(
    [input('gambar.png', await solidImage(100, 60))],
    makeSettings({ resize_width: 48, resize_height: 48 })
  );

  assert.equal(result.outputs.length, 1);
  assert.equal(result.outputs[0].width, 48);
  assert.equal(result.outputs[0].height, 48);
  assert.equal(result.outputs[0].name, 'gambar-48x48.png');
  assert.equal(readZip(result.zipBuffer).length, 1);
});

test('2. Beberapa gambar di-resize menjadi 128x128', async () => {
  const names = ['gambar-1.png', 'gambar-2.png', 'gambar-3.png', 'gambar-4.png', 'gambar-5.png'];
  const inputs = [];
  for (const name of names) inputs.push(input(name, await solidImage(200, 90)));

  const result = await processInputGroups(inputs, makeSettings({
    resize_width: 128,
    resize_height: 128
  }));

  assert.equal(result.outputs.length, 5);
  result.outputs.forEach((output, index) => {
    assert.equal(output.width, 128);
    assert.equal(output.height, 128);
    assert.equal(output.name, names[index].replace('.png', '-128x128.png'));
  });
});

test('3. Resize ukuran kustom bukan persegi', async () => {
  const result = await processInputGroups(
    [input('foto.png', await solidImage(300, 200))],
    makeSettings({ resize_width: 37, resize_height: 91, resize_method: 'stretch' })
  );

  assert.equal(result.outputs[0].width, 37);
  assert.equal(result.outputs[0].height, 91);
  assert.equal(result.outputs[0].name, 'foto-37x91.png');
});

test('4. Metode Fit, Fill, dan Stretch menghasilkan perilaku berbeda', async () => {
  const source = await rawPng(200, 100, quadrantPixels(200, 100));

  const fit = await processInputGroups([input('fit.png', source)], makeSettings({
    resize_width: 100, resize_height: 100, resize_method: 'fit'
  }));
  const fitZip = readZip(fit.zipBuffer)[0].buffer;
  assert.equal((await pixelAt(fitZip, 100, 100, 50, 0))[3], 0);
  assert.equal((await pixelAt(fitZip, 100, 100, 50, 50))[3], 255);

  const fill = await processInputGroups([input('fill.png', source)], makeSettings({
    resize_width: 100, resize_height: 100, resize_method: 'fill'
  }));
  const fillZip = readZip(fill.zipBuffer)[0].buffer;
  const fillLeft = await pixelAt(fillZip, 100, 100, 0, 50);
  const fillRight = await pixelAt(fillZip, 100, 100, 99, 50);
  assert.ok(fillLeft[1] > 200 && fillLeft[3] === 255);
  assert.ok(fillRight[1] > 200 && fillRight[3] === 255);

  const stretch = await processInputGroups([input('stretch.png', source)], makeSettings({
    resize_width: 100, resize_height: 100, resize_method: 'stretch'
  }));
  const stretchZip = readZip(stretch.zipBuffer)[0].buffer;
  const stretchLeft = await pixelAt(stretchZip, 100, 100, 0, 50);
  const stretchRight = await pixelAt(stretchZip, 100, 100, 99, 50);
  assert.ok(stretchLeft[0] > 200 && stretchLeft[3] === 255);
  assert.ok(stretchRight[2] > 200 && stretchRight[3] === 255);
});

test('5. Ekspor ICO adalah kontainer ICO dengan PNG ber-alpha', async () => {
  const source = await rawPng(64, 64, transparentCornerPixels(64, 64));
  const ico = await encodeIco(source, makeSettings({ output_type: '.ico' }));
  const parsed = parseIco(ico);

  assert.equal(parsed.count, 1);
  assert.equal(parsed.entries[0].width, 64);
  assert.equal(parsed.entries[0].height, 64);
  assert.equal(parsed.entries[0].planes, 1);
  assert.equal(parsed.entries[0].bitCount, 32);
  assert.equal(parsed.entries[0].data.slice(1, 4).toString(), 'PNG');
  assert.equal((await pixelAt(parsed.entries[0].data, 64, 64, 0, 0))[3], 0);
});

test('6. Ekspor ICO dengan beberapa resolusi', async () => {
  const ico = await encodeIco(
    await solidImage(64, 64),
    makeSettings({ output_type: '.ico', ico_sizes: [16, 32, 48, 128, 256] })
  );
  const parsed = parseIco(ico);

  assert.equal(parsed.count, 6);
  assert.deepEqual(parsed.entries.map((entry) => entry.width), [16, 32, 48, 64, 128, 256]);
  assert.equal(ico[6 + 5 * 16], 0);
  assert.equal(ico[6 + 5 * 16 + 1], 0);
  for (const entry of parsed.entries) {
    assert.equal(entry.data.slice(1, 4).toString(), 'PNG');
    const meta = await sharp(entry.data).metadata();
    assert.equal(meta.width, entry.width);
    assert.equal(meta.height, entry.height);
  }
});

test('7. Mode Resize mempertahankan berkas terpisah', async () => {
  const inputs = [
    input('a.png', await solidImage(80, 80)),
    input('b.png', await solidImage(120, 40)),
    input('c.png', await solidImage(60, 100))
  ];
  let combinedCalls = 0;
  const result = await processInputGroups(
    inputs,
    makeSettings({ resize_width: 64, resize_height: 64 }),
    { report() {}, onCombined() { combinedCalls++; } }
  );

  assert.equal(combinedCalls, 0);
  assert.equal(result.outputs.length, 3);
  assert.deepEqual(result.outputs.map((item) => item.name), [
    'a-64x64.png', 'b-64x64.png', 'c-64x64.png'
  ]);
  assert.equal(readZip(result.zipBuffer).length, 3);
});

test('8. Mode Kustom dan Jumlah Gambar tetap berfungsi', async () => {
  const inputs = [
    input('slice-1.png', await solidImage(100, 100)),
    input('slice-2.png', await solidImage(100, 100))
  ];

  const custom = await processImages(inputs, makeSettings({
    grid_mode: 'custom',
    direction: 'vertical',
    split_height: 50,
    detector_type: 0,
    enforce_type: 0
  }));
  assert.equal(custom.outputs.length, 4);
  assert.deepEqual(custom.outputs.map((item) => item.name), [
    '01.png', '02.png', '03.png', '04.png'
  ]);

  const count = await processImages(inputs, makeSettings({
    grid_mode: 'count',
    direction: 'vertical',
    image_count: 4,
    enforce_type: 0
  }));
  assert.equal(count.outputs.length, 4);
  assert.equal(count.stats.grid.rows, 2);
  assert.equal(count.stats.grid.cols, 2);
});

test('9. Format gambar yang tidak didukung menghasilkan error yang jelas', async () => {
  await assert.rejects(
    processInputGroups(
      [input('rusak.png', Buffer.from('bukan gambar'))],
      makeSettings()
    ),
    /Gagal resize rusak\.png/
  );
});
