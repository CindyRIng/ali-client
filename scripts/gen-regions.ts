/**
 * 生成 src/data/regions.ts（中国内地 31 省级行政区 + 地级行政单位）
 *
 * 数据源：data/pca-code.json（GitHub modood/Administrative-divisions-of-China 的 pca-code）
 * 用法：pnpm gen:regions / npx tsx scripts/gen-regions.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pinyin } from 'pinyin-pro';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SRC = path.join(ROOT, 'data/pca-code.json');
const OUT = path.join(ROOT, 'src/data/regions.ts');

interface PcaNode {
  code: string;
  name: string;
  children?: PcaNode[];
}

const PROVINCE_EN: Record<string, string> = {
  '11': 'Beijing',
  '12': 'Tianjin',
  '13': 'Hebei',
  '14': 'Shanxi',
  '15': 'Inner Mongolia',
  '21': 'Liaoning',
  '22': 'Jilin',
  '23': 'Heilongjiang',
  '31': 'Shanghai',
  '32': 'Jiangsu',
  '33': 'Zhejiang',
  '34': 'Anhui',
  '35': 'Fujian',
  '36': 'Jiangxi',
  '37': 'Shandong',
  '41': 'Henan',
  '42': 'Hubei',
  '43': 'Hunan',
  '44': 'Guangdong',
  '45': 'Guangxi',
  '46': 'Hainan',
  '50': 'Chongqing',
  '51': 'Sichuan',
  '52': 'Guizhou',
  '53': 'Yunnan',
  '54': 'Tibet',
  '61': 'Shaanxi',
  '62': 'Gansu',
  '63': 'Qinghai',
  '64': 'Ningxia',
  '65': 'Xinjiang',
};

/** 城市英文名覆盖（pinyin 与阿里展示不一致的高频城市） */
const CITY_EN: Record<string, string> = {
  哈尔滨市: 'Harbin',
  西安市: "Xi'an",
  乌鲁木齐市: 'Urumqi',
  拉萨市: 'Lhasa',
  呼和浩特市: 'Hohhot',
  呼伦贝尔市: 'Hulunbuir',
  锡林郭勒盟: 'Xilingol',
  鄂尔多斯市: 'Ordos',
  巴彦淖尔市: 'Bayannur',
  乌兰察布市: 'Ulanqab',
  阿拉善盟: 'Alxa',
  兴安盟: 'Hinggan',
  齐齐哈尔市: 'Qiqihar',
};

/** 阿里页面常见拼写噪声 → 规范省名（用于 resolver 归一化） */
export const PROVINCE_NOISE: Record<string, string> = {
  gunagdong: 'Guangdong',
  guandong: 'Guangdong',
  guang: 'Guangdong',
  guangxi: 'Guangxi',
  hebei: 'Hebei',
  hebei_province: 'Hebei',
  'guangdong province': 'Guangdong',
  'jiangsu province': 'Jiangsu',
  'zhejiang province': 'Zhejiang',
  'shandong province': 'Shandong',
  'fujian province': 'Fujian',
  'henan province': 'Henan',
  'hubei province': 'Hubei',
  'hunan province': 'Hunan',
  'anhui province': 'Anhui',
  'hebei province': 'Hebei',
  'sichuan province': 'Sichuan',
  'liaoning province': 'Liaoning',
  'jiangxi province': 'Jiangxi',
};

function stripSuffix(name: string, suffixes: string[]): string {
  for (const s of suffixes) {
    if (name.endsWith(s)) return name.slice(0, -s.length);
  }
  return name;
}

function py(text: string): string {
  return pinyin(text, { toneType: 'none', type: 'array' }).join('');
}

function cap(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

function uniq(list: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  for (const item of list) {
    if (!item) continue;
    const v = item.trim();
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

function main(): void {
  const raw = JSON.parse(fs.readFileSync(SRC, 'utf8')) as PcaNode[];
  const provinces: Array<Record<string, unknown>> = [];
  const cities: Array<Record<string, unknown>> = [];

  for (const p of raw) {
    const provShort = stripSuffix(p.name, ['壮族自治区', '回族自治区', '维吾尔自治区', '自治区', '省', '市', '特别行政区']);
    const provEn = PROVINCE_EN[p.code] ?? cap(py(provShort));
    const provPinyin = py(provShort);
    const provCode = `CN-${p.code}`;
    provinces.push({
      code: provCode,
      level: 'province',
      nameZh: provShort,
      nameEn: provEn,
      pinyin: provPinyin,
      aliases: uniq([provShort, p.name, provEn, provEn.toUpperCase(), provPinyin, cap(provPinyin)]),
      aliSpellings: uniq([provEn, provEn.toUpperCase()]),
      parentCode: 'CN',
    });

    for (const c of p.children ?? []) {
      const isMunicipality = ['11', '12', '31', '50'].includes(p.code);
      if (c.name === '市辖区' && isMunicipality) {
        cities.push({
          code: `CN-${p.code}-${c.code}`,
          level: 'city',
          nameZh: `${provShort}市`,
          nameEn: provEn,
          pinyin: provPinyin,
          aliases: uniq([provShort, `${provShort}市`, provEn, provEn.toUpperCase(), provPinyin]),
          aliSpellings: uniq([provEn]),
          parentCode: provCode,
        });
        continue;
      }
      const cityShort = stripSuffix(c.name, ['市', '地区', '自治州', '盟']);
      const cityEn = CITY_EN[c.name] ?? cap(py(cityShort));
      const cityPinyin = py(cityShort);
      cities.push({
        code: `CN-${p.code}-${c.code}`,
        level: 'city',
        nameZh: c.name,
        nameEn: cityEn,
        pinyin: cityPinyin,
        aliases: uniq([cityShort, c.name, cityEn, cityEn.toUpperCase(), cityPinyin, cap(cityPinyin)]),
        aliSpellings: uniq([cityEn]),
        parentCode: provCode,
      });
    }
  }

  const lines: string[] = [];
  lines.push('/**');
  lines.push(' * 中国内地 31 省级行政区 + 地级行政单位注册表（自动生成，勿手动编辑）');
  lines.push(' *');
  lines.push(' * 生成：npm run gen:regions（数据源 data/pca-code.json + pinyin-pro）');
  lines.push(' * 说明：省/市 code 采用 GB 风格 CN-<省码>-<市码>；aliases 覆盖中文/英文/拼音/大写；');
  lines.push(' *      aliSpellings 用于匹配阿里页面上的供应商所在地。');
  lines.push(' */');
  lines.push('');
  lines.push('export interface RegionSeed {');
  lines.push('  code: string;');
  lines.push("  level: 'province' | 'city';");
  lines.push('  nameZh: string;');
  lines.push('  nameEn: string;');
  lines.push('  pinyin: string;');
  lines.push('  aliases: string[];');
  lines.push('  aliSpellings: string[];');
  lines.push('  parentCode: string;');
  lines.push('}');
  lines.push('');
  lines.push('export const REGION_SEED: RegionSeed[] = [');
  for (const r of [...provinces, ...cities]) {
    lines.push(`  ${JSON.stringify(r)},`);
  }
  lines.push('];');
  lines.push('');
  lines.push('export const PROVINCE_NOISE: Record<string, string> = {');
  for (const [k, v] of Object.entries(PROVINCE_NOISE)) {
    lines.push(`  ${JSON.stringify(k)}: ${JSON.stringify(v)},`);
  }
  lines.push('};');
  lines.push('');
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, lines.join('\n'));
  console.log(`generated ${OUT}: ${provinces.length} provinces, ${cities.length} cities`);
}

main();
