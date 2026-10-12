// Private experimental execution route. Never used without a pinned deployment.
import {Interface} from 'ethers';
export const fundingTuple='tuple(address user,uint256 amount,uint256 minimumOutput,bytes32 nonce,uint256 deadline,bytes32 dataHash)';
export const fundingTypes={FundingQuote:[{name:'user',type:'address'},{name:'amount',type:'uint256'},{name:'minimumOutput',type:'uint256'},{name:'nonce',type:'bytes32'},{name:'deadline',type:'uint256'},{name:'dataHash',type:'bytes32'}]};
export const fundingDomain=(chainId,verifyingContract)=>({name:'TevumiExperimentalFunding',version:'1',chainId,verifyingContract});
export const combinedInterface=new Interface([
 'function fund('+fundingTuple+' q,bytes data,bytes signature) payable',
 'function sellAndFund(bool useDex,uint256 amount,uint256 minimumMarket,'+fundingTuple+' q,bytes data,bytes signature)',
 'function buyAndBridge(bool useDex,uint256 spend,uint256 minimumArcAmount,uint256 maxMessageFee,uint256 deadline,bytes options) payable',
 'event FundingStarted(address indexed user,bytes32 indexed nonce,bytes32 indexed transactionId,uint256 amount,uint256 minimumOutput)',
 'event BoughtAndSent(address indexed user,bytes32 indexed guid,uint256 acquired,uint256 sent,uint256 dust,uint256 messageFee)',
 'event SoldAndFunded(address indexed user,uint256 tokens,uint256 received,uint256 funded,uint256 refunded)',
 'function fundingRouter() view returns(address)',
 'function quoteSigner() view returns(address)',
 'function destinationChain() view returns(uint256)',
 'function used(address,bytes32) view returns(bool)',
 'function token() view returns(address)',
 'function bridge() view returns(address)',
 'function curve() view returns(address)',
 'function dex() view returns(address)',
 'function wrappedNative() view returns(address)',
 'function conversion() view returns(uint256)',
]);
