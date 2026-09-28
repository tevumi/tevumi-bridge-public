import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './test/browser', timeout: 45000, workers: 1,
  use: { baseURL:'http://127.0.0.1:5173', headless:true, screenshot:'only-on-failure' },
  webServer: { command:'npx vite --config vite.config.js', url:'http://127.0.0.1:5173', reuseExistingServer:!process.env.CI, timeout:30000 },
});
