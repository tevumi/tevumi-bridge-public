// A local-fork-only chain history. No remote signing network is configured.
export default {
  solidity: '0.8.30',
  chainDescriptors: {
    56: {name: 'BNB Chain fork', chainType: 'l1', hardforkHistory: {cancun: {blockNumber: 0}}},
    5042: {name: 'Arc fork', chainType: 'l1', hardforkHistory: {cancun: {blockNumber: 0}}},
  },
  networks: {local: {type: 'edr-simulated', chainType: 'l1', chainId: 31337}},
};
