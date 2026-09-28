import {defineConfig} from 'vite';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createCandidateRuntime} from './dev/candidate/runtime.mjs';
import {createPersistentRuntime,archiveCandidate} from './dev/candidate/persistent.mjs';
const ephemeral=process.env.CANDIDATE_EPHEMERAL==='1';
export default defineConfig({
 root:'dev/candidate',server:{host:'127.0.0.1',port:5174,strictPort:true,fs:{strict:true,deny:['.env','.env.*','*.{crt,pem}','**/.git/**','**/.local/**']}},
 plugins:[{name:'local-candidate-api',apply:'serve',configureServer(server){
  let runtime,queue=Promise.resolve();const token=randomUUID();
  const get=()=>runtime??=(ephemeral?createCandidateRuntime():createPersistentRuntime());
  server.httpServer?.once('close',()=>{runtime?.then(r=>r.close()).catch(()=>{});});
  server.middlewares.use(async(req,res,next)=>{
   if(req.url?.split('?')[0]!=='/bridge.html')return next();
   try{
    const source=await readFile('web/bridge.html','utf8');
    const html=source.replace('src="/src/product.js"','src="/product.js"').replaceAll('/brand/','/@fs/'+process.cwd().replaceAll('\\','/')+'/web/public/brand/');
    res.setHeader('Content-Type','text/html');res.setHeader('Cache-Control','no-store');
    res.end(await server.transformIndexHtml('/bridge.html',html));
   }catch(e){next(e);}
  });
  server.middlewares.use('/__candidate/rpc',async(req,res)=>{
   const side=req.url?.split('?')[0]?.slice(1),origin=req.headers.origin;
   const allowedOrigin=origin==='http://127.0.0.1:5174'||origin==='http://localhost:5174'||/^chrome-extension:\/\/[a-z]{32}$/.test(origin??'');
   if(!['bsc','arc'].includes(side)||req.headers.host!=='127.0.0.1:5174'||origin&&!allowedOrigin){res.statusCode=403;res.end();return;}
   if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Headers','content-type');res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');}
   if(req.method==='OPTIONS'){res.statusCode=204;res.end();return;}
   if(req.method!=='POST'){res.statusCode=405;res.end();return;}
   res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
   const task=async()=>{
    let id=null;
    try{
     let body='';for await(const chunk of req){body+=chunk;if(body.length>200000)throw Error();}
     const input=JSON.parse(body);id=input.id??null;
     if(input.jsonrpc!=='2.0'||typeof input.method!=='string'||!Array.isArray(input.params??[])||Array.isArray(input))throw Error();
     const result=input.method==='net_version'?(side==='bsc'?'31337':'31338'):await(await get()).walletRpc({side,method:input.method,params:input.params??[]});
     res.end(JSON.stringify({jsonrpc:'2.0',id,result}));
    }catch{res.end(JSON.stringify({jsonrpc:'2.0',id,error:{code:-32000,message:'Local candidate RPC request denied or failed'}}));}
   };
   queue=queue.then(task,task);await queue;
  });
  server.middlewares.use('/__candidate',async(req,res)=>{
   const host=req.headers.host,origin=req.headers.origin;
   if(!['127.0.0.1:5174','localhost:5174'].includes(host)||origin&&origin!=='http://'+host){res.statusCode=403;res.end();return;}
   const json=(status,data)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(data));};
   const task=async()=>{
    try{
     if(req.method==='GET'&&req.url==='/state'){json(200,{token,...await (await get()).state()});return;}
     if(req.method!=='POST'||req.headers['x-candidate-token']!==token){json(403,{error:'本地测试会话无效，请刷新。'});return;}
     let body='';for await(const chunk of req){body+=chunk;if(body.length>4096)throw new Error('请求过大。');}const input=JSON.parse(body||'{}');
     if(req.url==='/reset'){if(runtime)await runtime.then(r=>r.close()).catch(()=>{});runtime=undefined;if(!ephemeral)await archiveCandidate();json(200,{token,...await(await get()).state()});return;}
     const method={'/preview':'preview','/confirm':'confirm','/retry':'retry','/faults':'faults','/gas-spike':'gasSpike','/wallet-prepare':'walletPrepare','/wallet-broadcast':'walletBroadcast','/wallet-recover':'walletRecover','/wallet-reject':'walletReject'}[req.url];
     if(!method){json(404,{error:'未知的本地测试操作。'});return;}
     const result=await(await get())[method](input);json(200,{result:result??null,state:await(await get()).state()});
    }catch(error){const message=typeof error.message==='string'&&/[\u4e00-\u9fff]/.test(error.message)&&error.message.length<200?error.message:'本地测试操作失败，请检查控制台或重建测试环境。';json(400,{error:message});}
   };
   queue=queue.then(task,task);await queue;
  });
 }}],
});
