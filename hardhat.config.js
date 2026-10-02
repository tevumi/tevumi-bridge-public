// In-memory local EVM only. No remote network or private key configuration.
export default {
  solidity: '0.8.30',
  // Execution history for isolated BNB mainnet forks; no production network is configured.
  chainDescriptors: { 56: { name: 'BNB Chain', chainType: 'l1', hardforkHistory: { cancun: { blockNumber: 0 } } } },
  networks: { local: { type: 'edr-simulated', chainType: 'l1', chainId: 31337 } },
};
