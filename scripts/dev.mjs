import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import electron from 'electron';

const server = await createServer({ server: { host: '127.0.0.1', port: 5190 } });
await server.listen();
console.log('正在启动包管理器桌面窗口，请在该窗口中操作。');
const env = { ...process.env, PACKAGE_MANAGER_DEV_URL: server.resolvedUrls.local[0] };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['.'], { stdio: 'inherit', env, windowsHide: false });
let closing = false;
async function close(code = 0) {
  if (closing) return;
  closing = true;
  child.kill();
  await server.close();
  process.exit(code);
}
child.on('exit', code => void close(code ?? 0));
child.on('error', error => { console.error(error); void close(1); });
process.on('SIGINT', () => void close());
process.on('SIGTERM', () => void close());
