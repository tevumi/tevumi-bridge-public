import markup from './widget.html?raw';
import {bridgeView,selectedWalletProvider} from '../immediate-deploy/live.js';
const card=document.getElementById('source-swap-card');
card.innerHTML=markup;
let controller;
const ready=import('./main.js').then(module=>controller=module);
let syncing=Promise.resolve();
function sync(){syncing=syncing.catch(()=>{}).then(async()=>{await ready;const view=bridgeView();await controller.syncHostWallet(selectedWalletProvider(),view.account);});return syncing;}
window.addEventListener('tevumi:bridge-view',()=>void sync());
window.addEventListener('tevumi:journey-tab',()=>void sync());
window.addEventListener('tevumi:locale-change',()=>{controller?.syncHostLanguage();});
void sync();
