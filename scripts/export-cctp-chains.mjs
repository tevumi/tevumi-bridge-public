import {writeFileSync} from 'node:fs';
import {BridgeKit} from '@circle-fin/bridge-kit';

const chains = new BridgeKit().getSupportedChains({isTestnet:false})
  .filter(chain => chain.cctp?.contracts?.v2 && Number.isInteger(chain.cctp.domain))
  .map(chain => ({
    name: chain.name,
    type: chain.type,
    domain: chain.cctp.domain,
    chainId: chain.chainId || null,
    rpc: chain.type === 'evm' ? chain.rpcEndpoints?.[0]?.url || chain.rpcEndpoints?.[0] || null : null,
    tokenMessenger: chain.cctp.contracts.v2.tokenMessenger,
    messageTransmitter: chain.cctp.contracts.v2.messageTransmitter,
  }));
const domains = chains.map(chain => chain.domain);
if (new Set(domains).size !== domains.length || !chains.some(chain => chain.name === 'Arc' && chain.domain === 26)) {
  throw Error('Unexpected Circle Bridge Kit CCTP chain configuration');
}
writeFileSync('ops/transfer-history/cctp-chains.json', `${JSON.stringify({sdk:'@circle-fin/bridge-kit@1.15.2',chains},null,2)}\n`);
