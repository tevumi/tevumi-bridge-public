# Tevumi Bridge

[English](README.md) · [简体中文](README.zh-CN.md)

Tevumi Bridge 支持**币安人生**与 **CAT** 在 BNB Chain 和 Arc 之间分别跨链。同一资产在两条链之间转移，**不提供币安人生与 CAT 的互换**。“币安人生”是代币名称，在英文和中文界面都保留中文。

跨链入口：**https://bridge.tevumi.com/**

公网跨链桥目前处于主网小额开发验证阶段。币安人生和 CAT 均已完成独立核验的 BNB Chain → Arc 及 Arc → BNB Chain 跨链。截至 2026 年 9 月 27 日，已核验的双向单笔上限是每资产 **0.000002 枚**。每笔最低 **0.000001 枚**；发送前会重新核对链上限额及可用额度。这里使用真实主网资产，并支付真实消息费和 Gas。钱包确认前请核对网络、合约、数量及费用；交易结果不明时，先用原交易哈希核验，不要直接重发。

未连接钱包时，网站默认显示英文。连接后，右上角出现语言切换，可选择 English 或简体中文；选择保存在当前浏览器中。断开钱包后页面回到英文。

## 开发

使用 Node.js 24，通过 `npm ci` 安装锁定的依赖。先运行 `npm run app:prepare` 生成本地合约产物，再运行 `npm test`；`npm run build` 也会生成产物并构建浏览器应用。项目使用 LayerZero V2，为每个接入资产分别配置 BNB Chain 的 OFTAdapter 和 Arc 的 OFT。

项目不在 BNB Chain 或 Arc 公共测试网部署。先进行本地测试与主网分叉检查，再进行受控的小额主网验证。不得把私钥或 RPC 凭据写入仓库。

此公开源码快照包含桥合约、应用代码、本地测试和跨链记录索引服务，不包含内部运维记录或部署凭据。公开说明同时提供英文和简体中文。

## 主网证据

下表每行是一笔跨链，由来源链交易和目标链到账交易组成。两种资产均另有独立核验的 Arc→BNB Chain 返回；公开哈希可从线上应用的跨链记录查看。

| 资产 | BNB Chain 发送 | Arc 到账 |
| --- | --- | --- |
| CAT | [发送交易](https://bscscan.com/tx/0x8609f47dee546e8d9e5671dde2921df419d7d5be49430c5930670d35fe91131d) | [到账交易](https://explorer.arc.io/tx/0x24cffb2ce643383d7fa844948aeabbe51acb9ba9df538aecca6ad276a18cbae9) |
| 币安人生 | [发送交易](https://bscscan.com/tx/0x9b88d57294261c6652898f6181b6ce7b5ad373fe9394664ee325f6e053b33522) | [到账交易](https://explorer.arc.io/tx/0x6492b6e601b783a5bff3823a5c13d4a7e24356c99fc7161fe0bedc5e0b20b0e8) |

本桥未获两种原币发行方背书。Arc 上的对应资产应以桥合约地址识别；当前不声称已拥有 Arc DEX 流动性或第三方代币上架。
