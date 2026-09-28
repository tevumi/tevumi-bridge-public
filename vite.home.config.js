import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  root: '.',
  base: '/preview/',
  build: {
    outDir: resolve('dist-home'),
    emptyOutDir: true,
    rollupOptions: { input: resolve('web/preview/index.html') },
  },
});
