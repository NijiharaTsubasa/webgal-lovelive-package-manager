const path = require('node:path');

function appDirectory(app, env = process.env, executable = process.execPath) {
  if (!app.isPackaged) return app.getAppPath();
  return env.PORTABLE_EXECUTABLE_DIR || path.dirname(executable);
}

module.exports = { appDirectory };
