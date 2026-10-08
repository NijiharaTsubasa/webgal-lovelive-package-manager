const http = require('node:http');
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');

async function createPackageServer(packedRoot, options = {}) {
  const server = http.createServer(async (request, response) => {
    try {
      if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405).end(); return; }
      let name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname.slice(1));
      let directory = packedRoot;
      if (name.startsWith('others/')) {
        directory = options.othersRoot || path.join(path.dirname(packedRoot), 'others');
        name = name.slice('others/'.length);
      }
      if (!name || /[/\\:\x00-\x1f]/.test(name) || !(name === 'models.json' || name === 'resources.json' || /\.(zip|webp|png|jpe?g|gif)$/i.test(name))) {
        response.writeHead(404).end(); return;
      }
      const filename = name === 'resources.json' ? options.resourceCatalog || path.join(path.dirname(packedRoot), 'resources.json') : path.join(directory, name);
      const stat = await fs.stat(filename);
      if (!stat.isFile()) { response.writeHead(404).end(); return; }
      response.writeHead(200, {
        'Content-Type': ({ '.json': 'application/json; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.zip': 'application/zip' })[path.extname(name).toLowerCase()],
        'Content-Length': stat.size, 'Cache-Control': 'no-cache',
      });
      if (request.method === 'HEAD') response.end();
      else await pipeline(createReadStream(filename), response);
    } catch (error) {
      if (!response.headersSent) response.writeHead(error.code === 'ENOENT' ? 404 : 500).end();
      else response.destroy();
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, '127.0.0.1', resolve);
  });
  return { origin: `http://127.0.0.1:${server.address().port}/`, close: () => new Promise(resolve => server.close(resolve)) };
}
module.exports = { createPackageServer };
