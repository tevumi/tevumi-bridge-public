# Tevumi Bridge

**2026-10-10 · Swap 恢复原站布局：**源链成交现接入原来的 Swap 表单，与 Buy、Bridge 共用导航、钱包连接和语言切换。预估和核验结果显示在原表单，交易记录可展开查看，表单下方保留 Arc Portal 和 USDC 跨链卡片；此前独立生产地址自动返回此页面。自动流程仍须逐笔钱包确认，本次集成界面的新增真实钱包验收仍待完成。

**2026-10-09 · 源链成交已接入正式站：**[Swap](https://bridge.tevumi.com/preview/index.html?action=swap) 支持 Arc USDC → BNB Chain 买入 WOTR → Arc 到账，以及 Arc WOTR → BNB Chain 卖出 → Arc USDC 回款。资金通过 LI.FI，WOTR 通过 LayerZero；成交在源链完成，不依赖当前 WOTR 的 Arc 流动池。Buy、Bridge、Swap 使用同一当前 WOTR 合约 `0xe2a0ce4be658ee9b09e461f5283c718a20984444`。未毕业走 Four.meme，毕业后核验 PancakeSwap V2 池；实际毕业交易仍待验收。

报价自动更新。核对预估后点击「开始兑换」，自动推进授权和三步交易、更新后续报价并核验实际到账；每笔交易仍需在钱包确认。「暂停后续操作」在当前请求结束后停止新的钱包弹窗。刷新只恢复核验，后续签署须点击「继续兑换」。拒签、结果不明、部分到账或退款、报价变化及订单保存失败都会停止推进，不重试付款。首次连接需签名登录恢复服务器订单，此签名不转移资金。历史 WOTR 池保留独立入口。不增加额外数量或次数限制，余额、共享精度、合约容量和费用仍须满足。

真实钱包的小额双向闭环已独立验收，包含桥会计和余额/费用对账。该验收覆盖当前未毕业路线；退款、部分完成及其他智能钱包形式不视为已完成真实验收。资金滑点 0.5%，源链交易滑点 1%，每步报价有效 60 秒；Gas 和代币消息费另计，预留 BNB 留在钱包，全流程不锁价。单元、模拟钱包界面和公网接口检查已通过，发布后新增真实交易仍由用户签署。

本地独立入口：Node 24+，配置 BSC_RPC_URL / ARC_RPC_URL 后运行 `node --env-file-if-exists=.env node_modules/vite/bin/vite.js --config vite.source-trade.config.js`，打开 `http://127.0.0.1:5345/`。恢复核验需要可读取相关历史区块的 RPC；本地订单文件须保留。

Buy、Bridge、Swap 刷新后保留当前板块，通过各标签页的网址记录所在页面，保留其他查询参数和 hash；Bridge USDC 仍使用独立页面。

钱包恢复只锁定跨链模块自身控件；等待链上读取时仍可切换页面、语言与 Swap 方向，提交交易仍须等待钱包空闲及必要核验。

报价失败现区分资金池流动性不足与暂时无法获取报价；刷新失败会撤销旧报价，已完成的历史兑换不再覆盖当前表单提示，未完成交易继续核验并防重复提交。演示池流动性有限，小额有报价不代表更大金额可成交，请以实时结果为准。

[English](README.md) · [简体中文](README.zh-CN.md)

Tevumi Bridge 以 **Wobble Otter（WOTR）** 为主线：在 BNB Chain 买入当前代币，并在 BNB Chain 与 Arc 双向跨链。Swap 通过源链完成当前代币的买卖；旧池作为历史入口保留。


**历史记录 · 2026-10-08 双向池兑换：**在 Swap 点击方向按钮选择 USDC → WOTR，输入小额数量并刷新报价，再在钱包确认兑换。切换方向会清空数量和报价；服务器历史区分两种方向并保留旧 WOTR → USDC 记录。这里使用 18 位原生 USDC 精度，与 CCTP 的 6 位 ERC20 接口不同。本次未新建池或增加流动性。 原生 USDC 输入必须完整结算；若池子只能部分成交，交易会整体回退，不把未使用的付款留在 Router 中。

## 当前部署与权限

当前公开资产选择器仅支持 WOTR。币安人生与 CAT 已于 10 月 4 日下架；下文相关内容仅为历史实验，不代表当前提供服务。历史部署 JSON 不等于现行通道清单，见[部署身份与日期限额](config/README.md)。

线上 WOTR 桥由单个 EOA 控制的 ImmediateAdmin 管理，没有时间锁；仓库中的时间锁/治理候选合约不是线上 WOTR 桥。10 月 8 日只读快照显示两链单笔上限均为 1,000,000 WOTR，窗口参数接近 uint64 最大值，不构成有实际约束意义的每日风控额度。Arc Swap 现已支持 WOTR ↔ 原生 USDC，复用现有 Uniswap V4 池。反向兑换直接支付原生 USDC，无需代币授权；须另留原生 USDC 支付 Gas。双向隔离主网分叉与模拟钱包浏览器检查已通过，真实钱包主网反向兑换仍待用户验收。

**线上入口：**https://bridge.tevumi.com/ · **状态核对日期：**2026-10-07

线上四个板块现采用共享深色 Orbit 主题、薄荷绿控件及响应式装饰图；当前钱包图标与语言控件在桌面和手机上高度对齐。本次更新属于视觉层，保留原交易、授权和历史逻辑。

Buy、Bridge、Swap 现在只有右上角一个可见的钱包连接入口。Swap 页面在未连接钱包时也展示 Arc Portal 和独立 USDC 跨链两张卡片；没有已核验兑换时，Portal 卡片只做通用介绍，不声称已到账，已有核验结果仍可显示。10 月 7 日的本地及公网桌面/手机浏览器回归通过。

Buy、Bridge、Swap 和独立 Bridge USDC 的交易记录仅在连接钱包后显示。断开连接会隐藏并收起历史栏，不删除已保存的记录。

同一标签页在首页与 Bridge USDC 间跳转时，只有钱包插件仍授权同一账户才会自动恢复连接。没有交易哈希的 USDC 授权拒绝只留在浏览器历史中，不再重复显示“当前跨链记录”。

线上 Buy、Bridge、Swap 和独立 USDC 出口共用显式钱包选择弹窗。MetaMask 可选；OKX Wallet 仍显示图标和 Chrome 商店链接，禁用的连接项只注明“暂时不可用”。页面通过 EIP-6963 发现多个已安装钱包，把请求交给当前选中的钱包；本地及公网模拟钱包浏览器测试已通过。下述两笔真实 Arc→Ethereum USDC 跨链已核验，但截图不能确定实际签名的钱包插件；此前 OKX 风险提示的具体规则仍未知。在网站切换钱包不会自动撤销旧钱包插件保存的站点授权。

钱包选择弹窗现使用 MIT 许可的 [Web3 Icons](https://github.com/0xa3k5/web3icons) 中的 MetaMask 与 OKX 品牌图标，取代字母占位块；图标本身不代表该钱包当前可连接。

Buy 与 Swap 现有与 Bridge 风格统一、可折叠分页的交易记录。服务器按提交的交易哈希核对链上回执后保存已确认结果，包括链上失败。历史卡片按公开钱包地址从服务器读取，不在浏览器逐笔重查旧交易；已确认记录的时间采用区块时间。三笔此前已核验的测试钱包交易已补录。没有交易哈希的钱包拒绝仍只留在浏览器；当前余额和报价继续实时读取。

Swap 及原生 USDC 到账核验后，旧交易在“交易记录”中查看，不再重复显示于报价按钮下方。Portal 和 USDC 跨链后续卡片仍可使用；尚在核验的交易继续显示进度。

连接后，右上角按钮只显示当前页面正在使用的钱包的一枚图标；悬停或辅助阅读可查看钱包名称和完整地址，点击仍可重新选择。另一个钱包插件可能继续保存此前的网站授权，需在那个插件内手动移除。

**可选 USDC 出口：**Swap 页面在未连接钱包时也展示独立 [Bridge USDC 页面](https://bridge.tevumi.com/preview/usdc/index.html)入口；已核验兑换才附带对应的历史结果。该页接入 Circle Bridge Kit，动态显示支持的主网目标链、当前钱包 Arc USDC 余额和实时报价，与原有 LayerZero WOTR 桥是两条不同路线。10 月 6 日测试钱包两笔各 2 USDC 的 Arc→Ethereum 跨链已在目标链独立核验，分别铸造到账 `0.356427` 和 `0.379543 USDC`。另有一笔 [1 USDC Arc→Base 销毁](https://explorer.arc.io/tx/0x1f0c1c81364a671e1fd43327c8f30b770945ce4ec8edbdfc5d6bf3bad53d3426)及 [Base 实际到账 0.945120 USDC](https://basescan.org/tx/0xad717c16deedc4870b0bbb59d327a849d7801409c8d1ad65263abbf9c3c26ece)已核验。Circle 执行转发费为 `0.054880 USDC`，Arc 授权和销毁另付 `0.003812982 USDC` Gas；这是本笔实际值，不是固定费用。本功能使用真实 USDC 并产生费用，签名前请核对当时报价和钱包提示。

USDC 选链列表现显示图标与链名，并可搜索；没有对应图标的链使用字母标识。图标来自 MIT 许可的 [Web3 Icons](https://github.com/0xa3k5/web3icons)，只辅助识别；实际可用路线仍以 Circle SDK 与实时报价为准。

USDC 页面现有按连接钱包分页的服务器跨链历史。只有 Arc 的 CCTP 销毁回执经服务器核验才入库；EVM 目标链还须匹配 Circle 消息并核验目标链，才显示已到账。浏览器仍保存未完成交易的 SDK 恢复资料，不能单凭本地状态认定到账。两笔已核验转账分别有独立的 [Arc 源链交易](https://explorer.arc.io/tx/0xe9dd83d6f3c335d08b3f6788764a8b292507c36ea1d5b85a33e85a836c416766)（[第二笔](https://explorer.arc.io/tx/0x0ead19c06fa31b2f861d5f12b4eb0e9f7c1a38f1e928b58d86bdc2de968565aa)）及匹配的 [Ethereum 铸造交易](https://etherscan.io/tx/0x1be1c71e3fa0f638026e4ae29dab661293322b84e5ef28c31c4574a61265df7b)（[第二笔](https://etherscan.io/tx/0xf8e15edfd378e32fbae9536543ddd51e4bd2e8b7678bfc822c3afc76aea2d473)）。SDK 报告完成但目标链尚未核验时，页面仍提供独立的新操作入口；使用前应先核对源链交易。若钱包拒绝授权且页面未保存交易哈希，再次尝试前请先核对钱包活动；若已经记录源链交易，应先核对并恢复原跨链，不要重新发起一笔。

服务器核验目标链到账后，页面自动展开“跨链记录”并清空上一笔表单，已完成交易不再重复显示为“当前跨链记录”。尚未完成独立到账核验的交易仍保留当前状态，以便检查或恢复。

针对 10 月 5 日用户报告的 OKX Wallet 风险拦截，单纯关闭 SDK 的合并交易仍未解除警告。当前 USDC 页面改用 Circle SDK 的标准 Arc CCTP TokenMessengerV2 路径，并核对其官方主网地址；页面突出显示高额目标链费用和准确授权增额。本地 Arc 主网分叉已验证授权和源链销毁。10 月 6 日较早一次 OKX 复测仍受拦截，具体规则未知；之后两笔 Arc→Ethereum 真实到账已核验，但不能仅凭截图判定签名插件。新报价费用及 Gas 不高于已展示报价时可一次点击继续；上涨时须再确认。不要绕过钱包警告；无源链哈希的拒签归入浏览器历史，不误称链上处理中。

首页 Bridge 的 BNB Chain 与 Arc 方向卡片也显示图标和链名；切换方向时图标与名称一起交换。该视觉更新不改变 WOTR 跨链规则或钱包交易流程。

已核验的历史 Arc 兑换结果下方，Portal 与 USDC 跨链两张卡片的按钮统一宽高并底部对齐。历史结果与上方新兑换表单分开；点击卡片本身不会自动转移资产。

Tevumi Bridge 正在参与 **Arc Microgrants**：用户已于 9 月 28 日提交申请，提交成功页当时显示审核中；未记录获批或资助到账，不代表 Arc 或 Circle 官方背书。[`tevumi-bridge`](https://github.com/tevumi/tevumi-bridge) 是包含完整工作内容的**私有仓库**；独立的 [`tevumi-bridge-public`](https://github.com/tevumi/tevumi-bridge-public) 是供评审、开发者和测试用户阅读的筛查后**公开快照**，不包含内部运维、管理计划、凭据或私有 Git 历史。

## 已上线与已验证范围

| 路线 | 已验证结果 | 当前边界 |
| --- | --- | --- |
| 币安人生与 CAT 跨链 | 两种资产此前的双向主网发送和目标链到账回执均已独立核验。 | 10 月 4 日从公开资产列表下架；页面改动不删除合约或历史回执。 |
| WOTR 跨链 | 独立 BNB Chain ↔ Arc 通道及 500、700 WOTR 的真实主网往返均已独立核验。 | WOTR 与流动性由社区钱包控制，桥由另一管理钱包控制；发送前应重新核对实时暂停状态。 |
| WOTR 两侧池子 | BNB Chain 的 WOTR/BNB PancakeSwap V2 池与 Arc 的 WOTR/原生 USDC Uniswap V4 池均已建立并核验。 | 报价随实时池状态变化，建池和报价不保证交易收益。 |
| Buy / Bridge / Swap | 公网页面提供三个独立操作：BNB 买 WOTR、WOTR 双向跨链、Arc WOTR 兑换原生 USDC。改版前，同一测试钱包依次完成买入、GUID 匹配的跨链到账及 Arc 兑换，主网链上已独立核验。 | 用户报告使用当时的三步页面；链上不能证明具体网页会话。桥接与兑换数量包括钱包原有 WOTR。 |

**2026-10-03 同一测试钱包三步主网链路已独立核验。** 用户报告通过页面完成购买、跨链、兑换；链上核验显示：BNB Chain 用 `0.00007 BNB` 买到 `1024.763647745767238747 WOTR`（[买入](https://bscscan.com/tx/0xa11949a9398a5bf245005c794c4a80d2ef1a86b385316f0b10e4762332bf0b92)），随后发送 `1049 WOTR`（[去程](https://bscscan.com/tx/0xef1a5b41c2aa0b55e21dc27d1ac372dd13c7c9c5e7eb195936cd06c2e3d1d737)），Arc [到账](https://explorer.arc.io/tx/0xa385f2381f9abf5fe904c35d29b910a7ac4ef1988ebf0be525641decc7054a35)的 OFT GUID 与去程一致，最后在 Arc 将 `2549 WOTR` 兑换为 `0.133832577596989233` 原生 USDC（[兑换](https://explorer.arc.io/tx/0x7118a0ef9fae75e8627d94ea28de929e918bffbd1e4920e0c312e7b6dd029418)）。四笔成功交易来自/到账同一测试钱包，发生于 10:26:01–10:29:54 UTC。**数量不同是因钱包原有余额：买入前 BNB 侧已有 `24.390009870517457009 WOTR`，Arc 到账前已有 `1500 WOTR`。因此不可把兑换得到的 USDC 全归因于这次 `0.00007 BNB` 买入，也不可从链上单独证明使用的是哪一个网页会话。**详细内部证据留在私有仓库。用户报告的页面操作与链上顺序吻合；页面来源仍属于用户提供信息。已成功交易勿重复签署；先按原哈希核验，网站回退不会撤销链上结果。

10 月 3 日较早的一笔独立 Arc 兑换还曾从同一钱包转出 500 WOTR，收到 `0.026254461000066494` 原生 USDC，另支付 `0.003656648866910364 USDC` Gas。详细证据及异常恢复步骤留在私有仓库。

WOTR 合约地址：[BNB Chain](https://bscscan.com/token/0xB97b99cB6DC0EdBB89512e14100B2e9C23132eE5) `0xB97b99cB6DC0EdBB89512e14100B2e9C23132eE5`；[Arc](https://explorer.arc.io/address/0x70Cedd901366ad932203BBB08B22DcD4d4510028) `0x70Cedd901366ad932203BBB08B22DcD4d4510028`。

## 四阶段主网流程已核验 — 2026-10-07

同一测试钱包已完成 Buy → WOTR Bridge → Swap → Bridge USDC 到 Base。独立只读核验确认成功回执、LayerZero OFT GUID 和数量匹配、Arc 兑换付款、Circle CCTP 消息与已使用 nonce，以及 Base 向该钱包实际铸造的 USDC。用户报告通过网站完成这些操作；链上证明钱包和交易顺序，不能识别具体网页会话。

测试钱包：`0x67bfb3BeF4f4A3Cb25Bc529E948d40bcfc0874CD`。

| 操作 | 时间（10 月 7 日 UTC） | 已核验结果 | 交易 |
| --- | --- | --- | --- |
| Buy · BNB Chain | 04:43:41 | 0.00007 BNB → 1022.636152494306730568 WOTR | [查看交易](https://bscscan.com/tx/0x52080a3dadbf09271b9c5fd5f1a9145d67de7adcb99e469da2ac2ee578af7f93) |
| Bridge · BNB Chain | 04:50:18 | 1000 WOTR 转出 | [查看交易](https://bscscan.com/tx/0x37709766402a213e07d491df151b9c6d416a9f26c1b83f0a0feb33cf5a600201) |
| Bridge · Arc | 04:50:39 | 1000 WOTR 到账 | [查看交易](https://explorer.arc.io/tx/0x58136fad15ac9f4cac33374707e6561d5806044d595f74b6df896dae80e2e2a8) |
| Swap · Arc | 05:21:42 | 1000 WOTR → 0.052498171057709016 原生 USDC | [查看交易](https://explorer.arc.io/tx/0x5c3f16111ae274873ab938edbc43732a251d68555c3011a04cdd6f6659c5a7b0) |
| Bridge USDC · Arc | 05:38:49 | 0.4 USDC 销毁 | [查看交易](https://explorer.arc.io/tx/0x1b908dc805133f643692514dc50ddc9650f9819c2e1cc1fd28713dbd30fe8f1e) |
| Bridge USDC · Base | 05:38:59 | 0.345503 USDC 到账; 0.054497 USDC 转发费用 | [查看交易](https://basescan.org/tx/0xc99829f0bc6ade5bcdf9f6b09ec52c4728193a5609bab1038060693782275181) |

这组交易证明四个功能步骤使用真实主网资产打通，**不是单次买入的收益计算**。钱包已有余额；后续跨出的 0.4 USDC 高于本次兑换得到的约 0.052498 USDC，因此包含钱包原有 USDC。兑换数额为扣除 Arc Gas 前所得，Base 到账已扣除 CCTP 转发费用。WOTR 是演示代币；历史核验不保证未来报价或转账结果。

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

本公开快照提供源码和上方中英文项目概览。详细运维文档及内部变更记录留在私有仓库；任何内容对外发布前均须单独审查。

新同事编辑或发布前应先向维护者获取私有项目与协作边界文档。不得将私有仓库或其 `docs/` 目录直接镜像到公开仓库。

Swap 现在提供 **授权并兑换**：网页点一次，按需逐笔请求精确额度授权，等待确认后再请求兑换。钱包仍需分别确认，首次缺少两层授权时最多三次。兑换保留原最低到账，新报价低于该值、授权失败或钱包改变时停止；取消兑换保留已确认授权。本地及公网页面模拟钱包回归通过；用户随后报告真实兑换成功，回执及付款已独立核验。链上不能单独证明网页点击次数。
