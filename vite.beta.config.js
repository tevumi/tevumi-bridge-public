import {defineConfig} from 'vite';
import {resolve} from 'node:path';
export default defineConfig({
 root:'web/beta-deploy',base:'/deploy-beta/',
 server:{host:'127.0.0.1',port:5187,strictPort:true},
 build:{outDir:resolve('dist-beta'),emptyOutDir:true,rollupOptions:{input:{deploy:resolve('web/beta-deploy/index.html'),configure:resolve('web/beta-deploy/config.html')}}},
});
