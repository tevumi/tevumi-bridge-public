# Tevumi Bridge

[English](README.md) · [简体中文](README.zh-CN.md)

Tevumi Bridge 现在以自己的社区演示代币 **Wobble Otter（WOTR）** 为主线：在 BNB Chain 买入、跨链到 Arc，并可选择兑换为原生 USDC；WOTR 双向独立跨链仍保留。币安人生和 CAT 是早期小额主网实验，已从公开页面资产列表下架，历史交易回执仍可查看。

**线上入口：**https://bridge.tevumi.com/ · **状态核对日期：**2026-10-04

Tevumi Bridge 已提交 **Arc Microgrants** 申请，提交成功页当时显示审核中；不宣称获批、资助到账或 Arc/Circle 官方背书。本公开仓库是供 Arc 评审人员、开发者和参与测试用户阅读的筛查后源码快照。完整工作仓库为私有，包含内部运维与调研资料，不会直接镜像到这里。

## 已上线与已验证范围

| 路线 | 已验证结果 | 当前边界 |
| --- | --- | --- |
| 币安人生与 CAT 跨链 | 两种资产此前的双向主网发送和目标链到账回执均已独立核验。 | 10 月 4 日从公开资产列表下架；页面改动不删除合约或历史回执。 |
| WOTR 跨链 | 独立 BNB Chain ↔ Arc 通道及 500、700 WOTR 的真实主网往返均已独立核验。 | WOTR 与流动性由社区钱包控制，桥由另一管理钱包控制；发送前应重新核对实时暂停状态。 |
| WOTR 两侧池子 | BNB Chain 的 WOTR/BNB PancakeSwap V2 池与 Arc 的 WOTR/原生 USDC Uniswap V4 池均已建立并核验。 | 报价随实时池状态变化，建池和报价不保证交易收益。 |
| WOTR 三步体验 | 公网页面已加入“BNB 买入 WOTR → 跨至 Arc → 兑换原生 USDC”的引导，同时保留独立跨链。同一测试钱包依次完成买入、GUID 匹配的跨链到账及 Arc 兑换，主网链上已独立核验。 | 用户报告通过三步页面操作；链上不能证明具体网页会话。桥接与兑换数量包括钱包原有 WOTR。 |

10 月 3 日，同一测试钱包依次在主网[买入](https://bscscan.com/tx/0xa11949a9398a5bf245005c794c4a80d2ef1a86b385316f0b10e4762332bf0b92) `1024.763647745767238747 WOTR`、[跨链](https://bscscan.com/tx/0xef1a5b41c2aa0b55e21dc27d1ac372dd13c7c9c5e7eb195936cd06c2e3d1d737) `1049 WOTR`，在 Arc [到账](https://explorer.arc.io/tx/0xa385f2381f9abf5fe904c35d29b910a7ac4ef1988ebf0be525641decc7054a35)的 GUID 一致，随后[兑换](https://explorer.arc.io/tx/0x7118a0ef9fae75e8627d94ea28de929e918bffbd1e4920e0c312e7b6dd029418) `2549 WOTR` 得 `0.133832577596989233` 原生 USDC。BNB 买入前已有 `24.390009870517457009 WOTR`，Arc 到账前已有 `1500 WOTR`，不能把全部 USDC 归因于本次 BNB 买入。用户报告通过三步页面操作；链上可核对地址与顺序，不能核对具体浏览器会话。

10 月 3 日早些时候已独立核验测试钱包在 Arc 的 **500 WOTR→Permit2 授权**、后续 Permit2→Router 授权及真实兑换。[兑换交易](https://explorer.arc.io/tx/0x821ee152a638fd695e793daaccea79dde4b176d56c8900fa9b1edb3f2480a691)从钱包转出 500 WOTR，同一钱包收到 `0.026254461000066494` 原生 USDC，另支付 `0.003656648866910364 USDC` Gas。

WOTR 合约地址：[BNB Chain](https://bscscan.com/token/0xB97b99cB6DC0EdBB89512e14100B2e9C23132eE5) `0xB97b99cB6DC0EdBB89512e14100B2e9C23132eE5`；[Arc](https://explorer.arc.io/address/0x70Cedd901366ad932203BBB08B22DcD4d4510028) `0x70Cedd901366ad932203BBB08B22DcD4d4510028`。

## 使用页面

当前首页使用深绿操作侧栏、独立交易表单和随操作变化的路线说明；窄屏下三个入口移至顶部。

首页现有 **Buy / Bridge / Swap** 三个操作入口，互相独立，不强制按顺序完成。目前 Buy 是在 BNB Chain 用 BNB 购买 WOTR；Bridge 支持 WOTR 在 BNB Chain 与 Arc 间双向跨链；Swap 是在 Arc 把 WOTR 兑换为原生 USDC。通用入口名称不代表已支持其他资产或交易路线。这些都是真实主网交易，必要的授权也需单独确认。每次签名前核对钱包里的网络、合约、数量、最低到账、消息费和 Gas。Arc 使用原生 USDC 支付 Gas，钱包需保留少量 USDC。交易结果仍在核验时，先用原交易哈希确认链上结果，不要重复发送。

Arc 兑换交易与原生 USDC 到账均核验后，Swap 页面才会显示前往官方 [Arc Portal](https://portal.arc.io/) 的可选入口。它会打开独立网站，不会自动授权钱包、存入 USDC 或发起新交易；核验未完成时入口保持隐藏。

10 月 3 日，用户报告已核验兑换后按钮出现，点击可打开 Arc Portal。这属于用户反馈的页面跳转验收，不代表已在 Portal 存入或使用 USDC。

未连接钱包时网站默认英文，且隐藏语言切换；连接后仍保持英文，只有用户主动选择才切换为简体中文；断开后恢复英文。

## 开发与文档

本仓库是经过筛查的公开源码快照，与私有工作仓库分开。包含桥合约、公开页面及三步体验、本地测试和跨链记录索引；不包含内部运维文档、部署计划、服务器配置、凭据或私有 Git 历史。公开的合约地址与交易哈希属于链上数据，并非钱包凭据。

使用 Node.js 24 或更高版本，通过 `npm ci` 安装依赖。先运行 `npm run app:prepare` 生成本地产物，再运行 `npm test`；线上首页用 `npx vite build --config vite.home.config.js` 构建，`npm run build` 准备并构建另一套应用产物。跨链基于 LayerZero V2，为每种接入资产分别使用 BNB Chain OFTAdapter 和 Arc OFT。

项目先做本地测试和隔离主网分叉，再做受限主网验证；不在 BNB Chain/Arc 公共测试网部署真实资产服务，也不使用模拟钱包或 MockEndpoint 部署真实资产服务。私钥、助记词、令牌和含凭据的 RPC URL 不得提交到仓库。

本桥与币安人生或 CAT 的原币发行方没有从属关系。本仓库有意排除内部运维记录；当前状态及跨链记录请查看[线上页面](https://bridge.tevumi.com/)。
