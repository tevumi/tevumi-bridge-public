import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./test/candidate-browser',timeout:60000,workers:1,use:{baseURL:'http://127.0.0.1:5174',headless:true,screenshot:'only-on-failure'},webServer:{command:'npx vite --config vite.candidate.config.js',env:{CANDIDATE_EPHEMERAL:'1'},url:'http://127.0.0.1:5174',reuseExistingServer:false,timeout:30000}});
