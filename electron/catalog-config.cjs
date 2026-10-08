const fs = require('node:fs/promises');
const path = require('node:path');

function httpUrl(value, base) {
  if (typeof value !== 'string' || !value.trim()) throw Error('地址必须为非空字符串');
  const url = new URL(value, base);
  if (!['http:', 'https:'].includes(url.protocol)) throw Error('地址必须使用 HTTP 或 HTTPS');
  return url.href;
}
async function readCatalogConfig(directory) {
  const filename = path.join(directory, 'package-manager.config.json');
  let text;
  try {
    text = await fs.readFile(filename, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') throw Error(`找不到下载源配置文件：\n${filename}\n请恢复该文件后点击“重试”。`);
    throw Error(`无法读取下载源配置文件：\n${filename}\n请检查文件权限后点击“重试”。`);
  }
  let data;
  try { data = JSON.parse(text.replace(/^\uFEFF/, '')); }
  catch { throw Error(`下载源配置文件不是有效的 JSON：\n${filename}\n请检查逗号和引号，保存后点击“重试”。`); }
  const result = {};
  for (const field of ['modelCatalogUrl', 'resourceCatalogUrl']) {
    try { result[field] = httpUrl(data?.[field]); }
    catch { throw Error(`下载源配置中的 ${field} 必须填写完整的 HTTP 或 HTTPS 地址。\n请修改 ${filename}，保存后点击“重试”。`); }
  }
  return result;
}
module.exports = { readCatalogConfig, httpUrl };
