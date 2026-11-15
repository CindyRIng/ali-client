# ali-client SKILL（阿里国际站供应商线索）

> 本地只读客户端 `ali-client` 的 Agent 工作流说明。所有操作只读、低频；不询盘、不聊天、不写后台。
> 直接调用 CLI（`ali ...`）或 MCP（`ali_*` 工具）。先确认 `ali health` / `ali status` 正常。

## 能力速查

| 目标 | CLI | MCP |
|---|---|---|
| 健康/状态 | `ali health` / `ali status` | `ali_health` / `ali_status` |
| 省/市字典 | `ali regions list --level city --province Hebei` | `ali_regions` |
| 地区搜索（中/英/拼音） | `ali regions search 衡水` | `ali_region_search` |
| 搜工厂（关键词+省市） | `ali search suppliers --keyword "solid tire" --province Hebei --city Hengshui --pages 2` | `ali_search_suppliers` |
| 翻页 | `ali suppliers list --query-id q_xxx --page 2` | `ali_list_suppliers` |
| 公司详情（年限/Supplier Index/主营产品/会员） | `ali suppliers detail --company-id 258180302` | `ali_supplier_detail` |
| 认证工厂目录（仅省） | `ali factories list --province Hebei --category 44` | `ali_factories_list` |
| 会员规则 | `ali memberships` | `ali_membership_catalog` |
| 缓存 | `ali cache stats/clear` | `ali_cache_stats` / `ali_cache_clear` |
| 滑块验证 | `ali verify status` / `ali verify solve` | `ali_verification_get` / `ali_verification_solve` |

## 工作流 1：按地区找工厂（获客线索）

1. 确认地区：`ali regions search <用户输入>` 得到 `nameEn/code`；
2. 搜索：`ali search suppliers --province Hebei --city Hengshui --pages 1 --max-enrich 60`（strict 模式会回填详情并按省市精确过滤）；
3. 可选筛选：`--verified-supplier`（金品诚企）/ `--verified-pro`（领袖卖家）/ `--min-review 4.5`；
4. 拿 `queryId` 翻页：`ali suppliers list --query-id ... --page N`；
5. 批量补详情：`ali suppliers detail --company-id <id>`，输出线索字段（公司名、省市、年限、Supplier Index、主营产品、会员档位、评分/响应）；
6. 输出 JSON 供下游（`-f json`），不要编造字段；标注证据（list/detail）与置信度（`location.confidence`）。

## 工作流 2：按产品词找工厂 + 地区过滤

`ali search suppliers --keyword "led light" --province Guangdong --pages 2` → strict 模式自动回填并过滤；若结果过少，可切 `--location-mode keyword`（快速但模糊）对比。

## 工作流 3：供应商核验

`ali suppliers detail --company-id <id>` 或 `--store <subdomain>`，重点看：
- `supplierIndex.stars`（0–5，Supplier Index/SOPI）≠ `performance.storeRating`（买家评分）；
- `membership.plan`：`verified_pro` > `verified_supplier`（金品诚企）> `gold_supplier`（出口通）> `unknown`，并读 `membership.evidence`；
- `location`：省市 + `confidence`；`identity`（Custom Manufacturer/实力工厂）。

## 失败处理

| 返回 | 处理 |
|---|---|
| `CAPTCHA_REQUIRED` | 读 `details.verification`（截图/轨道/手柄）；`ali verify solve` 自动过；失败则人工/坐标中继或扫码 |
| `RATE_LIMITED` / `RISK_COOLDOWN` | 按 `retryAfterMs` 冷却，降低页数与频次 |
| `PAGE_NOT_AVAILABLE` | 提高 `--pages` 或重新 search |
| `NOT_FOUND`（详情 companyId） | 先跑一次 search 建立映射，或用 `--store <subdomain>` |

## 约束

- 每次最多 5 页（硬上限 20）；strict enrich ≤60 家/查询；
- 只读、低频；不要并发轰炸；不保存 cookie/HTML/验证码；
- 数据可能波动（`totalCount` 不可靠），以实际返回为准。
