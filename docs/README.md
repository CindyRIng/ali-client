# ali-client 文档索引

> 把 **阿里国际站 alibaba.com** 的供应商搜索 / 供应商详情 / 地区字典 / 会员识别，封装为**本机常驻、只读、带缓存**的客户端：
> `CLI · REST · MCP · SKILL` 四通道；工程与同机 `zhilian-client` / `boss-client` / `tanji-client` 同构。
>
> **当前阶段：v0.1.0 已实现并本机常驻运行（systemd `ali-client.service`，REST 8792）。** 文档为设计基线与实现契约；✅=真机实测/已实现，📐=设计。
> 本项目与阿里巴巴官方无关；仅使用本人/授权账号做**低频、只读**查询（不询盘、不聊天、不收藏、不写后台）。

## 阅读顺序（建议）

1. **[README.md](../README.md)** —— 项目一页纸（定位、架构、快速了解）
2. **[00 需求访谈记录](./00-需求访谈记录.md)** —— 需求是怎么定下来的：Round 1–4、两轮探路结论、设计决策
3. **[01 需求文档（PRD）](./01-需求文档.md)** —— 完整需求：目标/非目标、术语、场景、架构、FR-1..FR-12、非功能、验收标准
4. **[02 接口设计](./02-接口草案.md)** —— 完整接口：操作、数据模型、CLI/REST/MCP、采集器/验证状态机、缓存 DDL、算法、错误与降级、测试策略
5. **[03 部署与使用](./03-部署与使用.md)** —— 安装、登录、CLI/REST/MCP 使用、systemd、排障
6. **[04 环境配套](./04-环境配套.md)** —— `~/cloak-env`、Chromium、profile、端口/数据目录、依赖锁定、NixOS 注意
7. **[05 会员体系与识别规则](./05-会员体系与识别规则.md)** —— 出口通/金品诚企/领袖卖家、字段映射、识别规则、样本
8. **[06 风控与人机验证](./06-风控与人机验证.md)** —— 滑块/x5sec 实测、自动过验证、异常恢复、人工中继、合规
9. **[实测报告](../exploration/2026-11-15/REPORT.md)** + **[探路证据](../exploration/2026-11-15/README.md)** —— 上游证据与复现方式

## 文档清单

| 文档 | 内容 | 状态 |
|---|---|---|
| [README.md](../README.md) | 项目概览、架构图、约定、状态 | ✅ v1.0 |
| [00 需求访谈记录](./00-需求访谈记录.md) | Round 1–4 结论、两轮探路、设计决策、评审结论 | ✅ v0.4 |
| [01 需求文档 PRD](./01-需求文档.md) | 背景/目标/非目标、术语、场景、架构、FR-1..FR-12、非功能、验收、里程碑 | ✅ v1.0 + 已实现 |
| [02 接口设计](./02-接口草案.md) | 操作清单、数据模型、CLI/REST/MCP/SKILL、采集器/验证状态机、SQLite DDL、领域算法、错误矩阵、可观测、测试、版本、样例 | ✅ v1.0 + 已实现 |
| [03 部署与使用](./03-部署与使用.md) | 前置要求、安装、登录、CLI/REST/MCP 使用、systemd、FAQ、排障、安全 | ✅ v0.1.0 已验证 |
| [04 环境配套](./04-环境配套.md) | cloak-env、版本表、cloak-run、profile 隔离、端口/数据目录、依赖锁定、env 模板、NixOS | ✅ 实测环境 |
| [05 会员体系与识别规则](./05-会员体系与识别规则.md) | 四层模型、字段映射、Supplier Index、识别规则、样本、误判边界、来源 | ✅ 已落地实现 |
| [06 风控与人机验证](./06-风控与人机验证.md) | 风控要素、触发矩阵、过验证策略、x5sec、异常恢复、中继协议、合规、演练 | ✅ 已落地实现 |
| [实测报告](../exploration/2026-11-15/REPORT.md) | 两轮真机探路：请求链路、字段、匿名对照、fetch-first、分页边界、验证治理 | ✅ 实测 |
| [探路证据](../exploration/2026-11-15/README.md) | artifacts 索引 + daemon 脚本复现说明 | ✅ |

## 上游接口速查

| 用途 | 调用 |
|---|---|
| 搜索 | worker 页内 `fetch(https://www.alibaba.com/trade/search?...&tab=supplier&page=N)` → 解析 `window._PAGE_DATA_` |
| 详情 | worker 页跨域 `POST https://<sub>.en.alibaba.com/event/app/alisite/render.htm`，`componentKeys=shopSign,companyCard,companyOverview` |
| 工厂目录 | `GET https://insights.alibaba.com/openservice/gatewayService?modelId=10300&endpoint=pc&categoryIds=0&pageNo=N&pageSize=100` |
| 语言/币种 | 首页语言/货币 React Select → en-US / USD |

## 约定（全文档一致）

| 项 | 值 |
|---|---|
| CLI | `ali` |
| REST | `127.0.0.1:8792`（loopback + Bearer） |
| MCP | server `ali-client`，工具前缀 `ali_`，stdio，默认代理 REST |
| 数据目录 | `~/.ali-client`（profile / cache / logs / run） |
| 环境变量前缀 | `ALI_` |
| systemd | `ali-client.service` |
| 采集策略 | anonymous-first + fetch-first（worker 页，导航仅兜底/过验证） |
| 省市 | 平台无官方筛选 → `locationMode=strict`(默认)/`keyword`/`off`；strict 回填 ≤60 家，城市未知保留标低置信度 |
| 分页 | `pages` 默认 5、硬上限 20；`totalCount` 不可靠，以 0 条终止 |
| 验证 | 导航触发；`x5sec`≈30min；自动拖拽 3 轮 + reload 重试；watchdog 15–20s；人工/二维码兜底 |
| 会员 | `verified_pro` > `verified_supplier` > `gold_supplier` > `unknown`；Supplier Index = `supplierStars` |

## 图例

- ✅ 实测：两轮真实浏览器探路验证过
- 📐 设计：文档阶段的设计约定，实现后回填实测
- ⚠️ 风险/待确认

## 变更记录

| 日期 | 版本 | 变更 |
|---|---|---|
| 2026-11-15 | v0.1 | 需求访谈 Round 1/2、首轮探路 |
| 2026-11-15 | v0.2 | 首轮实测报告、会员调研、接口草案 v0.1 |
| 2026-11-15 | v0.3 | 第二轮深挖（匿名完整性/fetch-first/验证治理），接口草案 v0.3 |
| 2026-11-15 | v1.0 | 完整文档体系：PRD、接口设计、部署、环境、会员、风控；目录整理 |

## 实现结果（2026-11-15）

- `npm run build` ✅；`npm test` ✅ 31/31；`npm run gen:check` ✅（生成物与实现同源）
- 本机常驻：`systemctl --user status ali-client` → running；`GET http://127.0.0.1:8792/v1/health` ✅
- 真实上游联调（匿名）：搜索（`solid tire` + 河北 strict，20 家回填 1 家命中）、按城市（衡水 10 家命中）、详情（Kangyuan：6 yrs / ♥♥ / 主营产品 / 金品 / SGS）、工厂目录（河北）、地区字典（31 省 342 市）
- MCP：16 个 `ali_*` 工具，stdio 冒烟通过（`scripts/mcp-smoke.mjs`）
- 端到端自测：`npm run self-test` → **35 passed**；全场景矩阵 `npm run e2e` → **125 passed / 0 failed**（2026-11-16）
- 详见 [实测报告 §13](../exploration/2026-11-15/REPORT.md)
