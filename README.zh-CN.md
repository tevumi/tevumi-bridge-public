# Tevumi Bridge

[English](README.md) · [简体中文](README.zh-CN.md)

Tevumi Bridge 现在以自己的社区演示代币 **Wobble Otter（WOTR）** 为主线：在 BNB Chain 买入、跨链到 Arc，并可选择兑换为原生 USDC；WOTR 双向独立跨链仍保留。币安人生和 CAT 是早期小额主网实验，已从公开页面资产列表下架，历史交易回执仍可查看。

**线上入口：**https://bridge.tevumi.com/ · **状态核对日期：**2026-10-05

**可选 USDC 出口：**Arc 兑换及原生 USDC 到账核验后，Swap 结果区会出现独立的 [Bridge USDC 页面](https://bridge.tevumi.com/preview/usdc/index.html)。该页接入 Circle Bridge Kit，动态显示支持的主网目标链、当前钱包 Arc USDC 余额和实时报价，与原有 LayerZero WOTR 桥是两条不同路线。**公网页面、只读 Arc→Base 报价已验证；尚无真实钱包 USDC 跨链及目的链到账证据。** 本功能使用真实 USDC 并产生费用，签名前请核对当时报价和钱包提示。

USDC 选链列表现显示图标与链名，并可搜索；没有对应图标的链使用字母标识。图标来自 MIT 许可的 [Web3 Icons](https://github.com/0xa3k5/web3icons)，只辅助识别；实际可用路线仍以 Circle SDK 与实时报价为准。

首页 Bridge 的 BNB Chain 与 Arc 方向卡片也显示图标和链名；切换方向时图标与名称一起交换。该视觉更新不改变 WOTR 跨链规则或钱包交易流程。

Tevumi Bridge 正在参与 **Arc Microgrants**：用户已于 9 月 28 日提交申请，提交成功页当时显示审核中；未记录获批或资助到账，不代表 Arc 或 Circle 官方背书。[`tevumi-bridge`](https://github.com/tevumi/tevumi-bridge) 是包含完整工作内容的**私有仓库**；独立的 [`tevumi-bridge-public`](https://github.com/tevumi/tevumi-bridge-public) 是供评审、开发者和测试用户阅读的筛查后**公开快照**，不包含内部运维、管理计划、凭据或私有 Git 历史。

## 已上线与已验证范围

| 路线 | 已验证结果 | 当前边界 |
| --- | --- | --- |
| 币安人生与 CAT 跨链 | 两种资产此前的双向主网发送和目标链到账回执均已独立核验。 | 10 月 4 日从公开资产列表下架；页面改动不删除合约或历史回执。 |
| WOTR 跨链 | 独立 BNB Chain ↔ Arc 通道及 500、700 WOTR 的真实主网往返均已独立核验。 | WOTR 与流动性由社区钱包控制，桥由另一管理钱包控制；发送前应重新核对实时暂停状态。 |
| WOTR 两侧池子 | BNB Chain 的 WOTR/BNB PancakeSwap V2 池与 Arc 的 WOTR/原生 USDC Uniswap V4 池均已建立并核验。 | 报价随实时池状态变化，建池和报价不保证交易收益。 |
| Buy / Bridge / Swap | 公网页面提供三个独立操作：BNB 买 WOTR、WOTR 双向跨链、Arc WOTR 兑换原生 USDC。改版前，同一测试钱包依次完成买入、GUID 匹配的跨链到账及 Arc 兑换，主网链上已独立核验。 | 用户报告使用当时的三步页面；链上不能证明具体网页会话。桥接与兑换数量包括钱包原有 WOTR。 |

**2026-10-03 同一测试钱包三步主网链路已独立核验。** 用户报告通过页面完成购买、跨链、兑换；链上核验显示：BNB Chain 用 `0.00007 BNB` 买到 `1024.763647745767238747 WOTR`（[买入](https://bscscan.com/tx/0xa11949a9398a5bf245005c794c4a80d2ef1a86b385316f0b10e4762332bf0b92)），随后发送 `1049 WOTR`（[去程](https://bscscan.com/tx/0xef1a5b41c2aa0b55e21dc27d1ac372dd13c7c9c5e7eb195936cd06c2e3d1d737)），Arc [到账](https://explorer.arc.io/tx/0xa385f2381f9abf5fe904c35d29b910a7ac4ef1988ebf0be525641decc7054a35)的 OFT GUID 与去程一致，最后在 Arc 将 `2549 WOTR` 兑换为 `0.133832577596989233` 原生 USDC（[兑换](https://explorer.arc.io/tx/0x7118a0ef9fae75e8627d94ea28de929e918bffbd1e4920e0c312e7b6dd029418)）。四笔成功交易来自/到账同一测试钱包，发生于 10:26:01–10:29:54 UTC。**数量不同是因钱包原有余额：买入前 BNB 侧已有 `24.390009870517457009 WOTR`，Arc 到账前已有 `1500 WOTR`。因此不可把兑换得到的 USDC 全归因于这次 `0.00007 BNB` 买入，也不可从链上单独证明使用的是哪一个网页会话。**私有仓库的详细证据见 [三步体验记录](docs/wotr-journey-design.md)。用户报告的页面操作与链上顺序吻合；页面来源仍属于用户提供信息。已成功交易勿重复签署；先按原哈希核验，网站回退不会撤销链上结果。

10 月 3 日较早的一笔独立 Arc 兑换还曾从同一钱包转出 500 WOTR，收到 `0.026254461000066494` 原生 USDC，另支付 `0.003656648866910364 USDC` Gas。交易哈希、证据及异常恢复见 [WOTR 三步体验记录](docs/wotr-journey-design.md)。

WOTR 合约地址：[BNB Chain](https://bscscan.com/token/0xB97b99cB6DC0EdBB89512e14100B2e9C23132eE5) `0xB97b99cB6DC0EdBB89512e14100B2e9C23132eE5`；[Arc](https://explorer.arc.io/address/0x70Cedd901366ad932203BBB08B22DcD4d4510028) `0x70Cedd901366ad932203BBB08B22DcD4d4510028`。

## 使用页面

当前首页使用顶部 Buy / Bridge / Swap 三入口、独立交易表单及随操作变化的路线说明或真实跨链进度；窄屏下内容改为单列。

连接钱包后，各操作只显示相关余额：Buy 显示 BNB Chain 的 BNB 与 WOTR；Bridge 显示来源链 WOTR 和用于 Gas 的资产，在到账核验后补充目标链 WOTR；Swap 显示 Arc WOTR 与原生 USDC。这些是只读快照，会在切换钱包或路线、交易确认后刷新；读取失败会显示暂不可用，不会误写为零。

首页现有 **Buy / Bridge / Swap** 三个操作入口，互相独立，不强制按顺序完成。目前 Buy 是在 BNB Chain 用 BNB 购买 WOTR；Bridge 支持 WOTR 在 BNB Chain 与 Arc 间双向跨链；Swap 是在 Arc 把 WOTR 兑换为原生 USDC。通用入口名称不代表已支持其他资产或交易路线。这些都是真实主网交易，必要的授权也需单独确认。每次签名前核对钱包里的网络、合约、数量、最低到账、消息费和 Gas。Arc 使用原生 USDC 支付 Gas，钱包需保留少量 USDC。交易结果仍在核验时，先用原交易哈希确认链上结果，不要重复发送。

Arc 兑换交易与原生 USDC 到账均核验后，Swap 页面才会显示前往官方 [Arc Portal](https://portal.arc.io/) 的可选入口。它会打开独立网站，不会自动授权钱包、存入 USDC 或发起新交易；核验未完成时入口保持隐藏。

10 月 3 日，用户提供截图显示已核验兑换后的 Portal 按钮，并报告点击后成功打开 `https://portal.arc.io/`。这是用户提供的页面显示与跳转验收，不代表已在 Portal 存入或使用 USDC。

未连接钱包时网站默认英文，且隐藏语言切换；连接后仍保持英文，只有用户主动选择才切换为简体中文；断开后恢复英文。

## 开发与文档

使用 Node.js 24 或更高版本，通过 `npm ci` 安装依赖。`npm test` 运行本地逻辑测试；线上首页用 `npx vite build --config vite.home.config.js` 构建，`npm run build` 构建另一套应用产物。跨链基于 LayerZero V2，为每种接入资产分别使用 BNB Chain OFTAdapter 和 Arc OFT。

项目先做本地测试和隔离主网分叉，再做受限主网验证；不在 BNB Chain/Arc 公共测试网部署真实资产服务，也不使用模拟钱包或 MockEndpoint 部署真实资产服务。私钥、助记词、令牌和含凭据的 RPC URL 不得提交到仓库。

从 [中文文档索引](docs/README.md) 或 [英文摘要](docs/README.en.md) 开始查阅；发布和验证边界见 [变更记录](docs/CHANGELOG.md)。`docs/` 含内部运维信息，复制到公开仓库前需审查。

新同事请先读 [项目与协作边界](docs/project-overview.md)。不得将私有仓库或 `docs/` 目录直接镜像到公开仓库。
