import { defineConfig } from 'vite';
export default defineConfig({
  root: 'web',
  server: { host: '127.0.0.1', port: 5173, strictPort: true, fs: { strict: true, deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.local/**'] } },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  build: { rollupOptions: { input: { main: 'web/index.html', bridge: 'web/bridge.html' } }, outDir: '../dist', emptyOutDir: true },
});
