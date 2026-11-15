# 阿里巴巴国际站（alibaba.com）供应商会员/认证体系与页面识别规则

> 调研对象：alibaba.com 英文站（含当前中文语言环境下的买家侧页面）
> 证据基线：`exploration/2026-11-15/artifacts/search.page_data.json`、`search.html`、`search.png`（只读）
> 结论口径：**公开资料/官方说明**、**本地证据**、**推断**分开标注；置信度用「高 / 中 / 低 / 待实测」表示。

---

## 结论先行

1. **主会员档位是三层**：出口通（Gold Supplier，官方定价页再分 Basic / Plus 子包）→ 金品诚企（Verified Supplier）→ 行业领袖（Verified Pro / 领袖卖家）。金品包含出口通；行业领袖包含金品。
2. **“Verified Supplier / 认证供应商”就是金品诚企的英文会员名与徽章**；“Assessed Supplier / 深度认证”不是另一个独立档位，而是金品的第三方实地评估层（旧称/别名）。本地字段 `isAssessedSupplier`、筛选参数 `assessmentCompany=true` 对应的就是这个层。
3. **“Verified Pro / 领袖卖家”是身份标，不是单独售卖的套餐**。它授予“行业领袖”或“品牌领航”商家，位于金品之上；因此不能把 `goldYears >= 5` 直接当成 Verified Pro。
4. **Trade Assurance（信用保障）是交易保障，P4P（直通车）/ 顶展（Top Sponsor Listing）是广告**；三者都不是会员档位，不能用来判断金品/领袖。
5. **页面识别优先级**：`verifiedSupplierPro === true` → Verified Pro；否则 `isAssessedSupplier === true` → 金品/Verified Supplier；否则 `goldYears > 0` → 至少出口通；再否则 `UNKNOWN`。`memberTag`、`type`、`reviewScore`、`reviewCount` **不能**判档。
6. **Supplier Index 是平台综合绩效指数（SOPI），不是店铺评分**。它和 `reviewScore`（买家评价均分，如 4.6/5）、`reviewCount`（评价条数）是三个不同指标；搜索页 JSON 里没有 Supplier Index，需从详情/公司页接口取，具体字段名**待实测**。

---

## 0. 证据与口径

### 0.1 本地证据（只读）

| 编号 | 文件 | 用途 |
|---|---|---|
| L1 | `exploration/2026-11-15/artifacts/search.page_data.json` | `snData` 筛选器定义、`offerResultData.offerList` 21 张供应商卡 |
| L2 | `exploration/2026-11-15/artifacts/search.html` | `window._PAGE_DATA_` 原始 JSON、卡片 DOM、`Top sponsor listing` 文案 |
| L3 | `exploration/2026-11-15/artifacts/search.png` | 买家侧实际渲染：`Trade Assurance`、`Verified 供应商`、`Verified PRO 供应商` |
| L4 | `https://kangyuanxiangsu.en.alibaba.com/company_profile.html` | 公开公司页，含 `Supplier Index` tooltip、`Verified Supplier` 徽章 alt、`Custom Manufacturer` 身份字段 |

### 0.2 公开资料（官方 / 第三方）

**官方或平台自有内容（优先）**

- 卖家定价页（三档套餐、权益表）：[seller.alibaba.com/pricing](https://seller.alibaba.com/pricing?tracelog=angle)
- 金品/Verified Supplier 官方介绍与 Gold Supplier 对比：[seller.alibaba.com/verified_supplier](https://seller.alibaba.com/verified_supplier)
- 金品诚企服务说明（第三方验厂、报告、视频、橱窗）：[fuwu.alibaba.com/jpcq/home.htm](https://fuwu.alibaba.com/jpcq/home.htm)
- 阿里官方新闻：Verified Supplier = 金品诚企：[alibabanews.com](https://www.alibabanews.com/alibabacom%E5%86%8D%E5%8D%87%E7%B4%9A%E9%87%91%E5%93%81%E8%AA%A0%E4%BC%81%E8%AA%8D%E8%AD%89/)
- 金品诚企认证流程（官方卖家站）：[supplier.alibaba.com PX002DN8C](https://supplier.alibaba.com/trade/domestic/PX002DN8C.htm)
- 出口通 vs 金品诚企（官方卖家站对比）：[supplier.alibaba.com PX002DPRY](https://supplier.alibaba.com/trade/domestic/PX002DPRY.htm)
- Supplier Online Performance Index（SOPI，0–5 级）：[activity.alibaba.com/helpcenter/SOPI.html](https://activity.alibaba.com/helpcenter/SOPI.html)
- Trade Assurance 规则（付费 Gold Supplier + 验真、买家免费、卖家 3%）：[activity.alibaba.com/ggs/tradeassurance.html](https://activity.alibaba.com/ggs/tradeassurance.html)
- 顶级展位（Top Sponsor Listing，首位/皇冠/一关键词只售一名）：[activity.alibaba.com/ad_digital_marketing/8a779a3d.html](https://activity.alibaba.com/ad_digital_marketing/8a779a3d.html)
- Alibaba 买家侧供应商验真说明（Verified / Gold / Assessed 三分法）：[alibaba.com/featured/supplier-verification.html](https://www.alibaba.com/featured/supplier-verification.html)
- Verified Supplier 三种服务类型（Custom Manufacturer / Multispecialty / Brand Holder）：[reads.alibaba.com](https://reads.alibaba.com/ultimate-guide-alibaba-verified-suppliers/)
- 商品页三种徽章示例（Verified as Custom Manufacturer / Evaluated as top-rated supplier / Recognized as Verified Pro Supplier）：[商品页](https://www.alibaba.com/product-detail/China-manufacturer-ABS-3-star-ping_1600456086677.html)

**第三方/行业资料（交叉验证，不作为唯一依据）**

- 2025 年三档年费与定位（出口通 3.58 万、金品 9 万、行业领袖最高）：[reportify 转载](https://reportify.cn/news/1158048082148069376)
- 2024 年权益对比表（橱窗、子账号、数据参谋、星级直达等）：[搜狐](https://www.sohu.com/a/781009578_121192132)
- Verified Pro 身份标规则（2023 年 3 月推出；必须是行业领袖/品牌领航；新店招才显示）：[语雀](https://www.yuque.com/chaike/yingxiao/ouapmu7xpe7ql2fp)
- SOPI/Star Rating 的四个维度、每月 5 日更新：[techTongBo](https://www.techtongbo.com/post/how-valuable-is-alibaba-s-merchant-star-rating-for-global-buyers)
- 交易等级/Orange Heart 旧显示：[Jungle Scout](https://www.junglescout.com/blog/what-is-alibaba/)
- 顶级展位中文说明：[连连支付](https://global.lianlianpay.com/article/MTE0MzMwLDQ1NQ.html)
- 抓取器字段（SOPI level 1–5、review_score 分离）：[Apify schema](https://apify.com/devcake/alibaba-supplier-scraper/output-schema)

### 0.3 置信度约定

| 级别 | 含义 |
|---|---|
| 高 | 本地 JSON 直接可见 + 官方页面可互相印证 |
| 中 | 官方页面有说明，但存在版本/地区/术语差异，或只有第三方佐证 |
| 低 | 只有间接证据/行业文章，需实测 |
| 待实测 | 当前证据不足，必须抓页面/接口确认 |

---

## 1. 套餐体系全景

### 1.1 四层模型：会员 / 认证 / 交易保障 / 广告

| 层 | 是什么 | 包含哪些东西 | 是否付费档位 |
|---|---|---|---|
| **A. 会员档位** | 商家每年购买的店铺级别 | 出口通（Gold Supplier Basic）、Gold Supplier Plus（中间档，中文名待确认）、金品诚企（Verified Supplier）、行业领袖（Verified Pro/领袖卖家） | 是 |
| **B. 认证/验真标识** | 对商家身份、工厂、能力的第三方核验 | 金品的第三方实地评估（Assessed/深度认证）、Verified Supplier 徽章、Verified Custom Manufacturer（认证制造商类型）、ISO/BSCI/CE 等公司/产品认证 | 多数含在档位内；认证本身不是档位 |
| **C. 交易保障** | 订单/支付保障 | Trade Assurance（信用保障） | 否；卖家按订单收 3% 服务费 |
| **D. 广告/流量** | 付费购买曝光 | P4P/外贸直通车（按点击）、顶展/Top Sponsor Listing（固定首位）、问鼎/品牌直达（品牌广告） | 否；可单独买，也可被高层级套餐部分包含 |

> **一句话**：A 是“你是谁”；B 是“平台/第三方替你证明了什么”；C 是“订单出问题怎么办”；D 是“你额外买了多少曝光”。

### 1.2 包含关系

```text
出口通 / Gold Supplier (Basic)
  └─ 金品诚企 / Verified Supplier
       ├─ 含出口通全部权益
       ├─ 第三方实地评估（Assessed / 深度认证）
       ├─ Verified Supplier 徽章 + 专属筛选
       └─ 更多橱窗/RFQ/子账号/星级直达/AI 额度
            └─ 行业领袖 / 品牌领航
                 ├─ 含金品 + 出口通全部权益
                 ├─ Verified Pro 身份标（不是单独售卖档位）
                 └─ 顶级展位/品牌直达/行业解决方案/OKKI CRM Pro AI 等

Trade Assurance：横切所有付费档位（官方要求付费 Gold Supplier + 验真）
P4P / 顶展 / 问鼎：广告资源，可单独购买；高层级套餐可能含额度或优先购买权
```

### 1.3 中文名 ↔ 英文站 UI ↔ 平台字段/参数

| 中文名（卖家侧/常见叫法） | 英文站 UI / 常见英文 | 平台字段 / 筛选参数 | 性质 | 置信度 |
|---|---|---|---|---|
| **出口通** | **Gold Supplier**；官方定价页写作 **Gold Supplier Basic** | 无显式档位字段；`goldYears > 0` 表示 Gold Supplier 年限 | 基础付费会员 | 高 |
| （中间档） | **Gold Supplier Plus** | 未发现字段 | 会员档位（官方定价页有，中文名/国内售卖待确认） | 中/待实测 |
| **金品诚企**（金品） | **Verified Supplier**；中文 UI 可能显示“Verified 供应商” | `isAssessedSupplier = true`；筛选 `assessmentCompany=true` | 高级付费会员（含第三方实地评估） | 高 |
| **深度认证 / 评估供应商** | **Assessed Supplier**；公司页文案 “assessed / verified on-site” | `isAssessedSupplier`；`assessmentCompany` | 金品的第三方评估层/旧称，不是独立档位 | 中 |
| **领袖卖家 / 行业领袖** | **Verified Pro**；**Verified Pro Supplier**；中文 UI “Verified PRO 供应商” | `verifiedSupplierPro = true`；筛选 `verifiedPro=1` | 顶层会员/定向邀约 + 身份标 | 中高 |
| **认证制造商 / 定制制造商** | **Verified Custom Manufacturer**；商品页 “Verified as Custom Manufacturer” | 搜索卡未发现；公司页 `authIdentityInfo.identityName = "Custom Manufacturer"` | 供应商身份/能力类型，不是档位 | 中 |
| **信用保障** | **Trade Assurance** | 筛选 `ta=y`；详情页 `hasTradeAssurance` | 交易保障 | 高 |
| **外贸直通车** | **P4P / Keyword Advertising** | 广告跟踪字段 `isP4P`（本地顶展卡为 false） | 点击付费广告 | 高 |
| **顶级展位 / 顶展** | **Top Sponsor Listing**（页面也见 “Top Sponsored listing”） | 本样本：`adInfo`、`tpText`、`isTopRank`、`campaignType=56`、`qtag=76` | 固定首位广告 | 高 |
| **问鼎 / 品牌直达** | Top brand / Brand direct | 本地样本未出现 | 品牌广告 | 中 |

### 1.4 关键术语冲突（很重要）

公开资料对 “Verified Supplier / Assessed Supplier” 的用法**并不完全一致**，必须用字段而不是文案：

1. **卖家侧（本次调研的主口径）**：`Verified Supplier` 是金品诚企这个付费会员档位，包含 SGS/TÜV 等第三方**实地验厂**、评估报告、验厂视频、Verified 徽章。阿里官方新闻直接写 “Verified Supplier 金品诚企”，卖家定价页也把 Verified Supplier 作为高于 Gold Supplier 的套餐。  
   → 对应：`isAssessedSupplier = true`、`assessmentCompany = true`。

2. **买家帮助页的旧/泛化口径**：`Verified Supplier` 被描述为“基础法律注册核验”，`Assessed Supplier` 才是“第三方实地检查”。这与卖家侧“Verified Supplier 含实地验厂”的表述冲突。  
   → 这是**术语层冲突**，不应据此把 `Verified Supplier` 当成“低配认证”。做客户端时应以 `isAssessedSupplier` + `assessmentCompany` 为准，文案只做展示。

3. **商品页的展示变体**：同一供应商可能同时出现 “Verified as Custom Manufacturer”“Evaluated as top-rated supplier”“Recognized as Verified Pro Supplier” 三个徽章，分别对应“制造商身份”“评估/优选”“Verified Pro 身份”，进一步说明它们是**不同维度**，不是三个互斥套餐。

4. **中文 UI 的混用**：本地 `snData` 的筛选名是“金品诚企”“领袖卖家”，但同一页面截图显示“Verified 供应商”“Verified PRO 供应商”。所以**不能按中文/英文文案匹配**，必须按 `key`/`id`/`href` 查询参数和布尔字段匹配。

---

## 2. 权益差异（高层级）

### 2.1 年费量级

> 官方定价页不公开具体数字，只写“pricing and benefits vary by region，以本地客户经理报价为准”。下表是公开资料的量级，**不是官方报价**。

| 档位 | 年费量级（人民币） | 来源/置信度 | 说明 |
|---|---:|---|---|
| 出口通 / Gold Supplier Basic | **约 3.58 万/年** | 第三方 2025 报道（中） | 基础入驻；不含第三方深度验厂 |
| Gold Supplier Plus | 未确认 | 官方定价页只列名称（待实测） | 介于出口通与金品之间的区域包/升级包 |
| 金品诚企 / Verified Supplier | **约 8–9 万/年** | 2024 年 8 万、2025 年 9 万，第三方（中） | 含第三方实地评估、Verified 徽章 |
| 行业领袖 / Verified Pro | **约 50 万/年，定向邀约** | 第三方 2024 报道（中） | 不是自助购买；针对行业头部/品牌企业 |

### 2.2 权益对比

下表把“官方 2026 定价页”和“中文第三方 2024 权益表”放在一起；出现数字不一致时，以“官方口径/量级”优先，并注明差异。

| 权益项 | 出口通（Gold Supplier Basic） | 金品诚企（Verified Supplier） | 行业领袖（Verified Pro/领袖卖家） |
|---|---|---|---|
| 定位 | 入门付费会员，低门槛试水 | 高级会员，强调第三方验真/品牌 | 顶层会员，行业头部/品牌型，定向邀约 |
| 店铺/装修 | 基础旺铺/迷你站 | Verified 迷你站、验厂视频、360/VR 工厂展示 | 金品全部 + 品牌视觉、品牌保护、行业解决方案 |
| 产品发布数 | 不限（2026 定价页） | 不限 | 不限 |
| 经营类目数 | 3 个（2026 定价页；旧资料 2 个） | 不限（2026 定价页；旧资料 3–4 个） | 不限/3–4 个（按合同） |
| 橱窗/展示位 | 20 个（2026 定价页；旧资料 2 组） | 60 个（2026 定价页；旧资料 8 组） | 60+ / 24 组（旧资料；按合同） |
| RFQ 报价 | 20 条/月 | 60 条/月 | 更高/按合同 |
| 子账号 | 5 个 | 10 个（旧资料 10 个） | 20 个（旧资料 20 个） |
| 认证与验厂 | 营业执照/基础验真 | 第三方实地验厂 + 评估报告 + 验厂视频 + 360/VR | 金品全部 + 更高等级认证/品牌保护 |
| 专属徽章/筛选 | Gold Supplier | Verified Supplier 徽章 + 专属筛选 + 专属展馆 | Verified Pro 徽章 + 首页/搜索/详情全链路展示 |
| 星级直达 | 无 | 4 星直达（符合条件可 5 星）/ 6 个月 | 4/5 星机会 + 合同期内星级保护（不掉 0 星） |
| 专属流量 | 基础搜索/活动 | Verified 筛选、找工厂/制造商入口、专属展馆 | 顶级展位、品牌直达、行首楼层、黑珍珠榜单等 |
| AI 工具 | 300 条 Message Copilot/月；图片 20、视频 5、数据 5 credits/月 | **不限量**（2026 定价页：Message Copilot、图片、视频、数据均 Unlimited） | 金品全部 + OKKI CRM Pro AI |
| 数据参谋 | 普通版/5 credits | 专业版/不限量（2026 页） | 专业版/不限量 |
| 广告 | 可单独买 P4P/顶展 | 可单独买；部分套餐含广告额度/抵扣 | 含顶级展位/品牌直达等资源（按合同） |
| 信用保障 | 可申请（需付费 Gold Supplier + 验真） | 可申请；首次基础授信额度高约 4,000–6,000 美金 | 金品全部，额度/服务按合同 |

> **数字差异说明**：2026 官方定价页把“产品发布”统一为 unlimited，把差异放在“类目数/橱窗/RFQ/子账号/星级直达/AI 额度”；2024 中文资料则用“橱窗 2/8/24 组、子账号 5/10/20”表述。两者不是矛盾，而是**年份/地区/套餐版本**不同。报告中保留区间，避免把某一个数字当成永久规则。

### 2.3 谁包含谁 / 常见误解

- **金品是否包含 Verified/Assessed？**  
  是。当前 packaging 下，金品 = Verified Supplier 套餐；第三方实地评估（Assessed/深度认证）是金品的核心交付物，Verified 徽章是它的展示结果。没有发现“单独购买 Assessed 但不买金品”的公开 SKU。置信度：中高。

- **领袖卖家是不是“金品里的头部”？**  
  不完全是。更准确的说法是：**行业领袖是金品之上的独立顶层会员/邀约计划**；“领袖卖家/Verified Pro”是授予行业领袖/品牌领航商家的身份标。它包含金品权益，但不是金品套餐内部的一个子等级。置信度：中高。

- **出口通能不能买 Verify/Assessed？**  
  公开资料显示第三方实地评估是金品的核心组成；出口通只有基础验真。若市场上存在“单独深度认证”服务，当前公开页面没有清晰 SKU，需实测。置信度：中。

- **认证制造商（Verified Custom Manufacturer）是不是一个档位？**  
  不是。它是 Verified Supplier 的三种服务类型之一（Custom Manufacturer / Multispecialty / Brand Holder），是**身份/能力标签**，可以与金品/领袖并存。置信度：中。

- **Trade Assurance / P4P / 顶展是不是会员？**  
  不是。TA 是订单保障；P4P 是按点击广告；顶展是固定首位广告。它们可以单独购买，也可以被高层级套餐部分包含。置信度：高。  
  **准入口径补充**：官方页面写的是“付费 Gold Supplier + 提交验真”；另有第三方资料称部分免费供应商也可申请。以官方页面为准，单卡是否有 TA 需详情接口实测。该官方页较旧（写单笔上限 US$5,000），当前费率/上限以平台最新规则为准。

---

## 3. 从页面数据判断会员档位（可执行规则）

### 3.1 字段语义（以本地 21 张卡为准）

| 字段/参数 | 类型/示例 | 语义 | 对档位判断的作用 | 置信度 | 误判/注意 |
|---|---|---|---|---|---|
| `isAssessedSupplier` | `true` / `false` | 是否通过第三方评估（金品/Verified Supplier） | **true → 金品** | 高 | false 可能是未评估/评估过期/未展示；true 也不等于当前合同一定在有效期内 |
| `verifiedSupplierPro` | `true` / `false` | 是否 Verified Pro（领袖卖家/行业领袖） | **true → Verified Pro** | 高（true）/中（false） | false 可能是店招未升级/未展示；不能反推“不是” |
| `goldYears` | `"6 年"` / `"18 年"` / 英文 `"6 yrs"` | Gold Supplier 年限（不是公司年龄、不是档位） | **>0 → 至少出口通** | 中高 | 18 年也可能只是出口通；`>=5` 不等于 Verified Pro |
| `memberTag` | `"1200000207,1200000268,..."` | 内部标签 ID 集合 | **不能判档** | 低 | 评估/非评估都出现；有金品卡为空；无公开映射 |
| `iconList` | 图片 URL 数组 | 徽章图标 | 有评估徽章 → 金品（交叉校验） | 中 | 广告卡可有 2 个图标；URL 会变；不能按数量判 Pro |
| `tag` | `["深度定制","成品验货",...]` | 产能/能力标签 | 与评估强共现，弱校验 | 中低 | 语义是产能，不是会员；非评估卡可能没有 |
| `type` | `"freeBlock"` | 卡片模板类型 | **不能判档** | 高（否定） | 广告卡也是 `freeBlock`；不是商家类型/贸易类型 |
| `reviewScore` | `"4.6"` | 店铺评价均分（0–5） | **不能判档** | 高（否定） | `0.0` 可能只是没有评价；与 Supplier Index 不同 |
| `reviewCount` | `10` | 店铺评价条数 | **不能判档** | 高（否定） | 同上 |
| `replyAvgTime` | `"≤3h"` | 平均响应时间 | **不能判档** | 高（否定） | 服务质量指标，不是档位 |
| `staff` / `area` | `"30+ 名员工"` / `"5,000+ m²"` | 工厂人数/面积 | 弱校验（评估卡常见） | 低 | 贸易公司/未评估卡可能没有；不是档位 |
| `transactions` | `"US $60,000+"` | 交易额（页面展示） | **不能判档** | 高（否定） | 非评估卡也有交易额 |
| `adInfo` / `newAd` | object / `true` | 广告位标记 | **正交**：先标记广告，再判档 | 高 | 广告卡也属于某档位；不要因为广告判 Pro |
| `action` | `company_profile.html` URL | 店铺链接 | **不能判档** | 高（否定） | 子域名不表示档位 |
| `mainProduct` | object | 广告主推产品 | **不能判档** | 高（否定） | 本样本仅广告卡出现 |
| `promotionSupplierGMVRankTitle` | `""` | 促销/GMV 榜单标题 | **不能判档** | 高（否定） | 本样本全空 |

### 3.2 筛选参数语义

| 参数 | 值 | 语义 | 置信度 | 注意 |
|---|---|---|---|---|
| `assessmentCompany` | `true` | 金品诚企 / Verified Supplier | 高 | `snData` 显示名为“金品诚企”，实际 UI 可能是“Verified 供应商” |
| `verifiedPro` | `1` | 领袖卖家 / Verified Pro | 高 | hover 文案“逾 5 年经验的行业头部金品商家”是营销描述，不是充分条件 |
| `ta` | `y` | 信用保障 / Trade Assurance | 高 | 交易保障，不是档位 |
| `reviewScore` | `4` / `4.5` / `5` | 店铺评价分数下限 | 高 | 不是 Supplier Index |
| `companyAuthTag` | `ISO` / `BSCI` / `IATF 16949` / `SEDEX` / `HACCP` / `FSC` | 公司认证 | 高 | 认证不是档位 |
| `productAuthTag` | `CE` / `ROHS` / `GRS` / `DOT` 等 | 产品认证 | 高 | 认证不是档位 |
| `tagKvPairIntFilter` | `11` 深度定制、`10` 成品验货、`35` 供应商评估程序等 | 产能/能力 | 高 | 不是档位 |
| `country` | `CN` / `US` / `HK` 等 | 国家/地区 | 高 | — |
| `snVerifiedSupplierResult.needFilter` | `true` | 空的待用筛选组（本页无 values） | 低 | 可能是未启用的“Verified Supplier”独立筛选，待实测 |
| `snPromotion` | title “Supplier types” | 空对象 | 低 | 本页无数据 |

### 3.3 判定顺序（决策树）

```text
输入：一张 offerList 卡片 + 当前查询参数（可选）

1. 先判广告（正交）
   is_ad = card.adInfo != null or card.newAd == true
   ad_type:
     - "top_sponsor" if card.adInfo?.creativeInfo?.tpText == "Top sponsor listing"
                       or traceCommonArgs.isTopRank == "true"
     - "p4p" if traceCommonArgs.isP4P == "true"
     - "unknown_ad" otherwise
   注意：is_ad 不影响下面档位判断，只影响展示/排序。

2. 判最高档
   if card.verifiedSupplierPro == true:
       tier = "verified_pro"          # 领袖卖家 / 行业领袖
       confidence = 0.90
   else if card.isAssessedSupplier == true:
       tier = "verified_supplier"     # 金品诚企 / Verified Supplier
       confidence = 0.95
   else if parse_years(card.goldYears) > 0:
       tier = "gold_supplier"         # 出口通（至少）
       confidence = 0.80
   else:
       tier = "unknown"               # 不要默认出口通
       confidence = 0.0

3. 交叉校验（只降/升置信度，不覆盖 tier）
   if tier == "verified_supplier":
       if card.iconList 非空 and card.tag 非空 and (card.staff or card.area):
           confidence = min(0.98, confidence + 0.03)
       if card.iconList 为空:
           confidence -= 0.10          # 可能字段缺失/模板差异

   if tier == "gold_supplier":
       if card.isAssessedSupplier == false and card.memberTag 为空:
           confidence -= 0.05          # 仅提示，不代表不是出口通

4. 附加标签（不改变 tier）
   trade_assurance = "yes" if query.ta == "y" else "unknown"
   custom_manufacturer = "yes" if profile.authIdentityInfo.identityName == "Custom Manufacturer" else "unknown"
   capability_tags = card.tag                    # 产能/能力，不是认证
   certifications = query.companyAuthTag / query.productAuthTag   # 来自筛选参数，不是单卡字段
```

> **为什么 Pro 优先于 Assessed**：Verified Pro 建立在金品/Verified Supplier 体系之上，通常同时满足 `isAssessedSupplier=true`。如果只看到 `verifiedSupplierPro=true`，应输出 Pro，并标注“含金品”。

### 3.4 伪 JSON 输出

```json
{
  "companyId": "258180302",
  "companyName": "Hengshui Kangyuan Rubber And Plastic Technology Co., Ltd.",
  "tier": "verified_supplier",
  "tierLabelZh": "金品诚企",
  "tierLabelEn": "Verified Supplier",
  "confidence": 0.98,
  "isAd": true,
  "adType": "top_sponsor",
  "tradeAssurance": "unknown",
  "signals": {
    "isAssessedSupplier": true,
    "verifiedSupplierPro": false,
    "goldYears": 6,
    "iconListCount": 2,
    "tag": ["深度定制", "成品验货", "供应商评估程序", "轻定制", "支持 ODM 服务"],
    "reviewScore": 4.6,
    "reviewCount": 10,
    "memberTagCount": 18
  },
  "warnings": [
    "广告卡：iconList=2 不代表 Verified Pro",
    "verifiedSupplierPro=false 不能反推不是 Pro（可能店招未升级/未展示）"
  ]
}
```

### 3.5 本地样本验证（21 张卡）

| 统计项 | 结果 | 说明 |
|---|---:|---|
| 卡片总数 | 21 | 第 1 张是广告卡 |
| `isAssessedSupplier=true` | 9 | 金品/Verified Supplier |
| `verifiedSupplierPro=true` | 0 | 本查询没有 Pro 样本 |
| `goldYears` 非空 | 21 | 全部至少是 Gold Supplier |
| `iconList` 非空 | 9 | 与 `isAssessedSupplier` 完全一致 |
| `tag` 非空 | 9 | 与 `isAssessedSupplier` 完全一致 |
| `staff`/`area` 非空 | 9 | 与 `isAssessedSupplier` 完全一致 |
| `memberTag` 非空 | 17 | 评估/非评估都有，不能判档 |
| `reviewCount > 0` | 12 | 评估/非评估都有 |
| 广告卡 | 1 | `adInfo` + `newAd` + `Top sponsor listing` |

**反例（用来防止规则写错）**：

- **18 年 ≠ 金品/Pro**：`Hebei Shengtian Pipe-Fitting Group Co., Ltd.`，`goldYears="18 年"`，`isAssessedSupplier=false`，`verifiedSupplierPro=false`。
- **1 年也可以是金品**：`Hebei Guanshun Wire Mesh Products Co., Ltd.`、`Hebei Wirsing Import And Export Trading Co., Ltd.`，`goldYears="1 年"`，`isAssessedSupplier=true`。
- **评分 5.0 不等于金品**：`Hebei Longshi Auto Parts Co., Ltd.`，`reviewScore="5.0"`，`reviewCount=1`，`isAssessedSupplier=false`。
- **评分 0.0 不等于差/不是金品**：`Hebei Guanshun`，`reviewScore="0.0"`，`reviewCount=0`，`isAssessedSupplier=true`。
- **广告卡 2 个图标 ≠ Pro**：第 1 张 `Kangyuan`，`iconList` 长度 2，`isAssessedSupplier=true`，`verifiedSupplierPro=false`；第 2 个图标不能作为 Pro 判据。
- **公司名含 Trading 的也可以是金品**：`Hebei Wirsing Import And Export Trading Co., Ltd.`（公司名含 Trading）`isAssessedSupplier=true`；`Hebei Hengtai Pipeline Equipment Import and Export Trading Co., Ltd.` 也是 `false`。不要用 `type`/公司名判断档位。

### 3.6 误判清单

1. **广告位误判为高等级**：顶展卡会带 `Top sponsor listing`、`adInfo`、`newAd`，模板可能多一个图标/更多字段；不要用 `iconList.length >= 2` 判 Pro。应先 `isAd`，再判档。
2. **把 `goldYears` 当档位**：它只是 Gold Supplier 年限。18 年可能仍是出口通；1 年也可能是金品。
3. **把 `goldYears >= 5` 当 Verified Pro**：`verifiedPro` 的 hover 文案说“逾 5 年经验的行业头部金品商家”，但 5 年只是营销描述；Verified Pro 还要求行业领袖/品牌领航身份。必须看 `verifiedSupplierPro`。
4. **把 `type` 当商家类型**：本样本 21 张卡全部 `type="freeBlock"`，广告卡也是；它不是“工厂/贸易公司”，也不是“免费会员”。
5. **把 `memberTag` 当会员标签**：17/21 有值，评估/非评估都有；1 张金品卡为空。没有公开字典，不能用来判档。
6. **把 `reviewScore` 当 Supplier Index**：`reviewScore` 是买家评价均分（可 0.0，亦可能只有 1 条评价）；Supplier Index 是平台绩效等级（0–5），二者会背离。
7. **把 `isAssessedSupplier=false` 断言“不是金品”**：可能是评估过期、字段缺失、模板差异；只能输出“未观察到”，不能断言否定。
8. **把 `verifiedSupplierPro=false` 断言“不是 Pro”**：官方语雀说明，Verified Pro 标需要“新店招”才显示；未升级店招的行业领袖可能不显示标。false 是弱否定。
9. **按中文文案匹配**：`snData` 写“金品诚企/领袖卖家”，截图显示“Verified 供应商/Verified PRO 供应商”；文案会变，参数/布尔字段不会。
10. **把“认证制造商”当档位**：`Verified Custom Manufacturer` 是供应商身份/能力类型，不是会员层级；它可与金品/Pro 并存。
11. **把 Trade Assurance 当会员**：`ta=y` 只是“支持信用保障”的筛选；TA 本身是交易保障，且官方要求付费 Gold Supplier + 验真。
12. **忽略查询上下文**：如果当前查询就是 `assessmentCompany=true`，结果全是金品；不要在“全量结果”上重新学习“有 icon 就是金品”的规则。

---

## 4. Supplier Index 是什么

### 4.1 定义与历史

**Supplier Index = Supplier Online Performance Index（SOPI，供应商在线绩效指数）**，是平台对供应商在 alibaba.com 上经营表现的综合分层，**0–5 共 6 级，5 最高**。公司页的英文 tooltip 原文：

> “Supplier Online Performance Index (Supplier Index) is classified into 6 levels (0-5, with 5 being the highest level). Click the「View more」button to review the formula of the Supplier Index.”
> —— 公开公司页 `kangyuanxiangsu.en.alibaba.com/company_profile.html` 的 `RatingStarTip` 文案

官方 SOPI 说明（2020 年上线）：

- 前身是 **Transaction Level（交易等级）**；
- 四个维度：**Presentation Quality（信息展示）、Product Popularity（产品热度）、Transaction Volume（交易额）、Service Quality（服务质量）**；
- **取四项最低分**作为 SOPI（“木桶原则”）；
- 0–5 级；0 级灰色钻石，其余橙色钻石；
- 当时仅适用于大中华区供应商；每月更新。

后续平台又把 SOPI 与“商家星等级 / Star Rating”融合（**推断**，公开资料名称混用）：0–5 星、每月 5 日更新、四个能力项（产品力/营销力/交易力/服务力），并影响搜索排序与活动权益。公开资料对“Supplier Index / SOPI / Star Rating / Transaction Level”的名称使用并不完全统一，但**它们描述的是同一类平台绩效分层**，不是买家评价。

### 4.2 与 reviewScore / reviewCount 的区别

| 指标 | 含义 | 取值/示例 | 数据来源 | 在页面上的样子 | 用途 |
|---|---|---|---|---|---|
| **Supplier Index** | 平台综合绩效等级（SOPI） | 0–5 级（常见 1–5 颗心/星/钻石） | 平台按展示、热度、交易、服务计算 | 详情弹卡/公司页的 “Supplier Index” + 图标 | 供应商分层、搜索排序、买家筛选参考 |
| **reviewScore** | 买家对店铺的评价均分 | `4.6`（满分 5） | 买家 reviews | “4.6/5 (10 评价)” | 口碑/信任 |
| **reviewCount** | 评价条数 | `10` | 买家 reviews | 括号里的评价数 | 评价样本量 |
| **Star Rating** | 卖家侧星等级 | 0–5 星 | 平台月度计算 | 卖家后台/搜索排序 | 卖家权益、搜索加权 |
| **Transaction Level** | 旧交易等级 | 0–5（旧 UI 用心/钻石） | 交易额为主 | 旧版页面 | 已被 SOPI 取代 |

**关键区别**：

- `reviewScore` 可以是 `0.0`（没有评价），但这**不代表** Supplier Index 低；反过来，一个 5.0/1 条评价的供应商，Supplier Index 也可能不高。
- Supplier Index 是**平台算的**，reviewScore 是**买家打的**；两者不要互相替代。
- 本地搜索页 `offerList` 里只有 `reviewScore` / `reviewCount`，**没有** `supplierIndex` 字段；所以客户端不能从搜索 JSON 直接拿 Supplier Index。

### 4.3 展示与数据来源

- 官方 2020 文档说 0 级灰色钻石、其余橙色钻石；公司页当前使用 `ratingStarIconUrl`（星形图标）；用户观察到详情弹卡用 **1–5 颗心**。这说明**图标是表面渲染，底层都是 0–5 级**；具体图标/文案随页面版本变化。
- 公司页 SSR 里有 `RatingStarTip`（tooltip 文案），但**没有** `supplierIndex` 数值字段；数值很可能由客户端异步接口加载。公司页还能看到 `supplierPerformance` 模块、`reviews.starLevel`（这是评价星级的取整，不是 Supplier Index）。
- 需要区分以下“看起来像”的字段：
  - `supplierActionBar.rating` = 4.6（reviewScore）
  - `supplierActionBar.reviewCount` = 10
  - `supplierPerformance.reviews.starLevel` = 5（评价星级显示，不是 SOPI 等级）
  - `RatingStarTip` = Supplier Index 的说明文案（不是数值）

**结论**：Supplier Index 的**定义**可以确认（SOPI，0–5）；它的**当前字段名/接口/图标**尚未在本地搜索 JSON 中确认，标记为**待实测**。

### 4.4 客户端处理建议

1. 搜索列表页：只展示 `reviewScore` / `reviewCount`，不要把它们标成 “Supplier Index”。
2. 详情页/弹卡：单独请求公司详情接口，优先找 `supplierIndex` / `sopiLevel` / `starLevel` / `ratingStar` 这类字段；找不到就显示“—”，不要回退到 `reviewScore`。
3. UI 文案：中文用“供应商指数（Supplier Index）”，英文用“Supplier Index”；悬浮说明写“平台综合绩效，0–5 级，不是买家评分”。
4. 若产品上必须展示 1–5 颗心：确认接口返回的等级后再渲染；不要用 `Math.round(reviewScore)` 冒充。

---

## 5. 待实测清单

> 优先级 P0 = 会直接影响档位判断/上线；P1 = 影响展示与解释；P2 = 长期完善。

| 优先级 | 待测项 | 具体字段/接口 | 验证方法 | 影响 |
|---|---|---|---|---|
| P0 | 英文站徽章真实文案 | `Verified Supplier` / `Verified Pro` / `Assessed Supplier` / `Verified Custom Manufacturer` / `Top sponsor listing` | 用 EN locale 打开搜索页/公司页/商品页，抓 `alt`、`title`、`aria-label`、DOM 文本 | 决定 UI 文案映射 |
| P0 | `verifiedSupplierPro` 正样本 | 搜索卡 `verifiedSupplierPro`；筛选 `verifiedPro=1` | 用已知行业领袖账号/`verifiedPro=1` 查询（注意验证码），对比卡字段与公司页徽章 | 确认 true 的判定与 false 的误判率 |
| P0 | Supplier Index 数值接口 | `supplierIndex` / `sopiLevel` / `starLevel` / `ratingStar`；公司页异步模块 | 打开公司页 Network，抓 `supplierPerformance`/`ratingStar` 相关响应；对比 3–5 家不同等级供应商 | 决定能否展示 Supplier Index |
| P0 | `isAssessedSupplier` 与会员有效期 | `isAssessedSupplier`；公司页 `verifiedBadgeUrl` / `verifyTitle` | 找评估过期/刚续费的账号，观察 false/true 与徽章是否一致 | 避免把“评估过期”误判为“非金品” |
| P0 | Gold Supplier Basic vs Plus | 搜索/详情是否有 `memberLevel`、`planType`、`memberTag` 位 | 找已知 Basic/Plus 账号，对比所有字段与页面套餐标识 | 判断能否区分出口通子档 |
| P1 | `memberTag` 字典 | `memberTag` 数字 ID | 收集多类目、多档位样本；找标签字典接口/JS 映射；做相关性分析 | 可能解锁更细标签，但目前不能判档 |
| P1 | Trade Assurance 单卡字段 | `hasTradeAssurance` / `tradeAssurance` / `ta` | 搜索页是否每卡有 TA 标识；详情接口是否有布尔字段 | 目前只能靠查询参数 `ta=y`，不能逐卡判断 |
| P1 | `type` 的真实语义 | `type`（freeBlock/newad/ad…） | 抓广告位、自然位、不同 tab 的卡片；统计取值 | 本样本全是 freeBlock，疑似模板类型 |
| P1 | `iconList` 徽章字典 | `iconList` URL/alt | 收集所有徽章图，建立 URL→名称映射；观察是否随账号/活动变化 | 可作为 `isAssessedSupplier` 的兜底 |
| P1 | `snVerifiedSupplierResult` 空筛选 | `needFilter=true`、无 values | 换关键词/国家/语言，观察是否出现 “Verified Supplier” 独立筛选 | 可能是新增筛选，影响参数映射 |
| P1 | `snPromotion` 空对象 | `Supplier types` | 换类目/广告位，观察是否出现促销供应商类型 | 目前无数据 |
| P1 | reviewScore 的口径 | 店铺评价 vs 商品评价 | 公司页 “Ratings & Reviews” 两个 tab；对比搜索卡数字 | 避免把商品评价当店铺评价 |
| P1 | Verified Custom Manufacturer 在搜索卡 | `authIdentityInfo` / `businessType` / `verifiedAs` | 找已知 Custom Manufacturer，检查搜索卡是否有字段；没有则只能详情页取 | 决定列表页能否展示“认证制造商” |
| P1 | P4P vs 顶展 | `adInfo.traceCommonArgs.isP4P` / `isTopRank` / `tpText` | 抓 P4P 广告位与顶展位，比较字段 | 区分广告类型，避免把顶展当 P4P |
| P2 | Supplier Index 图标 | 心形/星形/钻石；`ratingStarIconUrl` | 多端（PC/APP/弹卡）截图对比；看 SVG class | 统一 UI |
| P2 | 各区域套餐差异 | Gold Supplier Plus、区域定价 | 对比 CN/US/EU/SEA 的 pricing 页与合同 | 国际化展示 |
| P2 | “Assessed Supplier” vs “Verified Supplier” 术语 | 买家帮助页 vs 卖家页 | 对照官方中英文页面，确定对外文案 | 避免解释冲突 |
| P2 | 新店招与 Verified Pro 显示条件 | 公司页店招版本 | 找未升级店招的行业领袖账号，确认徽章是否缺失 | 解释 false negative |

---

## 6. 结论

- **体系**：出口通（Gold Supplier Basic）是底座；金品诚企（Verified Supplier）在底座上增加第三方实地评估（Assessed/深度认证）和 Verified 徽章；行业领袖（Verified Pro/领袖卖家）是金品之上的顶层/邀约会员，Verified Pro 是身份标而非独立套餐。
- **识别**：搜索页最可靠的三个信号是 `verifiedSupplierPro`（Pro）、`isAssessedSupplier`（金品）、`goldYears`（至少出口通）。`memberTag`、`type`、`reviewScore`、`reviewCount`、`iconList` 数量都不能单独判档；广告位要单独标记，不能当会员等级。
- **Supplier Index**：是 SOPI 平台绩效指数（0–5），不是 `reviewScore`；搜索 JSON 没有该字段，需从详情/公司页接口取，字段名和图标待实测。
- **建议**：客户端先按“Pro > 金品 > 出口通 > 未知”输出档位，并附 `confidence` 与 `warnings`；把“认证制造商/TA/广告”作为正交标签，不要混进档位枚举。这样即使页面文案/图标变化，判断也不会崩。

---

## 附录：本地证据与公开来源对照

### A. 本地证据

- `search.page_data.json`：
  - `snData.supplierType.supplierTypeData`：`ta`（信用保障）、`assessmentCompany`（金品诚企）、`verifiedPro`（领袖卖家）。
  - `snData.snCompanyAuthTagResult` / `snProductAuthTagResult` / `snManufactoryResult`：ISO/BSCI/CE/产能等，均非会员档位。
  - `offerResultData.offerList`：21 张卡；字段与统计见 §3.5。
- `search.html`：
  - 第 1 张卡 `Top sponsor listing`、`adInfo`、`newAd`；
  - 标准卡 `<span data-role="tags-before-title"></span>` 为空；评估卡在 `infos` 行显示徽章图标（`H58367af...`）。
- `search.png`：
  - 筛选器实际文案：`Trade Assurance`、`Verified 供应商`、`Verified PRO 供应商`；
  - 与 `snData` 的中文名“信用保障/金品诚企/领袖卖家”不同，说明文案会本地化/品牌化。

### B. 公开来源（按类型）

**官方/平台自有**

1. [Tiered Membership Plans for Business Growth](https://seller.alibaba.com/pricing?tracelog=angle) — 三档套餐与权益表。
2. [Make Trust Happen — Verified Supplier](https://seller.alibaba.com/verified_supplier) — Verified Supplier 定义、Gold Supplier 对比、4/5 星直达。
3. [金品诚企服务](https://fuwu.alibaba.com/jpcq/home.htm) — 第三方验厂、报告、视频、8 组橱窗、TA 额度 +4,000–6,000 美金。
4. [Alibaba.com 再升级金品诚企认证](https://www.alibabanews.com/alibabacom%E5%86%8D%E5%8D%87%E7%B4%9A%E9%87%91%E5%93%81%E8%AA%A0%E4%BC%81%E8%AA%8D%E8%AD%89/) — “Verified Supplier 金品诚企”。
5. [阿里巴巴国际站金品诚企怎么认证](https://supplier.alibaba.com/trade/domestic/PX002DN8C.htm) — 金品=深度认证服务。
6. [出口通和金品诚企有什么区别](https://supplier.alibaba.com/trade/domestic/PX002DPRY.htm) — 出口通基础、金品含验厂/橱窗/RFQ/数据管家。
7. [Supplier Online Performance Index](https://activity.alibaba.com/helpcenter/SOPI.html) — SOPI 0–5、四维度、取最低分。
8. [What is Trade Assurance](https://activity.alibaba.com/ggs/tradeassurance.html) — 付费 Gold Supplier + 验真；买家免费；卖家 3%。
9. [什么是顶级展位](https://activity.alibaba.com/ad_digital_marketing/8a779a3d.html) — 首位/皇冠/一关键词一名。
10. [Supplier Verification](https://www.alibaba.com/featured/supplier-verification.html) — 买家侧 Verified/Gold/Assessed 说明（术语有冲突）。
11. [The Ultimate Guide to Alibaba Verified Suppliers](https://reads.alibaba.com/ultimate-guide-alibaba-verified-suppliers/) — Verified Supplier 三种类型。
12. [商品页徽章示例](https://www.alibaba.com/product-detail/China-manufacturer-ABS-3-star-ping_1600456086677.html) — Verified as Custom Manufacturer / top-rated / Verified Pro。
13. [公开公司页](https://kangyuanxiangsu.en.alibaba.com/company_profile.html) — `Supplier Index` tooltip、`Verified Supplier` alt、`Custom Manufacturer` 身份。

**第三方/行业**

14. [2025 年三档费用与定位](https://reportify.cn/news/1158048082148069376) — 3.58 万 / 9 万 / 最高层。
15. [2024 年权益对比表](https://www.sohu.com/a/781009578_121192132) — 橱窗、子账号、数据参谋、星级直达。
16. [Verified Pro 身份标规则](https://www.yuque.com/chaike/yingxiao/ouapmu7xpe7ql2fp) — 2023 年 3 月、行业领袖/品牌领航、新店招。
17. [SOPI/Star Rating 四维与每月更新](https://www.techtongbo.com/post/how-valuable-is-alibaba-s-merchant-star-rating-for-global-buyers)
18. [Alibaba Orange Heart 旧交易等级](https://www.junglescout.com/blog/what-is-alibaba/)
19. [顶级展位中文说明](https://global.lianlianpay.com/article/MTE0MzMwLDQ1NQ.html)
20. [Apify 抓取器字段（SOPI 1–5、review_score 分离）](https://apify.com/devcake/alibaba-supplier-scraper/output-schema)

---

*报告版本：2026-11-15；所有价格/权益为公开资料量级，最终以 Alibaba.com 客户经理报价与合同为准。*
