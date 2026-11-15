/**
 * MCP server stdio 冒烟：list tools + 调 regions/health/search
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({ command: './bin/ali-run', args: ['mcp'], cwd: process.cwd() });
const client = new Client({ name: 'ali-smoke', version: '0.1.0' }, { capabilities: {} });
await client.connect(transport);

const tools = await client.listTools();
console.log('tools:', tools.tools.length);
console.log('names:', tools.tools.map((t) => t.name).sort().join(','));

const call = async (name, args) => {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content?.[0]?.text ?? '{}';
  return { isError: !!r.isError, payload: JSON.parse(text) };
};

const regions = await call('ali_regions', { level: 'city', province: 'Hebei' });
console.log('regions:', regions.payload.ok, 'count=', regions.payload.data.count, 'first=', regions.payload.data.items[0]?.nameEn);

const health = await call('ali_health', {});
console.log('health:', health.payload.ok, health.payload.data?.service, health.payload.data?.version);

const search = await call('ali_search_suppliers', {
  keyword: 'solid tire',
  province: 'Hebei',
  pages: 1,
  maxEnrich: 3,
  filters: { verifiedSupplier: false },
});
const d = search.payload.data ?? {};
console.log('search:', search.payload.ok, 'queryId=', d.queryId, 'returned=', (d.suppliers || []).length, 'mode=', d.location?.mode);

const detail = await call('ali_supplier_detail', { store: 'kangyuanxiangsu' });
console.log('detail:', detail.payload.ok, detail.payload.data?.companyName?.slice(0, 30), 'years=', detail.payload.data?.joinedYears, 'stars=', detail.payload.data?.supplierIndex?.stars, 'plan=', detail.payload.data?.membership?.plan);

await client.close();
process.exit(0);
