const { httpUrl } = require('./catalog-config.cjs');
const { modelPath } = require('./model-path.cjs');
const { roots } = require('./resource-installer.cjs');

async function fetchCatalog(url, label) {
  let response;
  try { response = await fetch(url, { signal: AbortSignal.timeout(30000) }); }
  catch { throw Error(`${label}下载失败，无法连接下载源：\n${url}\n请检查网络和配置地址后点击“重试”。`); }
  if (!response.ok) throw Error(`${label}下载失败（HTTP ${response.status}）：\n${url}\n请检查配置地址或稍后重试。`);
  let catalog;
  try { catalog = await response.json(); }
  catch { throw Error(`${label}读取失败：内容不是有效的 JSON，或传输未完成。请检查下载源后重试。`); }
  return { response, catalog };
}

function parseCatalog(catalog, base, kind) {
  const label = kind === 'model' ? '模型清单' : '资源清单';
  if (!Array.isArray(catalog)) throw Error(`${label}格式错误：最外层必须是数组。请联系下载源维护者。`);
  const next = new Map();
  catalog.forEach((item, index) => {
    const context = `${label}第 ${index + 1} 项`;
    const fail = detail => { throw Error(`${context}：${detail}。请联系下载源维护者。`); };
    if (!item || typeof item !== 'object' || Array.isArray(item)) fail('必须是一个资源对象');
    for (const field of ['name', 'description', 'installPath', 'url']) {
      if (typeof item[field] !== 'string') fail(`${field} 缺失或不是字符串`);
    }
    if (kind === 'model') {
      try { modelPath(item.path); } catch { fail('path 模型目录无效'); }
      if (item.installPath !== `3d/figure/${item.path}`) fail('installPath 与模型目录不一致');
      for (const field of ['bytes', 'unpackedBytes']) {
        if (!Number.isSafeInteger(item[field]) || item[field] <= 0) fail(`${field} 必须是正整数`);
      }
      if (typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(item.sha256)) fail('sha256 校验值无效');
    } else {
      if (!Object.hasOwn(roots, item.type)) fail('type 资源类型无效');
      const directory = roots[item.type];
      if (typeof item.checkPath !== 'string' || !item.checkPath.startsWith(`${directory}/`) ||
          item.checkPath.split(/[\\/]/).some(part => part === '..' || part === '.') || /[\\:\x00-\x1f]/.test(item.checkPath)) {
        fail('checkPath 必须位于该类型的资源目录内');
      }
      for (const field of ['bytes', 'unpackedBytes']) {
        if (item[field] != null && (!Number.isSafeInteger(item[field]) || item[field] <= 0)) fail(`${field} 必须是正整数`);
      }
      if (item.sha256 != null && (typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(item.sha256))) fail('sha256 校验值无效');
    }
    if (item.preview != null && typeof item.preview !== 'string') fail('preview 必须是图片地址字符串');
    const resolved = { ...item };
    for (const field of ['url', 'preview']) {
      if (field === 'preview' && !item[field]) { delete resolved.preview; continue; }
      try { resolved[field] = httpUrl(item[field], base); }
      catch { fail(`${field} 地址无效，必须是 HTTP 或 HTTPS 地址（也可以使用相对路径）`); }
    }
    const key = kind === 'model' ? item.path : resolved.url;
    if (next.has(key)) fail(kind === 'model' ? '模型目录重复' : '下载地址重复');
    next.set(key, resolved);
  });
  return next;
}
module.exports = { fetchCatalog, parseCatalog };
