# Tevumi Bridge

[English](README.md) · [简体中文](README.zh-CN.md)

Tevumi Bridge 支持**币安人生**、**CAT** 和社区演示代币 **Wobble Otter（WOTR）** 在 BNB Chain 与 Arc 之间分别跨链。每种资产都有独立通道，跨链后仍是同一种资产；“币安人生”在中英文界面都保留中文名称。

**线上入口：**https://bridge.tevumi.com/ · **状态核对日期：**2026-10-03

Tevumi Bridge 已提交 **Arc Microgrants** 申请，提交成功页当时显示审核中；不宣称获批、资助到账或 Arc/Circle 官方背书。本公开仓库是供 Arc 评审人员、开发者和参与测试用户阅读的筛查后源码快照。完整工作仓库为私有，包含内部运维与调研资料，不会直接镜像到这里。

## 已上线与已验证范围

| 路线 | 已验证结果 | 当前边界 |
| --- | --- | --- |
| 币安人生与 CAT 跨链 | 两种资产的双向主网发送和目标链到账回执均已独立核验。 | 仍为小额主网开发路线；页面在签名前读取当前链上限额与费用。 |
| WOTR 跨链 | 独立 BNB Chain ↔ Arc 通道及 500、700 WOTR 的真实主网往返均已独立核验。 | WOTR 与流动性由社区钱包控制，桥由另一管理钱包控制；发送前应重新核对实时暂停状态。 |
| WOTR 两侧池子 | BNB Chain 的 WOTR/BNB PancakeSwap V2 池与 Arc 的 WOTR/原生 USDC Uniswap V4 池均已建立并核验。 | 报价随实时池状态变化，建池和报价不保证交易收益。 |
| WOTR 三步体验 | 公网页面已加入“BNB 买入 WOTR → 跨至 Arc → 兑换原生 USDC”的引导，同时保留独立跨链。 | 每个操作需单独在钱包确认，必要时还有代币授权。Arc 兑换调用通过隔离主网分叉测试；新版页面的真实钱包完整三步尚未验收。 |

10 月 3 日已独立核验测试钱包在 Arc 的 **500 WOTR → Permit2 授权**成功。这只是授权，**不是兑换成 USDC**。最后一次核对时，后续的 Router 授权与实际 Arc 兑换尚未完成。

WOTR 合约地址：[BNB Chain](https://bscscan.com/token/0xB97b99cB6DC0EdBB89512e14100B2e9C23132eE5) `0xB97b99cB6DC0EdBB89512e14100B2e9C23132eE5`；[Arc](https://explorer.arc.io/address/0x70Cedd901366ad932203BBB08B22DcD4d4510028) `0x70Cedd901366ad932203BBB08B22DcD4d4510028`。

## 使用页面

选择 **Bridge an asset** 可直接跨链；选择 **WOTR journey · 3 steps** 可按购买、跨链、兑换的顺序操作。这些都是独立的真实主网交易，必要的授权也需单独确认。每次签名前核对钱包里的网络、合约、数量、最低到账、消息费和 Gas。Arc 使用原生 USDC 支付 Gas，目标钱包需保留少量 USDC。交易结果仍在核验时，先用原交易哈希确认链上结果，不要重复发送。

未连接钱包时网站默认英文，且隐藏语言切换；连接后仍保持英文，只有用户主动选择才切换为简体中文；断开后恢复英文。

## 开发与文档

本仓库是经过筛查的公开源码快照，与私有工作仓库分开。包含桥合约、公开页面及三步体验、本地测试和跨链记录索引；不包含内部运维文档、部署计划、服务器配置、凭据或私有 Git 历史。公开的合约地址与交易哈希属于链上数据，并非钱包凭据。

使用 Node.js 24 或更高版本，通过 `npm ci` 安装依赖。先运行 `npm run app:prepare` 生成本地产物，再运行 `npm test`；线上首页用 `npx vite build --config vite.home.config.js` 构建，`npm run build` 准备并构建另一套应用产物。跨链基于 LayerZero V2，为每种接入资产分别使用 BNB Chain OFTAdapter 和 Arc OFT。

项目先做本地测试和隔离主网分叉，再做受限主网验证；不在 BNB Chain/Arc 公共测试网部署真实资产服务，也不使用模拟钱包或 MockEndpoint 部署真实资产服务。私钥、助记词、令牌和含凭据的 RPC URL 不得提交到仓库。

本桥与币安人生或 CAT 的原币发行方没有从属关系。本仓库有意排除内部运维记录；当前状态及跨链记录请查看[线上页面](https://bridge.tevumi.com/)。
