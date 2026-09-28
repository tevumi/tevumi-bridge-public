import {defineConfig} from '@playwright/test';
export default defineConfig({
 testDir:'./test/beta',timeout:30000,workers:1,
 use:{baseURL:'http://127.0.0.1:5187',headless:true},
 webServer:{command:'npx vite --config vite.beta.config.js',url:'http://127.0.0.1:5187',reuseExistingServer:false,timeout:30000},
});
