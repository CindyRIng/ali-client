# alibaba.com 探路实测报告（2026-11-15）

> 项目：`ali-client`（阿里国际站本地只读客户端）
> 目的：在写接口/实现之前，用真实浏览器把 alibaba.com 的**请求链路、干净数据结构、会员套餐识别方式**摸清楚。
> 环境：`~/cloak-env`（cloakbrowser 0.6.5 + Chromium 146，keyless）｜独立 profile `~/.ali-recon-profile`｜headful 常驻浏览器｜账号：Cindy ring（买家账号，人工登录一次，会话级 cookie 保持）
> 证据：`exploration/2026-11-15/artifacts/`（HTML / `window._PAGE_DATA_` JSON / XHR / 截图 / 接口样本）
> 关联文档：[需求访谈记录](../../docs/00-需求访谈记录.md)｜[会员套餐与识别规则](./membership-plans.md)｜[接口草案](../../docs/02-接口草案.md)

---

## 0. 一页结论

1. **搜索页是 SSR**：供应商列表没有独立 JSON XHR，数据在页面 HTML 内嵌的 `window._PAGE_DATA_` 里；核心是 `offerResultData.offerList[]`（20 条/页 + 广告卡）与 `snData`（筛选器字典）。**只要拿到这个 JSON，就不需要解析 DOM**。
2. **详情是组件接口**：公司页 `POST https://<供应商子域>.en.alibaba.com/event/app/alisite/render.htm`（form：`componentKeys=shopSign,companyCard`）返回两个组件的 JSON，**一次请求拿全**「入驻年限 / Supplier Index 星级 / 主营产品 / 省市地址 / 会员与认证标识 / 基础经营指标」。
3. **英文站关键字段与你的截图完全对得上**：`companyJoinYears=6`（6 yrs）、`supplierStars=2`（截图里的 Supplier Index ♥♥）、`supplierMainProducts`（主要产品）、`companyRegisterProvince=Hebei` + `supplierOperationalAddress=...Hengshui, Hebei, China`（省/市）、`companyHasPassAssessment=true`（Verified Supplier/金品诚企）、`authCards`（截图 3 的「Verified supplier」悬浮卡全部指标）。
4. **官方没有省/市级筛选**：搜索页只有「Supplier by Country/Region」（`country=CN`）；`snData.supplierLocation` 里虽有一个 `Province` 分组，但 **values 恒为空**（中英文、登录/匿名、Products/Suppliers 两个 tab 都一样）。省市维度必须由客户端补：**详情回填 + 精确过滤**（推荐）或**地点关键词**（模糊）；另有 `/factory/index.html` 的认证工厂目录 API 可拿 `factoryProvince`（仅省、无市、总量上限 500）。
5. **会员/认证体系已可结构化判定**：搜索卡有 `isAssessedSupplier`（金品/Verified Supplier）、`verifiedSupplierPro`（Verified Pro/领袖卖家）、`goldYears`（Gold Supplier 年限）；详情有 `accountIsPaidMember`、`isGold`、`companyHasPassAssessment`、`companyHasPassOnsite`、`companyHasPassAV`、`assessmentCertCompany`（SGS）、`identityKey=strengthFactory`（Custom Manufacturer）等。规则见 [membership-plans.md](./membership-plans.md) 与 §7。
6. **风控**：滑块验证 `nc_1`（300×34 track，`#nc_1_n1z` 手柄），headless 连发 2–3 个页面就触发；headful + 14s 级间隔较稳；**已实现类人拖拽自动过滑块，在本机 www.alibaba.com 上成功一次**（子域上遇到过失败/风控错误，需要重试或人工兜底）。登录态依赖会话级 cookie（浏览器进程关闭即掉线）→ **客户端必须常驻 owner 浏览器进程**（与本机 `zhilian-client`/`boss-client` 架构一致）。
7. **推荐 v1 范围**：匿名可用（搜索/详情都能拿到），登录可选（会话保活）；操作 = `search.suppliers` / `suppliers.list` / `suppliers.detail` / `regions.*` / `factories.list`(可选) / `status` / `cache.*`；省市搜索用「关键词 + 详情回填过滤」，默认严格模式、可切快速模式（见 §6/接口草案）。
8. **第二轮深挖结论（见 §11）**：`fetch-first` 采集可行且几乎不触发验证——在同一 worker 页内 `fetch()` 搜索 URL 直接拿 SSR HTML→`_PAGE_DATA_`；详情 `render.htm` **CORS 允许从 www 页跨子域调用**（30/30 成功）；实测 150+ 次 fetch 无滑块。**匿名即可拿到 v1 全部字段**（搜索/详情/工厂目录），登录只影响买家侧功能。滑块只在**页面导航**时触发（约 8~9 次连续导航/30s），`x5sec` 有效期 **≈30 分钟**，自动拖拽 3/3 最终成功（首次成功率 2/3），失败后 reload 重试可恢复。

---

## 1. 环境与方法

| 项 | 内容 |
|---|---|
| 运行环境 | `~/cloak-env/bin/cloak-run node ...`（FHS 内 Chromium 146 + cloakbrowser 0.6.5） |
| profile | `~/.ali-recon-profile`（11/10 历史 profile，含阿里 cookie；本次登录后保持进程不关） |
| 浏览器 | **headful**（XWayland `DISPLAY=:0`），viewport 1920×1080，timezone Asia/Shanghai |
| 语言 | 初始 zh-CN；通过右上角「语言/货币」React 选择器切到 **English-USD**（cookie 持久化） |
| 驱动方式 | 常驻 daemon（`exploration/2026-11-15/scripts/daemon.mjs`）+ 文件队列（`/tmp/ali-cmd.json` ↔ `/tmp/ali-res.json`），单浏览器会话内完成全部抓取 |
| 采集 | `page.content()` + `window._PAGE_DATA_` 原样落盘 + XHR/fetch JSON body + 请求 postData + 截图 |
| 风险控制 | 自动滑块：Playwright CDP 可信鼠标、加速度/抖动/回拉；见 §8 |

> 说明：headful 是本次探索的关键决策。headless 下非常容易触发滑块；headful 下页面加载正常，且人工/自动过验证后可继续。

---

## 2. 请求链路总览（已实测）

| # | 用途 | 方法 | URL | 关键参数/body | 响应 |
|---|---|---|---|---|---|
| 1 | 供应商搜索（页面） | GET | `https://www.alibaba.com/trade/search` | `fsb=y&IndexArea=product_en&has4Tab=true&keywords=<kw>&originKeywords=<kw>&tab=supplier&page=<n>`；可选 `country=CN`、`assessmentCompany=true`、`verifiedPro=1`、`ta=y`、`reviewScore=4.5`、`companyAuthTag=ISO`、`productAuthTag=CE`、`tagKvPairIntFilter=11` | HTML（含 `window._PAGE_DATA_`），无独立列表 XHR |
| 2 | 公司详情组件 | **POST** | `https://<subdomain>.en.alibaba.com/event/app/alisite/render.htm` | form-urlencoded：`esiteSubDomain=https://<subdomain>.en.alibaba.com&renderType=component&clientType=PC&componentKeys=shopSign,companyCard` | JSON：`{data:{shopSign:{data:"<json字符串>"}, companyCard:{data:"<json字符串>"}}}` |
| 3 | 认证工厂目录 | GET | `https://insights.alibaba.com/openservice/gatewayService` | `modelId=10300&endpoint=pc&categoryIds=0&pageNo=<n>&pageSize=100`（pageSize 实测可到 100/500） | 工厂列表 JSON：`data.list[]`（含 `factoryProvince`） |
| 4 | 工厂目录筛选字典 | GET | 同上 | `modelId=10161` | `data.countryFilter[]`（国家）+ `data.tabs[]`（43 个类目对应的能力词条） |
| 5 | 类目树 | GET | 同上 | `modelId=10295&cateType=1&endpoint=pc` | 类目树（可作 `--category` 字典） |
| 6 | 登录 | GET | `https://login.alibaba.com/newlogin/icbuLogin.htm?return_url=...` | 账号密码 / 手机号登录 / 第三方（Google/Facebook/LinkedIn/淘宝等） | 登录后 Cookie：`xman_f`、`xman_us_f`（长期）+ 会话级 token；**关闭浏览器后登录态丢失（会话 cookie）** |
| 7 | 语言/货币 | UI | 首页右上角「简体中文-CNY」→ React Select → 保存 | 写入偏好 cookie，页面 reload | 英文站字段随之变化（如 `goldYears`「6 yrs」↔「6 年」） |

> 搜索页里的其它 XHR（`myconnections/header`、`insights/gatewayService` 埋点、`onetalk` 客服、`mtop` IM 等）都是页面辅助请求，**不含供应商列表数据**，客户端可以忽略。

---

## 3. 搜索页数据链路（Supplier Search）

### 3.1 URL 与参数

```text
https://www.alibaba.com/trade/search
  ?fsb=y
  &IndexArea=product_en
  &has4Tab=true
  &keywords=hebei                # 搜索词（省/市名、产品词都可）
  &originKeywords=hebei          # 原始词（保留翻译前的词）
  &tab=supplier                  # 供应商（Manufacturers）tab
  &page=1                        # 页码，20 条/页
  [&country=CN]                  # 供应商国家/地区（官方唯一地区维度）
  [&assessmentCompany=true]      # Verified Supplier（金品诚企）
  [&verifiedPro=1]               # Verified Pro Supplier（领袖卖家）
  [&ta=y]                        # Trade Assurance
  [&reviewScore=4.5]             # 店铺评分 ≥4.5
  [&companyAuthTag=ISO]          # 公司认证
  [&productAuthTag=CE]           # 产品认证
  [&tagKvPairIntFilter=11]       # 能力标签（见 3.5）
```

- 同一 URL 在中文/英文语言环境下返回同构数据，但**文案与部分值会本地化**（`goldYears`：`"6 年"` / `"6 yrs"`；`tag`：`深度定制` / `Full customization`）。客户端输出前必须统一（建议按英文环境抓取，再归一化数值型字段）。
- `tab=supplier` 时 `pageType="supplier"`；`tab=product` 是产品搜索（另一套 `offers`，不在 v1 范围）。

### 3.2 `window._PAGE_DATA_` 顶层结构（搜索页）

| key | 内容 | 是否要 |
|---|---|---|
| `offerResultData` | **供应商卡片列表**：`offerList[]`、`totalCount`、`pageSize`、`pageIndex`、`adCount`、`p4pCount`、`servicePerformanceTime` | ✅ 核心 |
| `snData` | 筛选器字典：`supplierLocation`、`supplierType`、`reviewFilterResult`、`snManufactoryResult`、`snCompanyAuthTagResult`、`snProductAuthTagResult`、`selectedResult` | ✅ 过滤/枚举 |
| `pageNavigationData` | `urlRule`（分页模板）、`pageCount`（SSR 时为 0，以 `totalCount` 为准） | ✅ 分页 |
| `requestData` | 本次请求参数回显（`params`/`tab`/`servletPath`） | 调试 |
| `topBrandData` / `topBannerData` / `sceneData` / `keyword` / `r18InfoData` / `bts` / `i18nSSR` | 首页/场景/合规 | ❌ |
| `headerI18nInfoData` / `logisticsData` / `forbidData` | 头部/物流/合规 | ❌ |

> 注意：搜索页没有 `pageDataBytes` 之外的独立接口；抓法 = 导航到页面 → `page.evaluate(() => window._PAGE_DATA_)`。HTML 本身 100 万字符级，**不要**把 HTML 落缓存。

### 3.3 供应商卡片 `offerList[]` 字段（实测，英文环境）

| 字段 | 示例 | 说明 |
|---|---|---|
| `companyId` | `"258180302"` | 公司 ID（去重键） |
| `companyName` | `Hengshui Kangyuan Rubber And Plastic Technology Co., Ltd.` | 公司名 |
| `action` | `//kangyuanxiangsu.en.alibaba.com/company_profile.html` | 店铺/公司页 URL（→ 详情用） |
| `goldYears` | `"6 yrs"`（中=`"6 年"`） | Gold Supplier 年限 = **上平台时间**（解析成 int） |
| `isAssessedSupplier` | `true` | **Verified Supplier（金品诚企）** |
| `verifiedSupplierPro` | `false` | **Verified Pro Supplier（领袖卖家）** |
| `provideProducts` | `Solid Tires, Forklift Tires, PU Wheels, Rubber Wheels, Nylon Wheels` | 主营产品（英文逗号分隔） |
| `reviewScore` | `"4.6"` | 店铺评分（0–5） |
| `reviewCount` | `10` | 评价数 |
| `staff` | `"30+ staff"` | 员工规模文案 |
| `area` | `"5,000+ m²"` | 厂房面积文案 |
| `transactions` | `"US $60,000+"` | 近 6 个月线上交易额文案 |
| `replyAvgTime` | `"≤2h"` | 平均响应时长 |
| `tag` | `["Full customization","Finished product inspection","Supplier assessment procedures","Minor customization","ODM service available"]` | 能力/服务标签 |
| `memberTag` | `"8000002221692,8000002228508,..."` | 会员/营销标签内部 ID（**不能**用于判套餐） |
| `iconList` | `["https://sc01.alicdn.com/kf/H58367...png", ...]` | 徽章图片（**不能**用于判 Pro） |
| `type` | `"freeBlock"` | 卡位类型（不能判会员） |
| `newAd` / `adInfo` | `true` / `{campaignId,...}` | 广告卡（顶展/P4P） |
| `mainProduct` | `{id,title,price,imageUrl,...}` | 主推产品（卡片展示用） |
| `companyIcon` / `companyImage` | 图片 URL | Logo / 工厂图 |
| `hasLive` / `chatToken` / `contactSupplier` / `clickEurl` / `trackInfo` / `tmlid` | — | 聊天/埋点，v1 不用 |

页级：`totalCount`（如 `757`；"hebei" 英文登录态）、`pageSize=20`、`pageIndex=1`、`offerList` 长度 21（20 条结果 + 1 条广告插入）。

### 3.4 分页

- `page` 参数从 1 开始，每页 20 条；`totalCount=757` ⇒ 理论最多 38 页。
- `pageNavigationData.urlRule = "trade/search?fsb=y&IndexArea=product_en&has4Tab=true&keywords=hebei&originKeywords=hebei&tab=supplier&&page={0}"`。
- 实测历史 profile 翻到过第 12 页（旧会话），说明深页可用；v1 默认上限 5 页（可配），避免风控。
- 同一关键词多次翻页时，广告卡可能重复/插位，客户端按 `companyId` 去重。

### 3.5 筛选器字典（`snData`，实测英文环境）

| 维度 | URL 参数 | 可选值 |
|---|---|---|
| 国家/地区 | `country` | `CN`、`HK`、`US`、`PK`、`TW`、`IN`、`VN`、`TR`、`KR`、`MY`、`ID`、`SA`、`IT`…（`modelId=10161` 可拿全量） |
| 供应商类型 | `ta=y` | Trade Assurance |
|  | `assessmentCompany=true` | **Verified Supplier（金品诚企）** |
|  | `verifiedPro=1` | **Verified Pro Supplier（领袖卖家）** |
| 店铺评分 | `reviewScore` | `4`（≥4.0）、`4.5`、`5` |
| 能力标签 | `tagKvPairIntFilter` | `5`=Suppliers Fortune 500 companies、`6`=Design-based customization、`7`=Sample-based customization、`8`=Environmentally compliant、`10`=Finished product inspection、`11`=Full customization、`12`=Quality management certified、`13`=R&D capabilities、`34`=Socially responsible、`35`=Supplier assessment procedures |
| 公司认证 | `companyAuthTag` | `ISO`、`BSCI`、`IATF 16949`、`SEDEX`、`HACCP`、`FSC` |
| 产品认证 | `productAuthTag` | `CE`、`ROHS`、`EN 10223`、`GRS`、`2006/42/EC`、`API`、`OCS`、`AMECA`、`RWS`、`GPSR`、`DOT`、`E/E-MARK`、`CPR` |
| 地区（省） | — | ❌ **无**：`snData.supplierLocation.supplierLocationData` 的 `Province` 分组 `values=[]`（中/英、登录/匿名、product/supplier 两 tab 均实测为空） |

### 3.6 登录/匿名差异（实测）

| 项 | 匿名 | 登录后 |
|---|---|---|
| 搜索/分页/详情 | ✅ 可用 | ✅ 可用 |
| 卡片数据 | 同构（无「所在地」标签） | 同构（实测字段集一致；A/B 模板可能不同） |
| 「Hebei, CN」这类卡片地区标签 | 本机未出现 | 本机未出现（截图中出现，推测是另一 A/B 模板/旧版本，**不作为数据依赖**） |
| 风控/滑块 | 容易触发 | 仍会触发（频率相关） |
| 登录态持久性 | — | 依赖会话级 cookie，**浏览器进程重启即掉**（见 §8） |

> 结论：**v1 可以匿名为主，登录用于「可选保活」**；省市信息以详情回填为准，不依赖列表卡片。

---

## 4. 公司详情数据链路

### 4.1 两个入口

1. 页面入口：`https://<subdomain>.en.alibaba.com/company_profile.html`（HTML 里每个模块有 `module-data="<URL 编码的 JSON>"`，可由 `shopSign` 等模块直接解析，但 HTML 大、且子域风控更敏感）。
2. **接口入口（推荐）**：
   ```http
   POST https://<subdomain>.en.alibaba.com/event/app/alisite/render.htm
   Content-Type: application/x-www-form-urlencoded

   esiteSubDomain=https%3A%2F%2F<subdomain>.en.alibaba.com
   &renderType=component
   &clientType=PC
   &componentKeys=shopSign,companyCard
   ```
   响应：
   ```json
   {"data":{
      "shopSign":{"componentId":"...","componentKey":"shopSign","data":"{\"data\":{...},\"definition\":{...}}"},
      "companyCard":{"componentId":"79","componentKey":"companyCard","data":"{\"data\":{...}}"}
   },"success":true}
   ```
   `componentKeys` 可多选（实测 `shopSign,companyCard` 一次返回两个组件）；返回里的 `data` 是**字符串**，需再 `JSON.parse` 一层。

### 4.2 `shopSign` 关键字段（实测 Kangyuan）

| 字段 | 示例值 | 用途 |
|---|---|---|
| `companyJoinYears` | `"6"` | **上平台时间（年）** ✅ |
| `accountJoinYears` | `{"value":"6"}` | 同上（账号维度） |
| `supplierStars` | `2` | **Supplier Index 星级（0–5，截图里的 ♥♥）** ✅ |
| `maxStar` | `{"value":5}` | 星级上限 |
| `averageStar` | `{"value":"4.6"}` | 店铺评分（≠ Supplier Index） |
| `supplierMainProducts` | `["实心轮胎","叉车轮胎","PU轮","橡胶轮","尼龙轮"]` | **主营产品（本地化列表）** ✅（英文环境为英文） |
| `companyRegisterProvince` | `{"value":"Hebei"}` | **省** ✅ |
| `companyLocation` | `{"value":"Hebei, China"}` | 展示用地区 |
| `supplierOperationalAddress` | `{"value":"Zhang Qi Village, Jianghe Town, Hengshui, Hebei, China"}` | **完整经营地址（可解析城市）** ✅ |
| `companyBusinessType` | `{"authenticated":true,"value":"Manufacturer, Trading Company"}` | 业务类型 |
| `accountIsPaidMember` | `true` | 付费会员 |
| `isNewGolden` | `false` | 新金品标 |
| `companyHasPassAssessment` | `true` | **金品诚企/Verified Supplier（第三方评估通过）** |
| `companyHasPassOnsite` | `true` | 实地验厂（onsite）通过 |
| `companyHasPassBaseVerify` | `false` | 基础验真 |
| `companyHasPassAV` | `false` | AV 认证（待确认含义） |
| `deepCertLogos` | `null` | 深度认证 logo |
| `assessmentCertCompany` | `{name:"sgs", title:"SGS Group", ...}` | 第三方认证机构（SGS） |
| `companyAbilityTags` | `{resultMapList:[{tagNameValue:"ODM services available", tagIdentity:"odm_services_available", ...}]}` | 金品认证报告能力标签（ODM/外籍工程师/员工数…） |
| `factoryRank` | `{value:{rankInfo:"物料搬运设备部件 热销第 2", ...}}` | 类目热销排名 |
| `isVip` / `accountIsVm` | `false` | VIP 标记（非会员档位） |
| `companyRegisterCountry` | `"CN"` | 国家 |

### 4.3 `companyCard` 关键字段（实测）

| 字段 | 示例 | 用途 |
|---|---|---|
| `companyJoinYears` | `"6"` | 上平台时间 ✅ |
| `supplierStars` | `2` | Supplier Index 星级 ✅ |
| `supplierRating` | `6` | 待确认（综合能力分？**不当作星级**） |
| `supplierRatingReviews` | `{averageStar:"4.6", totalReviewOrderCount:10, latitudeScoreDTOList:[...]}` | 店铺评分/评价数/分项评分 |
| `companyMainMarket` | `{descMarkets:[{name:"North America", percentFormat:"50.00%", products:"Solid Tires, Forklift Tires, ..."}]}` | **主营产品（英文）+ 主要市场** ✅ |
| `companyBusinessType` | `Manufacturer, Trading Company` | 业务类型 |
| `authCards` | `{value:{authGroupInfoList:[...], identityInfo:{...}}}` | **「Verified supplier」悬浮卡的全部指标**（见 4.4） |
| `companyHasPassAssessment` / `companyHasPassOnsite` / `companyHasPassBaseVerify` / `companyHasPassAV` | `true/true/false/false` | 会员与认证标识 |
| `accountIsPaidMember` / `isGold` | `true/true` | 付费会员/Gold Supplier |
| `supplierResponseRate` | `"98.5%"` | 回复率 |
| `sesameReplyAvgTimeRange` | `"≤2h"` | 平均回复时长 |
| `baoAccountAmount` | `"96,000"` | Trade Assurance 保障额度 |
| `baoAccountCreditLevel` | `4` | 信用等级 |
| `companyRegisterCountry` | `"CN"` | 国家 |
| `companyName` / `companyId` / `aliMemberEncryptId` / `esiteUrls` | — | 基础标识/跳转链接 |

### 4.4 截图 3「Verified supplier」悬浮卡 → 字段对照（全部命中）

| 悬浮卡展示 | 来源字段 | 值（Kangyuan） |
|---|---|---|
| 公司名 | `shopSign.data.companyName` | Hengshui Kangyuan Rubber And Plastic Technology Co., Ltd. |
| Custom Manufacturer | `authCards.value.identityInfo.identityKey/Name` | `strengthFactory` / 实力工厂（英文 Custom Manufacturer） |
| CN | `companyRegisterCountry` | CN |
| 6 yrs | `companyJoinYears` | 6 |
| **Supplier Index ♥♥** | `supplierStars` | 2（maxStar 5） |
| Store rating 4.6/5 | `authCards` → `basicCapacity.storeScore` | 4.6/5 |
| On-time dispatch rate 100.0% | `basicCapacity.onTimeDeliveryRate` | 100.0% |
| Response time ≤2h | `basicCapacity.responseTime` | ≤2h |
| Total annual revenue $2231223 | `basicCapacity.totalExportRevenuePreYear` | $2231223 |
| Floor space 5000m² | `basicCapacity.companyBuildingTotalLandSize` | 5000m² |
| Production lines 10 | `basicCapacity.productionCapacityProductionLineNumber` | 10 |
| Services: Drawing-based / Full customization | `productionServiceCapacity.*` | 来图定制 / 按需定制 |
| Quality control: Raw material identification / Finished product inspection | `qualityAssuranceCapability.*` | 有原材料追溯标识 / 经过成品检验 |
| Supplier assessments（链接） | `authCards.value.identityInfo` + `companyHasPassOnsite` | 有 |
| Main business（页面头部） | `supplierMainProducts` / `companyMainMarket` | Pneumatic tires for forklifts… / Solid Tires… |

> 也就是说：**user 截图里的「详情弹卡」= companyCard.authCards + shopSign 头部字段**，v1 一次 render.htm 请求即可完整还原。

### 4.5 省市解析

- 省：`shopSign.companyRegisterProvince.value`（如 `Hebei`；注意数据噪声：也见过 `Guang`、`Gunagdong` 等拼写，需归一化映射）。
- 市：从 `supplierOperationalAddress.value` 解析。格式通常 `"<村/镇/街道>, <区/县>, <市>, <省>, China"`，取「省前一个 token」为市（`Hengshui`）；若地址只有 `"<省>, China"` 则市未知。
- 兜底：公司名中常含城市（如 `Hengshui Kangyuan...`），可用省市字典做子串匹配（命中记 `citySource:"companyName"`，置信度低）。
- `companyLocation.value` 只到省（`"Hebei, China"`），不能当城市来源。

---

## 5. 认证工厂目录（`/factory/index.html`，可选能力）

| 项 | 内容 |
|---|---|
| 页面 | `https://www.alibaba.com/factory/index.html`（导航「Verified manufacturers」） |
| 列表 API | `GET https://insights.alibaba.com/openservice/gatewayService?modelId=10300&endpoint=pc&categoryIds=0&pageNo=<n>&pageSize=<n>` |
| 实测能力 | `pageSize` 可到 100/500；`pageNo` 有效；`categoryIds` 有效；**`keyword` / `country` / `province` 参数被忽略**；`totalNum` 上限 500（深页会回退第 1 页） |
| 列表字段（示例） | `companyId`、`companyName`、`companyUrl`、`countryCode`、**`factoryProvince`**（省）、`goldSupplierYears`+`goldSupplierYearsText`、`assessedSupplier`、`tradeAssurance`、`rate`、`reviews`、`totalEmployeesText`、`factorySizeText`、`responseTime`、`companyOnTimeShipping`、`productList[]`、`imageList[]`、`atomoTags[]`、`detailIconList[]` |
| 筛选字典 | `modelId=10161` → `countryFilter[22]` + `tabs[43]`（类目 → 能力词条 id/关键词） |
| 类目树 | `modelId=10295&cateType=1`（可做 `--category` 字典） |
| 价值 | 可做「按省浏览认证工厂」（客户端对 500 条按 `factoryProvince` 过滤），**无城市**、无关键词；作为补充能力（v1.1 或 v1 可选） |

---

## 6. 地区筛选能力结论与方案

**结论**：平台不提供省/市筛选（只有国家/地区）。因此「按全国省/城市搜索」需要客户端实现，三个可行方案：

| 方案 | 做法 | 优点 | 缺点 |
|---|---|---|---|
| **A. 关键词 + 详情回填过滤（推荐）** | 搜索用产品词（或地点词）→ 逐条调详情（render.htm）拿省/市 → 客户端精确过滤 | 精确、城市级可行、可缓存 | 每页 20 条多 20 次详情 POST（可并发 2 + 缓存 7d，单查询封顶 60 家） |
| B. 地点关键词 | 直接把省/市名当 `keywords`（如 `hengshui`） | 快、零额外请求、贴合平台行为 | 相关性搜索，非严格 location，可能混入别地供应商 |
| C. 认证工厂目录 | `modelId=10300` 拉 500 家 → 按 `factoryProvince` 过滤 | 快、省维度免费 | 仅省、仅 500 家、无城市、无关键词 |

**推荐组合**：`search.suppliers` 默认 `locationMode=strict`（A，关键词可留空→地点词会先作为 query）；提供 `locationMode=keyword`（B）作为快速模式；`factories.list` 作为可选操作提供 C。城市过滤若地址缺失 → `cityUnknownPolicy=include|exclude`（默认 include，并打 `locationConfidence`）。

---

## 7. 会员套餐体系（摘要，详见 [membership-plans.md](./membership-plans.md)）

### 7.1 四层模型

| 层 | 内容 |
|---|---|
| A 会员档位 | 出口通（Gold Supplier Basic）→ Gold Supplier Plus → **金品诚企（Verified Supplier）** → 行业领袖（**Verified Pro / 领袖卖家**） |
| B 认证/验真 | Verified Supplier 徽章、第三方实地评估（Assessed/深度认证）、Verified Custom Manufacturer（身份类型）、ISO/BSCI/CE… |
| C 交易保障 | Trade Assurance（`ta=y`，按单收费，不是档位） |
| D 广告 | P4P/直通车、**Top Sponsor Listing/顶展**（`adInfo`/`newAd`，不是档位） |

### 7.2 结构化判定（v1 规则）

```text
列表卡（search）：
  verifiedSupplierPro === true           → plan = verified_pro      (Verified Pro / 领袖卖家)
  else isAssessedSupplier === true       → plan = verified_supplier (金品诚企 / Verified Supplier)
  else goldYearsInt > 0                  → plan = gold_supplier     (至少出口通 / Gold Supplier)
  else                                   → plan = unknown

详情（render.htm，可复核/升级列表结论）：
  shopSign.companyHasPassAssessment  === true → verified_supplier
  shopSign.companyHasPassOnsite      === true → 有实地验厂（金品附加层）
  shopSign.accountIsPaidMember       === true → 付费会员（≥出口通）
  shopSign.companyHasPassBaseVerify  → 基础验真
  shopSign.assessmentCertCompany     → 第三方机构（SGS/TÜV…）
  shopSign.authCards.identityInfo.identityKey = "strengthFactory" → 实力工厂/Custom Manufacturer（身份，不是档位）
  不可用于判档：memberTag / type / iconList / reviewScore / reviewCount / transactions / tag
```

- **Supplier Index** = `supplierStars`（0–5，SOPI 星级，详情页心形展示）；**不是** `reviewScore`（4.6/5 店铺评分）、也不是 `reviewCount`。
- `supplierRating`（值 6）含义待实测，不并入星级。
- 广告卡（`newAd/adInfo/adCount`）与会员无关，列表返回时打 `isAd` 标记。

### 7.3 v1 输出

`membership: { plan: verified_pro|verified_supplier|gold_supplier|unknown, label, badges[], verifiedSupplier: bool, verifiedPro: bool, onsiteAssessment: bool|null, assessedBy: string|null, evidence: {...} }`，并附 `raw`（可选）。

---

## 8. 风控与反爬实测

| 项 | 实测 |
|---|---|
| 滑块页 | `title="CAPTCHA Verification"`；`#baxia-punish`；track `#nc_1_wrapper` / `#nc_1_n1t`（300×34），手柄 `#nc_1_n1z`（42×34）；失败后出现**二维码**兜底（手机 App 扫码验证） |
| 触发条件 | headless 连续 2–3 个页面级导航（约 1 分钟内）即触发；headful 页面正常但快速连发（如搜索→详情 30s 内）也会触发 |
| 自动过滑块 | 已实现 `solveSlider()`：hover→按下→停顿→小位移→58 步缓动（先加速后减速）→微回拉→松开，全程 1.5–2.5s + 随机抖动；在 www.alibaba.com 上**成功一次**（页面直接恢复搜索页）；在公司子域上两次失败（页面报 `error: EzFB9f/WbwAdf`），疑似风控升级，需人工兜底 |
| 节奏 | 历史 session 各搜索页间隔约 14s（304 页连续访问成功过）；本次建议：页面级操作 ≥10–15s 间隔，详情 POST 可并发 1–2、单条间隔 1–2s |
| 登录态 | 登录后 cookie 有 `xman_f`/`xman_us_f`（长期）与会话级 token；**关闭浏览器进程后再次打开会掉登录**（本机已复现两次）→ 必须常驻浏览器（owner 进程） |
| x5sec | 过滑块后写 `x5sec` cookie（短时效），后续一段时间不再弹；失效后重新触发 |
| 语言切换 | 首页「语言/货币」React 下拉 + 保存；切 English-USD 后数据字段为英文（推荐客户端默认 en-US，输出更稳定） |

---

## 9. 对客户端的直接影响（设计约束）

1. **必须常驻单个 owner 浏览器进程**（profile 独立 `~/.ali-client/profile`），CLI/MCP 只做客户端代理，不各开浏览器（否则抢 profile/丢登录）。
2. **搜索用「导航 + `window._PAGE_DATA_`」**；详情用 **render.htm POST**；工厂目录用 insights gateway GET。全部只落**结构化字段**，不落 HTML/cookie。
3. **语言环境固定 en-US**（首次初始化时切一次并持久化），字段归一化在客户端完成（`goldYears`→int、金额/面积文案→数值+原文双存）。
4. **省市**：官方无筛选 → `search.suppliers` 增加 `province/city/locationMode`，默认严格模式（详情回填过滤，缓存 7d），可切关键词模式。
5. **风控**：页面级 ≥10s 间隔；详情 POST 并发 ≤2；滑块自动尝试 + 失败转人工中继（截图/REST `verification` 接口）；登录仅需一次（常驻进程）。
6. **广告/推荐位**：列表按 `newAd/adInfo` 标记，不混入自然结果统计。

---

## 10. 待确认/待实测

| # | 项 | 影响 | 建议 |
|---|---|---|---|
| 1 | 公司子域滑块自动过验证失败（`EzFB9f/WbwAdf`） | 详情回填可能被拦 | 降低详情并发/间隔；失败转人工；v1 明确降级 |
| 2 | 登录是否会话级 cookie（重启必掉） | 常驻进程要求 | 已按常驻设计；`status` 明示登录态 |
| 3 | `supplierRating`（=6）含义 | 是否输出 | 先不输出/标记 raw |
| 4 | 列表卡片「所在地」标签的 A/B 模板 | 能否省掉详情回填 | 不依赖；若命中模板可优化 |
| 5 | 搜索深页上限/风控阈值 | 单查询页数上限 | 默认 5 页，可配 |
| 6 | 英文环境 vs 中文环境字段差异（`tag`/`supplierMainProducts` 本地化） | 输出语言 | 固定 en-US；同时保留原文 |
| 7 | 二维码兜底是否可做成「扫码中继」 | 风控恢复手段 | 截图 + 人工扫码/REST 中继（参考 zhilian） |

---

## 11. 第二轮深挖实验（2026-11-15 晚，匿名 profile 独立验证）

> 目的：回答三个问题——① 不登录能不能拿到完整信息；② 定时滑块怎么过；③ 上游接口细节与边界。
> 证据：`artifacts/anon/`（匿名独立 profile）、`artifacts/anon/anon-captcha-events.jsonl`、登录态对照 `search_hebei_en_logged.page_data.json`。

### 11.1 匿名 vs 登录：数据完整度对照

| 维度 | 匿名（独立 fresh profile） | 登录（Cindy ring） | 结论 |
|---|---|---|---|
| 搜索卡片字段 | 35 个字段（`companyId`/`goldYears`/`isAssessedSupplier`/`verifiedSupplierPro`/`reviewScore`…） | **字段集合完全相同** | 匿名完整 |
| 搜索 `offerList` 条数 | 21 条/页（20+1 广告） | 21 条/页 | 一致 |
| `totalCount` | 739 / 712 / 745 / 776 / 745（逐次波动） | 757 | **本身剧烈波动，不能当精确数**；登录差异属噪声 |
| 筛选器 | Trade Assurance / Verified Supplier / Verified Pro / reviewScore / 认证 / 能力 | 相同 | 匿名完整 |
| 公司详情 | `shopSign`+`companyCard`+`companyOverview` 全量（含 `authCards` 悬浮卡、Supplier Index 星级、年限、主营产品、省市、认证） | 同源公开数据 | **匿名完整** |
| 工厂目录 | `modelId=10300` 全量字段（含 `factoryProvince`） | 同源 | 匿名完整 |
| 登录真正影响的 | — | 消息/订单/收藏/询盘等买家侧功能 | v1 不使用 |

**结论：v1 所需字段 100% 匿名可得；推荐「匿名优先 + 登录可选」，登录不是 v1 前置条件。**

### 11.2 fetch-first 采集策略（关键架构结论）

| 实验 | 结果 |
|---|---|
| 在 www 页内 **same-origin fetch** 搜索 URL（不回导航） | 200，~480–630KB HTML，可解析 `window._PAGE_DATA_`；**9 次搜索 fetch 连续 31s 无滑块** |
| 从 www 页 **跨子域 POST** `https://<sub>.en.alibaba.com/event/app/alisite/render.htm`（`componentKeys=shopSign,companyCard,companyOverview`） | **CORS 允许**，30/30 子域全部 200，单次 0.3–0.8s（≈19–45KB） |
| 30 家详情批量（间隔 0.55–1s） | 30/30 成功、41s、无滑块 |
| 10 次详情 + 9 次搜索混合 burst（31s） | 全部 200、无滑块 |
| 过滤参数（assessmentCompany/verifiedPro/ta/companyAuthTag/productAuthTag/tagKvPairIntFilter/reviewScore/sortType） | 全部生效；`assessmentCompany=true` 返回结果 `isAssessedSupplier` 比例 **1.00**；`verifiedPro=1` 样本 `verifiedSupplierPro=true` 3/3 |

**结论：owner 浏览器只保留 1 个 www worker 页，搜索/详情/工厂目录全部走 `page.evaluate(fetch)`，页面导航只用于兜底与过验证 → 风控暴露面大幅下降。**

### 11.3 分页边界与 `totalCount` 不可靠性

| 查询 | 可用页边界（实测） | 显示 totalCount |
|---|---|---|
| `keywords=hebei&tab=supplier` | page 30 有 20 条、page 31 仅 4 条、page 32 起 0 条（≈604 条封顶） | 712–784 波动 |
| `keywords=hebei&assessmentCompany=true` | page 20 仍有 20 条（过滤后更深） | 1619–1943 波动 |
| `keywords=hengshui`（城市关键词） | page 2 正常，total≈909–921 | 909/921 |
| **无关键词** `tab=supplier&country=CN` | page 40 仍有 20 条（"浏览全中国供应商"可用，但我们不依赖） | 1421–1924 波动 |
| `keywords=河北` / `keywords=衡水`（中文关键词） | 可用；中文地名可直接当关键词（河北 total≈600，衡水≈954） | — |

**结论：`totalCount` 只能当参考；分页应以「返回 0 条」为终止条件；客户端 `pages` 默认 5、硬上限建议 20。**

### 11.4 人机核验（滑块）治理

| 项 | 实测 |
|---|---|
| 触发条件 | **仅页面级导航**触发（约 8~9 次快速导航 / 30s 触发 1 次；缓慢 9–11s 间隔 4 次不触发；详情/搜索 fetch 150+ 次不触发） |
| x5sec 有效期 | 过验证后 ≈ **29.8 分钟**（events 日志：solve 14:37:11Z → expire 23:07 CST） |
| 自动过验证 | 3 次触发：第 1 次 attempt1 成功；第 2 次 attempt1 失败→reload→attempt2 成功；第 3 次同（失败→reload→成功）。**最终 3/3 成功，首次 2/3** |
| 恢复技巧 | 失败后 `page.reload()` 重新武装滑块再拖（本机验证有效）；二维码兜底出现时需人工扫码 |
| 异常态 | 人为删除 `x5sec` 后连续 XHR：fetch **挂起不返回**（16s race 超时；AbortSignal 也不生效）；导航到搜索页（可能过滑块）后 **fetch 恢复 200/1s**；单纯重启浏览器同一 profile **不能恢复**（风控绑 cookie/设备） |
| 客户端要点 | ① fetch 必须加 **watchdog 超时**（Node 侧 Promise.race 15–20s，避免页面内 fetch 挂死拖垮服务）② 超时后走「导航该 URL → 自动/人工过验证 → 重试 fetch」③ 连续 2 次失败进入冷却；④ 不要主动删 `x5sec`；⑤ `status` 暴露 `x5sec.expiresAt`、`riskState`、`watchdog.lastHungAt` |

### 11.5 会员判定修正（实测新增证据）

| 供应商样本 | `accountIsPaidMember` | `isGold` | `companyHasPassAssessment` | `companyHasPassOnsite` | 判定 |
|---|---|---|---|---|---|
| Kangyuan（金品） | true | true | true | true | `verified_supplier` |
| joyfiller / jianduomesh（非 assessed） | true | **false** | false | **true** | `gold_supplier`（出口通） |
| Verified Pro 样本 3 家 | true | — | true | — | `verified_pro`（list `verifiedSupplierPro=true`） |

**修正**：`isGold` 不能当出口通主判据（非 assessed 付费商家为 false）；`companyHasPassOnsite=true` **不等于**金品（出口通样本也有实地验厂）；出口通主判据 = `accountIsPaidMember=true` 且 `companyHasPassAssessment=false`。

### 11.6 详情新增可用字段（`companyOverview` 组件，匿名）

`companyEstablishedYear`（成立年份，如 2018）、`companyTotalRevenue`（年营收，可能是数字串如 `"6216823"` 或区间文案如 `"US$2.5 Million - US$5 Million"`）、`companyNumberOfEmployees`（`"11 - 50 People"`）、`companyMainMarket`、`supplierMainProducts`（英文）、`supplierAcceptedPaymentType/DeliveryTerms/Currency`、`supplierContractManufacturing`（OEM/Design/Buyer label）、`companyDescription`、`supplierAdvantageDescription`、`capacityTags`、`companyHasPassAssessment/Onsite/AV/BaseVerify`、`assessmentCertCompany`、`companyIdentityInfo`。

> 注意与 `companyCard.authCards` 的指标区分：`totalExportRevenuePreYear`（$2231223，近一年出口额）≠ `companyTotalRevenue`（年营收，例子 $6216823 或区间文案）。

## 12. 证据清单（`exploration/2026-11-15/artifacts/`）

| 文件 | 内容 |
|---|---|
| `search.page_data.json` / `search.html` / `search.png` | 匿名中文搜索页（首份干净 JSON） |
| `search_hebei_en_logged.page_data.json` / `.html` / `.png` | **英文 + 登录态**搜索页（最终数据模型依据） |
| `kangyuan_profile2.html` + `kangyuan_profile2.requests.jsonl` + `.xhr.jsonl` | 公司详情页与 **render.htm POST 原始请求/响应** |
| `render_components.json` | `componentKeys=shopSign,companyCard` 的完整解析结果（本报告字段依据） |
| `kangyuan_profile.shopBizData.json` | 页面 `window.shopBizData`（公司 ID / isGold / leaderSupplier / pageModuleMap） |
| `factory_index.html` / `factory_index2.xhr.jsonl` / `factory_model10300.json` / `factory_model10161.json` | 认证工厂目录页 + 列表 API + 筛选字典 |
| `cn_prov_c.page_data.json` / `prod_cn.page_data.json` | `country=CN` 的供应商/产品 tab（证明 Province 分组为空） |
| `home_en2.png` / `search_hebei_en_logged.png` / `cn_prov_c.png` / `factory_index.png` | 关键页面截图 |
| `scripts/daemon.mjs` / `scripts/cmd.mjs` / `artifacts/daemon.log` | 常驻浏览器 daemon 与驱动脚本 |
| `membership-plans.md` | 会员套餐体系与识别规则调研（含 20 个来源链接） |
| `anon/anon_search_hebei_p1.page_data.json` | 匿名英文搜索页（对照登录态字段集） |
| `anon/anon_detail_components_full.json` | 匿名详情：`shopSign+companyCard+companyOverview+globalData` 全量 |
| `anon/anon_component_enum.json` | 详情 render.htm 组件 key 枚举（有效 key：shopSign/companyCard/companyOverview/companyMultimediaSummary/globalData/productGroups/footer） |
| `anon/anon_detail_batch30.json` | 30 家详情批量：30/30 成功、41s、无滑块 |
| `anon/anon_burst_matrix.json` | 混合 burst：9 搜索 fetch + 10 详情 CORS，无滑块 |
| `anon/anon_filters_boundary.json` | 深页边界 + 全部过滤参数验证 |
| `anon/anon_boundary_keyword.json` / `anon_cn_browse_keyword_variants.json` | 分页边界、无关键词 country=CN、中文关键词验证 |
| `anon/anon_pro_and_membership_samples.json` | Verified Pro 正样本 + 出口通/金品判定修正证据 |
| `anon/anon_fetch_captcha_*.json` | x5sec 删除后的 fetch 挂起/恢复实验 |
| `anon/anon-captcha-events.jsonl` | 3 次滑块事件（时间、attempts、x5sec 有效期） |

---

*报告完。下一步：按评审意见定稿 [接口草案](../../docs/02-接口草案.md) → 复制 zhilian-client 骨架实现 → 实测联调。*

---

## 13. M4 联调结果（2026-11-15，实现 v0.1.0）

> 实现：`src/`（TypeScript，约 6.4k 行）+ `spec/` 生成物 + `tests/`；本机 systemd 常驻 `ali-client.service`（REST 8792）。以下均为真实运行结果（匿名模式）。

### 13.1 构建与测试

| 项 | 结果 |
|---|---|
| `npm run build` | ✅（tsc strict） |
| `npm test` | ✅ 31/31（解析器/地区/会员/缓存/envelope，不启浏览器） |
| `npm run gen:check` | ✅ OpenAPI/MCP/CLI spec 与 `operations.ts` 同源 |
| `systemctl --user status ali-client` | ✅ running（cloak FHS + headful Chromium 常驻） |
| `GET /v1/health` | ✅ `{service:"ali-client",version:"0.1.0"}` |
| `GET /docs`、`/openapi.json`、`/mcp-tools.json` | ✅ 自包含文档与机器契约 |

### 13.2 真实上游联调

| 场景 | 命令（CLI） | 结果 |
|---|---|---|
| 省 strict 过滤 | `search suppliers -k "solid tire" --province Hebei --pages 1 --max-enrich 20` | 21 卡去重 20 家 → 回填 20 → 命中 1（Xingtai, Hebei）；21.6s；`gold_supplier` |
| 城市过滤（无关键词） | `search suppliers --province Hebei --city Hengshui --pages 1 --max-enrich 12` | 地点词=Hengshui → 回填 12 → 命中 10（全部 Hengshui）；18.7s |
| 公司详情 | `suppliers detail --store kangyuanxiangsu` | `joinedYears=6`、`supplierIndex.stars=2`、主营产品、`Hebei/Hengshui`、`verified_supplier` + SGS + onsite、评分 4.6、年出口额 $2231223、厂房 5000m²、产线 10、成立 2018 |
| 翻页缓存 | `suppliers list --query-id q_... --page 1` | `cached: true`，与 search 结果一致 |
| 认证工厂目录 | `factories list --province Hebei --page-size 20` | ✅ 返回并过滤省份 |
| 地区字典 | `regions list --level city --province Hebei` | ✅ 11 个地级市 |
| MCP stdio | `node scripts/mcp-smoke.mjs` | ✅ 16 tools；regions/health/search/detail 全部成功 |
| 风控 | 全流程 | 未触发滑块（fetch-first；页面导航仅初始化一次）；`status.risk.state=normal` |

### 13.3 实现偏差与遗留

- **companyId 详情需要先有一次 search 建立子域映射**（或用 `--store`）；已在错误信息中提示。
- `totalCount` 仍不可靠（沿用实测结论），分页以「返回 0 条」终止。
- 真实登录测试**未做**（anonymous-first 下 v1 全部能力不依赖登录；登录接口保留）。
- 滑块自动过验证沿用探路实现（类人拖拽 + reload 重试 3 轮），联调中未触发，未做二次压测。
- 工厂目录/详情 SSR 模块（supplierPerformance 等）仍只取结构化 API 部分，页面级指标为 v1.1 范围。

### 13.4 交付物

- 代码与生成物：`src/`、`spec/`、`tests/`、`scripts/`
- 部署：`systemd/ali-client.service`（本机已安装并 enable）、`bin/ali-run`、`.env.example`
- Agent 技能：`skills/ali/SKILL.md`
- README（含 AI 图例 + 真实截图）：仓库根 `README.md`、`docs/assets/`
- GitHub：<https://github.com/CindyRIng/ali-client>

### 13.5 自测与修复（2026-11-16）

实现后做了一轮端到端自测（`npm run self-test`，35 项，需常驻服务），发现并修复以下问题：

| # | 问题 | 修复 |
|---|---|---|
| 1 | `ali` 命令未注册到 PATH | `ln -sfn bin/ali-run ~/.local/bin/ali`（文档已写） |
| 2 | 常驻进程加载旧 `dist/`（改代码后行为不更新） | 流程约定：`npm run build && systemctl --user restart ali-client`；文档 FAQ 补充 |
| 3 | `ali verify solve` 在无滑块时错误返回 `solved:true` | 改为抛 `CAPTCHA_FAILED`（no active captcha）；QR 类型提示人工扫码 |
| 4 | `ali serve` 与 systemd owner 冲突时报浏览器 profile 占用（难懂） | `serve` 先探测既有 REST：已运行则提示并退出 0 |
| 5 | 登录复用 worker 页，登录期间/取消后可能影响采集 | 登录改为**独立页面**；worker 不受影响；`loginCancel` 关闭登录页；`status.worker.url` 报告真实页面 |
| 6 | 缓存 TTL 在 SQLite 层硬编码（忽略 `ALI_TTL_*` 配置） | TTL 改为从 config 传入 SQLite 缓存 |
| 7 | strict 查询翻到未抓取页时返回**未过滤**原始列表 | 翻页抓取同样执行详情回填 + 省市过滤（与 search 一致） |
| 8 | `--format plain` 未真正实现 | 支持 suppliers/regions/factories/detail 的 TSV 输出 |
| 9 | 少数错误码退出码不准确（`CAPTCHA_FAILED` 等） | 统一映射到 exit 3（风控/上游） |
| 10 | 登录 `loginId` 未校验 | 未知 loginId 返回 `NOT_FOUND` |
| 11b | **`ali search suppliers -k 河北` 报 `SERVICE_UNAVAILABLE`（REST 不可达）**：`locationMode` zod `.optional()` 叠加 `.default('strict')`，无省市也走 strict → 5 页 100 家 + 60 家详情回填 ~90s，超过 CLI→REST 30s 超时 | 请求 schema 改为裸 `z.enum(...).optional()`（无省市默认 `off`）；CLI→REST 超时提升到 180s（`ALI_CLIENT_TIMEOUT_MS`）并区分 `UPSTREAM_TIMEOUT` 文案；自测新增「纯关键词默认 off」回归用例 |
| 11 | **从其它目录运行 `ali` 报 `UNAUTHENTICATED: invalid token`**（launcher 未加载仓库 `.env`） | `bin/ali-run` 自动 `export ALI_ENV_FILE=<repo>/.env`；`dist/main.js` 增加 cwd 缺失时回退仓库根 `.env`；REST 401 文案给出 token/ALI_ENV_FILE 提示；自测新增 cwd=~ 用例 |

自测结果：**34 passed / 0 warn / 0 failed**（命令注册、CLI 16 项、REST 8 项、MCP、systemd、核心数据断言）。脚本：`scripts/self-test.mjs`（`npm run self-test`）。
