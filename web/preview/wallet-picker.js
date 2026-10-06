import './wallet-picker.css';

const STORES = {
  metamask: 'https://chromewebstore.google.com/detail/metamask/nkbihfbeogaeaoehlefnkodbefgpgknn',
  okx: 'https://chromewebstore.google.com/detail/okx-wallet/mcohilncbfahbmgdjkbpemcciiolgcge',
};

const announced = [];
window.addEventListener('eip6963:announceProvider', event => {
  const {info,provider} = event.detail || {};
  if (typeof provider?.request !== 'function' || announced.some(item => item.provider === provider)) return;
  announced.push({provider,name:info?.name || '',rdns:info?.rdns || ''});
});

function discoveredWallets() {
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  const choices = [...announced];
  const add = (provider,name,rdns='') => {
    if (typeof provider?.request === 'function' && !choices.some(item => item.provider === provider)) choices.push({provider,name,rdns});
  };
  add(window.okxwallet,'OKX Wallet','com.okex.wallet');
  for (const provider of window.ethereum?.providers || []) add(provider,provider.isOkxWallet || provider.isOKExWallet ? 'OKX Wallet' : provider.isMetaMask ? 'MetaMask' : 'Browser wallet');
  add(window.ethereum,window.ethereum?.isOkxWallet || window.ethereum?.isOKExWallet ? 'OKX Wallet' : window.ethereum?.isMetaMask ? 'MetaMask' : 'Browser wallet');
  return choices;
}

function brand(item) {
  const name = `${item.name} ${item.rdns}`.toLowerCase();
  if (/metamask/.test(name)) return 'metamask';
  if (/okx|okex/.test(name)) return 'okx';
  if (item.provider?.isOkxWallet || item.provider?.isOKExWallet) return 'okx';
  if (item.provider?.isMetaMask) return 'metamask';
  return null;
}

let dialog;
function walletDialog() {
  if (dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.className = 'tevumi-wallet-dialog';
  dialog.setAttribute('aria-labelledby','tevumi-wallet-title');
  document.body.append(dialog);
  return dialog;
}

export async function pickWallet(language='en') {
  const zh = language === 'zh-CN';
  const choices = discoveredWallets();
  // Wallets may announce after initial page load. A short discovery window keeps
  // the explicit user choice independent of whichever extension owns window.ethereum.
  await new Promise(resolve => setTimeout(resolve,200));
  const available = [...announced, ...choices].filter((item,index,list) => list.findIndex(other => other.provider === item.provider) === index);
  const ordered = ['metamask','okx'].map(kind => available.find(item => brand(item) === kind));
  const other = available.filter(item => !brand(item));
  const modal = walletDialog();
  modal.replaceChildren();
  const head = document.createElement('div'); head.className='tevumi-wallet-head';
  const title = document.createElement('h2'); title.id='tevumi-wallet-title'; title.textContent=zh?'选择钱包':'Choose a wallet';
  const close = document.createElement('button'); close.type='button'; close.className='tevumi-wallet-close'; close.setAttribute('aria-label',zh?'关闭':'Close'); close.textContent='×';
  head.append(title,close); modal.append(head);
  const help = document.createElement('p'); help.className='tevumi-wallet-help'; help.textContent=zh?'明确选择要用于连接和签名的钱包。':'Choose the wallet that will connect and handle signatures.'; modal.append(help);
  const rows = document.createElement('div'); rows.className='tevumi-wallet-rows'; modal.append(rows);
  let resolveChoice;
  const outcome = new Promise(resolve => {resolveChoice=resolve;});
  let settled=false;
  const finish = value => {if (settled) return; settled=true; modal.close(); resolveChoice(value);};
  close.onclick=()=>finish(null);
  modal.oncancel=event=>{event.preventDefault();finish(null);};
  modal.onclick=event=>{if (event.target===modal) finish(null);};
  for (const [index,kind] of ['metamask','okx'].entries()) {
    const item=ordered[index];
    const row=document.createElement('div'); row.className='tevumi-wallet-row';
    const option=document.createElement('button'); option.type='button'; option.className='tevumi-wallet-option'; option.disabled=!item;
    const emblem=document.createElement('span'); emblem.className=`tevumi-wallet-emblem ${kind}`; emblem.setAttribute('aria-hidden','true'); emblem.textContent=kind==='metamask'?'M':'OKX';
    const copy=document.createElement('span'); copy.className='tevumi-wallet-copy';
    const name=document.createElement('strong'); name.textContent=kind==='metamask'?'MetaMask':'OKX Wallet';
    const state=document.createElement('small'); state.textContent=item ? (zh?'已检测到 · 点击连接':'Detected · connect') : (zh?'未检测到插件':'Extension not detected');
    copy.append(name,state); option.append(emblem,copy);
    if (item) option.onclick=()=>finish({provider:item.provider,name:name.textContent});
    const install=document.createElement('a'); install.href=STORES[kind]; install.target='_blank'; install.rel='noopener noreferrer'; install.textContent=zh?'Chrome 商店 ↗':'Chrome Web Store ↗'; install.setAttribute('aria-label',`${name.textContent} · Chrome Web Store`);
    row.append(option,install); rows.append(row);
  }
  for (const item of other) {
    const option=document.createElement('button'); option.type='button'; option.className='tevumi-wallet-other'; option.textContent=item.name || (zh?'其他浏览器钱包':'Other browser wallet'); option.onclick=()=>finish({provider:item.provider,name:option.textContent}); rows.append(option);
  }
  modal.showModal();
  close.focus();
  return outcome;
}
