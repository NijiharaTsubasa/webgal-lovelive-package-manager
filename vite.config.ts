import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({ base: './', plugins: [
  react(),
  {
    name: 'development-csp', apply: 'serve',
    // React Refresh 的开发引导脚本是内联模块；正式构建继续使用严格策略。
    transformIndexHtml: {
      order: 'pre',
      handler: html => html.replace("script-src 'self';", "script-src 'self' 'unsafe-inline';"),
    },
  },
] });
