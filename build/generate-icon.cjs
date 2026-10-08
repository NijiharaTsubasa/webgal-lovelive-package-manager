const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true } });
  try {
    await window.loadURL('about:blank');
    const svg = await fs.readFile(path.join(__dirname, 'icon.svg'), 'utf8');
    const sizes = [16, 32, 48, 64, 128, 256];
    const images = [];
    for (const size of sizes) {
      const data = await window.webContents.executeJavaScript(`(async () => {
        const image = new Image();
        image.src = 'data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}';
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = ${size};
        canvas.getContext('2d').drawImage(image, 0, 0, ${size}, ${size});
        return canvas.toDataURL('image/png').split(',')[1];
      })()`);
      images.push(Buffer.from(data, 'base64'));
    }
    const header = Buffer.alloc(6 + 16 * sizes.length);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(sizes.length, 4);
    let offset = header.length;
    images.forEach((image, index) => {
      const entry = 6 + index * 16;
      header[entry] = header[entry + 1] = sizes[index] === 256 ? 0 : sizes[index];
      header.writeUInt16LE(1, entry + 4);
      header.writeUInt16LE(32, entry + 6);
      header.writeUInt32LE(image.length, entry + 8);
      header.writeUInt32LE(offset, entry + 12);
      offset += image.length;
    });
    await fs.writeFile(path.join(__dirname, 'icon.ico'), Buffer.concat([header, ...images]));
    await fs.writeFile(path.join(__dirname, '../electron/icon.png'), images.at(-1));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally { window.destroy(); app.quit(); }
});
