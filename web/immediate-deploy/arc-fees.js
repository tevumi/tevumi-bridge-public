// Arc may recommend no priority fee. Use the smallest positive value for wallet
// compatibility while keeping the maximum fee above the current gas quote.
export function arcFeeParams(gasPrice, baseFeePerGas, priorityFeePerGas) {
  const price = BigInt(gasPrice);
  const base = BigInt(baseFeePerGas);
  const recommendedTip = BigInt(priorityFeePerGas);
  const tip = recommendedTip === 0n ? 1n : recommendedTip;
  const maximumPrice = base * 2n + tip;
  if (price <= 0n || base <= 0n || recommendedTip < 0n || maximumPrice < price) {
    throw Error('Arc 费率报价异常。');
  }
  return {
    maximumPrice,
    maxPriorityFeePerGas: '0x' + tip.toString(16),
    maxFeePerGas: '0x' + maximumPrice.toString(16),
  };
}
