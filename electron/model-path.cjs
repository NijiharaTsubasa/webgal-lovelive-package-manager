function modelPath(value) {
  if (typeof value !== 'string' || value.split('/').length !== 3 ||
    value.split('/').some(part => !part || part === '.' || part === '..' || /[\\:\x00-\x1f]/.test(part) || /[. ]$/.test(part))) {
    throw Error(`无效模型目录：${value}`);
  }
  return value;
}
module.exports = { modelPath };
