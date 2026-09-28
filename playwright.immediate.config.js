import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/immediate', timeout: 30000, workers: 1,
  use: { baseURL: 'http://127.0.0.1:5188', headless: true },
  webServer: { command: 'npx vite --config vite.immediate.config.js', url: 'http://127.0.0.1:5188', reuseExistingServer: true, timeout: 30000 },
});
