// Network artwork from @web3icons/core 4.0.57 (MIT). Unknown networks use initials.
import arc from '@web3icons/core/svgs/networks/branded/arc.svg.js';
import arbitrum from '@web3icons/core/svgs/networks/branded/arbitrum-one.svg.js';
import avalanche from '@web3icons/core/svgs/networks/branded/avalanche.svg.js';
import base from '@web3icons/core/svgs/networks/branded/base.svg.js';
import codex from '@web3icons/core/svgs/networks/branded/codex.svg.js';
import cronos from '@web3icons/core/svgs/networks/branded/cronos.svg.js';
import ethereum from '@web3icons/core/svgs/networks/branded/ethereum.svg.js';
import hyperEvm from '@web3icons/core/svgs/networks/branded/hyper-evm.svg.js';
import injective from '@web3icons/core/svgs/networks/branded/injective.svg.js';
import ink from '@web3icons/core/svgs/networks/branded/ink.svg.js';
import linea from '@web3icons/core/svgs/networks/branded/linea.svg.js';
import monad from '@web3icons/core/svgs/networks/branded/monad.svg.js';
import optimism from '@web3icons/core/svgs/networks/branded/optimism.svg.js';
import plasma from '@web3icons/core/svgs/networks/branded/plasma.svg.js';
import plume from '@web3icons/core/svgs/networks/branded/plume.svg.js';
import polygon from '@web3icons/core/svgs/networks/branded/polygon.svg.js';
import sei from '@web3icons/core/svgs/networks/branded/sei-network.svg.js';
import solana from '@web3icons/core/svgs/networks/branded/solana.svg.js';
import sonic from '@web3icons/core/svgs/networks/branded/sonic.svg.js';
import unichain from '@web3icons/core/svgs/networks/branded/unichain.svg.js';
import world from '@web3icons/core/svgs/networks/branded/world.svg.js';
import xdc from '@web3icons/core/svgs/networks/branded/xdc.svg.js';
import xLayer from '@web3icons/core/svgs/networks/branded/x-layer.svg.js';

const artwork = new Map([
  ['Arc', arc], ['Arbitrum', arbitrum], ['Avalanche', avalanche], ['Base', base],
  ['Codex Mainnet', codex], ['Cronos', cronos], ['Ethereum', ethereum],
  ['HyperEVM', hyperEvm], ['Injective', injective], ['Ink', ink], ['Linea', linea],
  ['Monad', monad], ['Optimism', optimism], ['Plasma', plasma], ['Plume', plume],
  ['Polygon', polygon], ['Sei', sei], ['Solana', solana], ['Sonic', sonic],
  ['Unichain', unichain], ['World Chain', world], ['XDC', xdc], ['X Layer', xLayer],
]);

export function iconFor(name) {
  const svg = artwork.get(name);
  return svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : null;
}

export function chainBadge(name) {
  const badge = document.createElement('span');
  badge.className = 'chain-badge';
  const icon = iconFor(name);
  if (icon) {
    const image = document.createElement('img');
    image.src = icon;
    image.alt = '';
    image.width = 26;
    image.height = 26;
    badge.append(image);
  } else {
    badge.classList.add('chain-badge-fallback');
    badge.textContent = name.split(/\s+/).map(part => part[0]).join('').slice(0,2).toUpperCase();
  }
  return badge;
}
