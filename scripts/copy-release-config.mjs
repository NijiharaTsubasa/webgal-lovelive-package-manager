import { copyFile } from 'node:fs/promises';

await copyFile(new URL('../package-manager.config.json', import.meta.url),
  new URL('../release/package-manager.config.json', import.meta.url));
