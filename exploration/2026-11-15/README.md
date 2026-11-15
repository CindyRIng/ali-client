# 2026-11-15 阿里国际站探路实验（第一轮 + 第二轮深挖）

> 本目录是 `ali-client` 文档阶段的上游实测证据，**不是客户端代码**。
> 结论汇总见 [REPORT.md](./REPORT.md)；会员体系见 [membership-plans.md](./membership-plans.md)。

## 目录

```
exploration/2026-11-15/
├── README.md                 # 本文件：证据索引与复现说明
├── REPORT.md                 # 实测报告（请求链路/字段/匿名对照/fetch-first/验证治理）
├── membership-plans.md       # 会员套餐与识别规则调研（含来源链接）
├── scripts/                  # 复现用探针脚本（Node ESM，需 cloak-env）
│   ├── daemon.mjs            # 常驻浏览器 daemon（多实例、循环导航、自动过滑块、模块导出）
│   ├── cmd.mjs               # 文件队列驱动（支持 ALI_CMD/ALI_RES/ALI_STATUS 多实例）
│   └── probe.mjs             # 单次探针（home/search/detail/url）
└── artifacts/                # 实测产物
    ├── *.html / *.png / *.json / *.jsonl   # 第一轮（登录态/中英文/详情/工厂目录）
    └── anon/                               # 第二轮（独立匿名 profile：对照/bypass/边界实验）
```

## 复现方式（本机）

```bash
# 1) 确认共享 cloak 环境
~/cloak-env/bin/cloak-env-info

# 2) 在 ali-client 内临时链接依赖（实现阶段会改为 package.json 正式依赖）
mkdir -p node_modules
ln -sfn ~/zhilian-client/node_modules/cloakbrowser node_modules/cloakbrowser
ln -sfn ~/zhilian-client/node_modules/playwright-core node_modules/playwright-core

# 3) 启动 daemon（示例：独立匿名 profile）
ALI_PROFILE=$HOME/.ali-client/profile-anon \
ALI_OUT=$PWD/exploration/2026-11-15/artifacts/anon \
ALI_CMD=/tmp/ali2-cmd.json ALI_RES=/tmp/ali2-res.json ALI_STATUS=/tmp/ali2-daemon.json \
ALI_LOG=anon-daemon.log ALI_EVENTS=anon-captcha-events.jsonl \
~/cloak-env/bin/cloak-run node exploration/2026-11-15/scripts/daemon.mjs

# 4) 发命令
ALI_CMD=/tmp/ali2-cmd.json ALI_RES=/tmp/ali2-res.json ALI_STATUS=/tmp/ali2-daemon.json \
node exploration/2026-11-15/scripts/cmd.mjs '{"action":"goto","url":"https://www.alibaba.com/","name":"home"}'
```

## 证据使用约定

- `artifacts/` 与 `artifacts/anon/` 中的 HTML/PNG 体积较大，已在 `.gitignore` 中排除；JSON/JSONL 证据保留。
- 报告中的字段名/参数均来自这些实测文件，引用时请注明文件路径。
- 上游页面会随版本变化，复现结果可能与报告有差异；以报告结论 + 当前实测为准。
