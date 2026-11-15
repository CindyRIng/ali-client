/**
 * 安全 JSON 遍历小工具（上游字段类型不稳定，全部按 unknown 处理）
 */
export type Json = unknown;

export function asObj(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export function asArr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

export function asStr(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return null;
}

export function asNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.replace(/[$,%\s,]/g, ''));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function asBool(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    if (/^(true|1|yes)$/i.test(v)) return true;
    if (/^(false|0|no)$/i.test(v)) return false;
  }
  return null;
}

/** 取 a.b.c（缺失返回 undefined） */
export function getPath(root: unknown, path: string): unknown {
  let cur: unknown = root;
  for (const key of path.split('.')) {
    const obj = asObj(cur);
    if (!obj) return undefined;
    cur = obj[key];
  }
  return cur;
}

/** 取字符串值：既支持 "x" 也支持 {value:"x"} / {value:123} */
export function pickValue(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const direct = asStr(v);
  if (direct !== null) return direct;
  const obj = asObj(v);
  if (!obj) return null;
  const inner = obj.value;
  return asStr(inner);
}

export function pickBool(v: unknown): boolean | null {
  const obj = asObj(v);
  if (obj) return asBool(obj.value);
  return asBool(v);
}

/** 上游 JSON 字符串多一层：JSON.parse 失败则原样返回 */
export function parseJsonMaybe(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v) as unknown;
  } catch {
    return v;
  }
}

/** HTML 实体与多余空白清理 */
export function cleanText(input: string | null | undefined): string | null {
  if (input === null || input === undefined) return null;
  const text = input
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text || null;
}

/** 解析 "5,000+ m²" / "$2231223" / "50.00%" 之类文本中的首个数值 */
export function firstNumber(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = /-?\d[\d,]*(?:\.\d+)?/.exec(text);
  if (!m) return null;
  const n = Number(m[0].replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** 猜测金额/区间的 kind */
export function revenueKind(text: string | null): 'number' | 'range' | 'unknown' {
  if (!text) return 'unknown';
  const t = text.trim();
  if (/^\d[\d,]*$/.test(t)) return 'number';
  if (/[-–~]|million|billion|thousand/i.test(t)) return 'range';
  if (/^\$?\d[\d,]*$/.test(t)) return 'number';
  return 'unknown';
}

export function splitCsv(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .split(/[,，;；]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 从 HTML 中提取 window._PAGE_DATA_ 的完整 JSON 对象（平衡扫描，字符串转义感知） */
export function extractPageData(html: string): Record<string, unknown> | null {
  const marker = 'window._PAGE_DATA_';
  const idx = html.indexOf(marker);
  if (idx < 0) return null;
  const start = html.indexOf('{', idx);
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(html.slice(start, i + 1)) as unknown;
          return asObj(parsed);
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
