// In-memory local EVM only. No remote network or private key configuration.
export default {
  solidity: '0.8.30',
  networks: { local: { type: 'edr-simulated', chainType: 'l1', chainId: 31337 } },
};
