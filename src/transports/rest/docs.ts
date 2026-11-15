/**
 * 自包含 REST 文档页（/docs）
 */
import { OPERATIONS } from '../../api/operations.js';
import { VERSION, type Config } from '../../config/schema.js';

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

export function buildDocsHtml(config: Config): string {
  const rows = OPERATIONS.map((op) => {
    const method = op.rest.method;
    const auth = op.auth === 'bearer' ? 'Bearer' : '—';
    return `<tr>
      <td><code>${escapeHtml(op.id)}</code></td>
      <td><span class="m ${method.toLowerCase()}">${method}</span> <code>${escapeHtml(op.rest.path)}</code></td>
      <td>${escapeHtml(auth)}</td>
      <td>${escapeHtml(op.summary)}</td>
      <td><code>${escapeHtml(op.cli.command)}</code></td>
      <td><code>${escapeHtml(op.mcp.name)}</code></td>
    </tr>`;
  }).join('\n');

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>ali-client REST API · ${VERSION}</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans SC", sans-serif; background: #0b1020; color: #dbe4ff; }
  header { padding: 28px 32px 8px; }
  h1 { margin: 0 0 6px; font-size: 26px; letter-spacing: .3px; }
  .sub { color: #8ea0c9; font-size: 14px; }
  .wrap { padding: 18px 32px 48px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 14px; margin: 18px 0; }
  .card { background: #121a33; border: 1px solid #223055; border-radius: 12px; padding: 14px 16px; }
  .card b { color: #9fb4e6; font-size: 13px; display: block; margin-bottom: 6px; }
  .card code { color: #7ee0c5; }
  table { width: 100%; border-collapse: collapse; background: #101832; border: 1px solid #223055; border-radius: 12px; overflow: hidden; font-size: 13px; }
  th, td { text-align: left; padding: 9px 10px; border-bottom: 1px solid #1b2746; vertical-align: top; }
  th { background: #162041; color: #a9bce8; font-weight: 600; }
  tr:last-child td { border-bottom: 0; }
  .m { display: inline-block; min-width: 44px; text-align: center; border-radius: 6px; padding: 1px 6px; font-size: 11px; font-weight: 700; }
  .m.get { background: #12324a; color: #6fd3ff; }
  .m.post { background: #1d2d16; color: #9fe870; }
  .m.delete { background: #3a1a20; color: #ff8d9e; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
  pre { background: #0e1630; border: 1px solid #223055; border-radius: 10px; padding: 12px 14px; overflow: auto; font-size: 12px; line-height: 1.55; }
  a { color: #7ee0c5; }
  .note { background: #121a33; border-left: 3px solid #7ee0c5; border-radius: 8px; padding: 10px 14px; color: #b9c8ec; font-size: 13px; margin: 14px 0; }
</style>
</head>
<body>
<header>
  <h1>ali-client REST API <span class="sub">v${VERSION}</span></h1>
  <div class="sub">阿里国际站 alibaba.com 本机只读客户端 · 供应商搜索 / 公司详情 / 地区字典 / 会员识别</div>
</header>
<div class="wrap">
  <div class="note">
    <b>只读</b>：不询盘、不聊天、不收藏、不写后台。除 <code>/v1/health</code>、<code>/docs</code>、<code>/openapi.json</code>、<code>/mcp-tools.json</code> 外，
    都需要 <code>Authorization: Bearer &lt;ALI_API_TOKEN&gt;</code>。默认只监听 <code>127.0.0.1:${config.port}</code>。
  </div>
  <div class="grid">
    <div class="card"><b>健康</b><code>GET /v1/health</code></div>
    <div class="card"><b>状态</b><code>GET /v1/status</code></div>
    <div class="card"><b>OpenAPI</b><code><a href="/openapi.json">/openapi.json</a></code></div>
    <div class="card"><b>MCP tools</b><code><a href="/mcp-tools.json">/mcp-tools.json</a></code></div>
    <div class="card"><b>CLI</b><code>ali --help</code></div>
    <div class="card"><b>数据目录</b><code>~/.ali-client</code></div>
  </div>
  <h2 style="font-size:18px;margin:22px 0 10px">统一响应 envelope</h2>
  <pre>{
  "ok": true,
  "data": { },
  "meta": { "schemaVersion": "1.0", "requestId": "r_xxx", "timestamp": "...", "tookMs": 12, "cached": false, "mode": "anonymous", "warnings": [] },
  "error": null
}</pre>
  <h2 style="font-size:18px;margin:22px 0 10px">操作（${OPERATIONS.length}）</h2>
  <table>
    <thead><tr><th>operation</th><th>REST</th><th>鉴权</th><th>说明</th><th>CLI</th><th>MCP</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <h2 style="font-size:18px;margin:22px 0 10px">示例</h2>
  <pre># 健康 / 状态
curl -s http://127.0.0.1:${config.port}/v1/health
curl -s -H "Authorization: Bearer $ALI_API_TOKEN" http://127.0.0.1:${config.port}/v1/status

# 省份字典（city 级）
curl -s -H "Authorization: Bearer $ALI_API_TOKEN" "http://127.0.0.1:${config.port}/v1/regions?level=city&province=Hebei"

# 搜索（strict：详情回填后精确过滤）
curl -s -X POST http://127.0.0.1:${config.port}/v1/search/suppliers \\
  -H "Authorization: Bearer $ALI_API_TOKEN" -H 'content-type: application/json' \\
  -d '{"keyword":"solid tire","province":"Hebei","city":"Hengshui","pages":1,"filters":{"verifiedSupplier":true}}'

# 详情（上平台年限 / Supplier Index / 主营产品 / 会员）
curl -s -H "Authorization: Bearer $ALI_API_TOKEN" http://127.0.0.1:${config.port}/v1/suppliers/258180302</pre>
</div>
</body>
</html>`;
}
