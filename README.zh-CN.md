# Tevumi Bridge

[English](README.md) · [简体中文](README.zh-CN.md)

更新：2026-10-12。[在线应用](https://bridge.tevumi.com/) · [现用合约身份](config/current-routes.json)。

Tevumi提供社区演示代币 **Wobble Otter（WOTR）** 的BNB Chain买卖、BNB Chain↔Arc跨链、Arc发起USDC↔WOTR兑换和独立USDC跨链。操作使用真实主网资产并产生费用。已验证小额真实交易，不宣称已完成独立审计或全面正式运营安全验收。

## 当前四个页面

| 页面 | 功能 | 报价方式 |
| --- | --- | --- |
| 购买 | BNB Chain上的BNB↔WOTR买卖 | 浏览器只读市场合约 |
| 跨链 | BNB Chain与Arc间转移WOTR | 浏览器读取桥消息费用 |
| 兑换 | 从Arc发起USDC↔WOTR并核验Arc到账 | 所属钱包会话服务器查询资金/市场报价 |
| USDC跨链 | 从Arc发送USDC到支持的目标链 | 浏览器Circle Bridge Kit及链上估算 |

现用原币是BNB Chain的0xE2A0CE4bE658Ee9b09E461f5283C718a20984444，Arc对应OFT为0x0FC104231002E1DA57EC5aF516f9CACa6C4F7BfB。旧固定供应WOTR及旧池只为历史恢复保留；当前默认Swap**不使用Arc WOTR流动池**。

## 兑换体验与边界

页面点击一次开始，随后确认钱包交易：买入两笔；卖出需要授权时三笔，已有足额授权时两笔。精确授权可能被消耗，不能承诺后续卖出都只有两次。连接、登录与切换网络可能另有提示。

交易使用用户自己的资产，不需要项目代币库存或周转本金。当前交易在BNB市场成交后核验Arc实际交付；未毕业走已验证的Four.meme路径，毕业后实现校验PancakeSwap V2路径，实际毕业主网成交尚未验收。

金额输入结束后自动预估，有效期内复用；闲置、隐藏或离开兑换页面暂停预估轮询。限流按接口要求等待。提交前重新获取受保护的实际报价，预估缓存不能直接授权或提交付款。各段分别报价和确认，Gas/消息费另计，全流程不锁价、不保证完成时间；余留BNB与精度尾数归用户。

完成记录放在交易历史里，修改金额或切换方向即可查看新预估，无额外“开始另一笔订单”按钮。未提交拒签记为取消；已提交或结果不明时继续保护原交易，刷新不会自动重复付款。

## 历史、钱包与权限

四页历史都从服务器读取，不用浏览器或链上扫描结果兜底历史卡片。浏览器日志仅用于未完成恢复和防重复。操作报告、来源回执、目的到账分别核验，不能把SDK完成或前端标记直接当作实际到账。

检测到钱包时可选择MetaMask；四页OKX Wallet暂不可用，旧OKX会话不自动恢复。中英文功能一致、语言偏好保存。不绕过钱包风险警告。真实交易由用户钱包签署；登录签名、服务器限定报价签署均不代替用户付款确认。

现用桥为ImmediateAdmin/EOA管理，不使用多签或timelock。独立治理候选与旧Timelock部署记录均不代表现用桥配置。资金入口固定router、目标链与限定报价身份，不据此宣称已审计。前端不加人为数量/次数上限，但余额、共享精度、Gas、合约容量与暂停状态仍约束操作。

## 当前技术栈

| 层 | 实现 |
| --- | --- |
| 前端 | 原生JavaScript、HTML/CSS、Vite 8.3.0、ethers 6.17.0 |
| WOTR桥 | LayerZero V2/OFT，BNB锁定释放、Arc铸造销毁 |
| Swap入口 | Solidity 0.8.30，合并买入/发送与卖出/付款 |
| 市场 | Four.meme及校验后的PancakeSwap V2毕业路径 |
| 资金报价 | LI.FI API，API Key只在后端 |
| USDC跨链 | Circle Bridge Kit 1.15.2、adapter-viem-v2 1.19.0、CCTP V2 |
| 服务 | Node.js 24+/SQLite的Swap订单；Python/SQLite的其他页面历史 |
| 验证 | Node测试、Hardhat 3.17.0本地/主网分叉、Playwright 1.63.0 |

版本来自仓库锁定依赖，不代表外部最新版本。Uniswap V4、Permit2、旧代币与治理候选仍留作历史或独立开发。当前前端入口为web/preview/journey.js、web/immediate-deploy/live.js、web/source-trade/main.js和web/preview/usdc/main.js；现用与历史资产在web/src/wotr-routes.js分离。contracts/experimental目录下三个Swap入口现已部署，目录名不等于仍未上线。

## 已验证与未验证

当前代币买卖、WOTR双向交付和Swap双向小额主网交易已独立核对原回执、实际到账、锁仓及服务器状态。最近1 USDC买入Arc实收146649.477509 WOTR；随后卖出295636 WOTR（含旧余额），Arc实收0.902775 USDC并另退BNB，不能当成同本金收益比较。

历史Arc→Ethereum与Arc→Base USDC交付已验收，不代表Circle所有目标链/所有钱包风控均已验收。毕业DEX、退款/部分到账、其他智能钱包与独立审计未全部完成。模拟或分叉测试不代替真实主网证明；不部署公共测试网。

## 本地阅读与验证

Node.js 24+，安装锁定依赖后：

```sh
npm ci
node --test test/combined-engine.test.mjs test/combined-order.test.mjs test/source-trade-read.test.mjs
npx vite build --config vite.home.config.js
npm run compile
node --test test/swap-buy-and-bridge.test.mjs test/swap-sell-and-fund.test.mjs
```

产品产物为dist-home。通过npx vite --config vite.home.config.js --host 127.0.0.1 --port 5294 --strictPort启动，打开http://127.0.0.1:5294/preview/web/preview/index.html?action=buy（可换action=bridge或swap）；USDC页路径为/preview/web/preview/usdc/index.html。终端默认/preview/会404，不是源码页面入口。该配置没有生产API代理，连接钱包后的真实功能需兼容的同源服务器。测试只用隔离钱包，不广播。npm run dev是较早开发应用，不是线上四页产品；独立source-trade开发入口保留旧流程，不能自动启用已部署的两段后台。

公开仓库包含逐项筛查的前端、通用合约与可复现测试，不包含生产签署身份、后台部署配置或内部资料，也不是私有Git历史的镜像。

## 项目背景

根据项目所有者提供的记录，Arc Microgrants申请于2026-09-28提交；不声称获资助或Arc/Circle背书。[config说明](config/README.md)区分现用身份和历史部署。产品更新不会重写旧合约或真实回执。
