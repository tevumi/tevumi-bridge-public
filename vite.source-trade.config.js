import {defineConfig} from 'vite';
import {readFileSync,writeFileSync,mkdirSync,renameSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {assertJournalUpdate,validateOrder} from './web/source-trade/order.js';
import {readJson} from './web/source-trade/read-json.js';

const journal=resolve('.local/source-trade-orders.json');
const readMethods=new Set(['eth_chainId','net_version','eth_blockNumber','eth_getBalance','eth_getStorageAt','eth_getProof','eth_call','eth_estimateGas','eth_gasPrice','eth_maxPriorityFeePerGas','eth_getCode','eth_getTransactionByHash','eth_getTransactionReceipt','eth_getBlockByNumber','eth_getBlockByHash','eth_getTransactionCount','eth_getLogs']);
export default defineConfig({
 root:resolve('web/source-trade'),
 server:{host:'127.0.0.1',port:5345,strictPort:true,fs:{allow:[process.cwd()]}},
 plugins:[{name:'source-trade-local-api',configureServer(server){
  server.middlewares.use(async(req,res,next)=>{
   const url=new URL(req.url,'http://127.0.0.1:5345');
   if(!url.pathname.startsWith('/api/'))return next();
   const json=(body,status=200)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(body));};
   try{
    if(req.headers.origin&&!['http://127.0.0.1:5345','http://localhost:5345'].includes(req.headers.origin))return json({error:'Origin rejected'},403);
    if(url.pathname==='/api/orders'){
     if(req.method==='GET')return json(existsSync(journal)?JSON.parse(readFileSync(journal,'utf8')):[]);
     if(req.method!=='POST'||req.headers['content-type']!=='application/json')return json({error:'Invalid request'},400);
     let body='';for await(const chunk of req){body+=chunk;if(body.length>2000000)throw Error('Body too large');}
     const order=JSON.parse(body);
     validateOrder(order);
     const orders=existsSync(journal)?JSON.parse(readFileSync(journal,'utf8')):[];
     orders.forEach(validateOrder);
     const i=orders.findIndex(o=>o.id===order.id);
     assertJournalUpdate(i<0?null:orders[i],order);
     if(i<0){if(orders.some(o=>o.account.toLowerCase()===order.account.toLowerCase()&&o.state!=='COMPLETED'&&o.state!=='CANCELLED'))return json({error:'Unfinished order exists. Recover it first.'},409);orders.unshift(order);}
     else orders[i]=order;
     mkdirSync(resolve('.local'),{recursive:true});writeFileSync(journal+'.tmp',JSON.stringify(orders,null,2)+'\n',{flush:true});renameSync(journal+'.tmp',journal);return json({saved:true});
    }
    if(url.pathname.startsWith('/api/rpc/')){
     if(req.method!=='POST')return json({error:'POST required'},405);
     const chain=Number(url.pathname.split('/').pop()),endpoint=chain===5042?process.env.ARC_RPC_URL:chain===56?process.env.BSC_RPC_URL:null;
     if(!endpoint)return json({error:'RPC not configured'},503);
     let body='';for await(const chunk of req){body+=chunk;if(body.length>100000)throw Error('Body too large');}
     const request=JSON.parse(body);if(!readMethods.has(request.method)||!Array.isArray(request.params))return json({error:'Read-only RPC method required'},403);
     let read;
     try{read=await readJson(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request)});}catch{return json({jsonrpc:'2.0',id:request.id,error:{code:-32002,message:'链上读取暂不可用，请刷新报价重试'}});}
     const {data,status}=read;
     if(status!==200)return json({jsonrpc:'2.0',id:request.id,error:{code:-32002,message:'链上读取暂不可用，请刷新报价重试'}});
     if(data.error)return json({jsonrpc:'2.0',id:request.id,error:{code:data.error.code,message:'链上读取失败，请重试'}});return json(data);
    }
    if(/^\/api\/lz\/0x[a-f0-9]{64}$/i.test(url.pathname)){if(req.method!=='GET')return json({error:'GET required'},405);const result=await readJson('https://scan.layerzero-api.com/v1/messages/guid/'+url.pathname.split('/').pop());return json(result.data,result.status);}
    if(url.pathname==='/api/lifi/quote'||url.pathname==='/api/lifi/status'){
     if(req.method!=='GET')return json({error:'GET required'},405);
     const endpoint=new URL('https://li.quest/v1/'+url.pathname.split('/').pop());endpoint.search=url.search;
     const result=await readJson(endpoint);return json(result.data,result.status);
    }
    return json({error:'Not found'},404);
   }catch{return json({error:'本地服务读取失败，请重试；原订单不会重新发送'},502);}
  });
 }}],
 build:{outDir:resolve('.local/source-trade-dist'),emptyOutDir:true}
});
