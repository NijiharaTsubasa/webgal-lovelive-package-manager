function userError(error) {
  const hints = {
    ENOENT: '文件或目录不存在，可能已被移动或删除。请检查工程及资源位置后重试。',
    ENOTDIR: '路径中的某一项不是目录。请检查工程目录后重试。',
    EACCES: '无法访问文件或目录。请检查访问权限后重试。',
    EPERM: '无法操作文件或目录。请检查访问权限，以及是否被其他程序占用后重试。',
    EBUSY: '文件正在被其他程序使用。请结束复制或关闭占用程序后重试。',
    ENOSPC: '磁盘空间不足。请释放安装目录所在磁盘的空间后重试。',
    EIO: '文件读写失败。请检查磁盘状态后重试。',
    ENAMETOOLONG: '文件路径过长。请将工程放到较短的路径后重试。',
  };
  return hints[error?.code] ? Error(`${hints[error.code]}${error.path ? `\n位置：${error.path}` : ''}`) : error;
}
module.exports = { userError };
