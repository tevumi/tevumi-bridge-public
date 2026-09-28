import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  root: 'web/immediate-deploy',
  base: '/deploy-now/',
  server: { host: '127.0.0.1', port: 5188, strictPort: true },
  build: { outDir: resolve('dist-immediate'), emptyOutDir: true, rollupOptions: { input: { deploy: resolve('web/immediate-deploy/index.html'), configure: resolve('web/immediate-deploy/config.html'), limits: resolve('web/immediate-deploy/limits.html'), live: resolve('web/immediate-deploy/live.html'), public: resolve('web/immediate-deploy/public.html'), cat: resolve('web/immediate-deploy/cat.html'), catPublic: resolve('web/immediate-deploy/cat-public.html') } } },
});
