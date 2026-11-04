function modelPath(value) {
  if (typeof value !== 'string' ||
    value.split('/').some(part => !part || part === '.' || part === '..')) {
    throw Error(`无效模型目录：${value}`);
  }
  return value;
}
const modelInstallRoot = '3d/figure';

function modelInstallPath(value) {
  const prefix = modelInstallRoot + '/';
  if (typeof value !== 'string' || !value.startsWith(prefix)) {
    throw Error('模型安装路径必须位于 3d/figure 内');
  }
  const relative = modelPath(value.slice(prefix.length));
  if (relative.split('/').some(part => /[\\:<>"|?*\x00-\x1f]|[. ]$/.test(part) ||
    /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(\.|$)/i.test(part))) {
    throw Error('模型安装路径含有非法目录名');
  }
  return relative;
}

module.exports = { modelPath, modelInstallPath, modelInstallRoot };
