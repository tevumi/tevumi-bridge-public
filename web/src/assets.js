import candidates from '../../config/meme-candidates.json' with { type: 'json' };
export const assets = Object.freeze([{id:'tvpilot',name:'TVPILOT',symbol:'TVPILOT',enabled:true},...candidates.assets.map(a=>Object.freeze({...a,symbol:a.id==='cat'?'CAT':'币安人生',enabled:false}))]);
let selected='tvpilot';
export function selectedAsset(){return assets.find(a=>a.id===selected);}
export function selectAsset(id){if(!assets.some(a=>a.id===id))throw new Error('未知资产');selected=id;}
export function requirePilotAsset(){if(selected!=='tvpilot')throw new Error('真实资产合约尚未部署与核验，暂不能授权、配置或发送。');}
