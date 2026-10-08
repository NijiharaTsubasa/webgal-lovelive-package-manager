const fs = require('node:fs/promises');
const { createWriteStream } = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const yazl = require('yazl');
const { createHash } = require('node:crypto');
const { deflateSync } = require('node:zlib');

// 生成透明底蓝色方块 PNG，供预览测试使用。
function createPreviewImage() {
  const width = 64;
  const pixels = Buffer.alloc((width * 4 + 1) * width);
  for (let y = 12; y < 52; y++) {
    for (let x = 12; x < 52; x++) {
      const offset = y * (width * 4 + 1) + 1 + x * 4;
      pixels.set([72, 104, 174, 255], offset);
    }
  }
  function chunk(type, data) {
    const name = Buffer.from(type);
    let crc = 0xffffffff;
    for (const byte of Buffer.concat([name, data])) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    const result = Buffer.alloc(data.length + 12);
    result.writeUInt32BE(data.length, 0);
    name.copy(result, 4);
    data.copy(result, 8);
    result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, data.length + 8);
    return result;
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(width, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}

async function createZip(filename, entries) {
  const zip = new yazl.ZipFile();
  for (const [name, data] of entries) zip.addBuffer(Buffer.from(data), name);
  zip.end();
  await pipeline(zip.outputStream, createWriteStream(filename));
}
async function createPacked(root, models, image) {
  await fs.mkdir(root, { recursive: true });
  const catalog = [];
  for (const model of models) {
    const entries = [
      [`${model.path}/config.json`, JSON.stringify({ components: [{ type: 'model', name: model.name, description: model.description }] })],
      [`${model.path}/model.glb`, 'test-model-content'],
    ];
    const filename = `${model.name}.zip`;
    await createZip(path.join(root, filename), entries);
    await fs.writeFile(path.join(root, `${model.name}.png`), image);
    const zip = await fs.readFile(path.join(root, filename));
    catalog.push({ name: model.name, description: model.description, path: model.path,
      installPath: `3d/figure/${model.path}`, url: encodeURIComponent(filename), preview: encodeURIComponent(`${model.name}.png`),
      bytes: zip.length, unpackedBytes: entries.reduce((sum, [, data]) => sum + Buffer.byteLength(data), 0),
      sha256: createHash('sha256').update(zip).digest('hex'),
    });
  }
  await fs.writeFile(path.join(root, 'models.json'), JSON.stringify(catalog), 'utf8');
  return catalog;
}
module.exports = { createZip, createPacked, createPreviewImage };
