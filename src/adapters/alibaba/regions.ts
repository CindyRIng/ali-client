/**
 * 地区归一化 / 省市解析（平台没有省/市筛选，客户端补齐）
 */
import { REGION_SEED, PROVINCE_NOISE, type RegionSeed } from '../../data/regions.js';
import { AliError } from '../../errors/catalog.js';
import type { Region } from '../../domain/region.js';
import type { SupplierLocation } from '../../domain/supplier.js';
import { cleanText } from './helpers.js';

const PROVINCES: RegionSeed[] = REGION_SEED.filter((r) => r.level === 'province');
const CITIES: RegionSeed[] = REGION_SEED.filter((r) => r.level === 'city');
const BY_CODE = new Map<string, RegionSeed>();
const CITY_BY_PROVINCE = new Map<string, RegionSeed[]>();

for (const r of REGION_SEED) BY_CODE.set(r.code, r);
for (const c of CITIES) {
  const list = CITY_BY_PROVINCE.get(c.parentCode) ?? [];
  list.push(c);
  CITY_BY_PROVINCE.set(c.parentCode, list);
}

/** 去掉常见后缀并归一化为查找 key */
export function normalizeKey(input: string): string {
  return cleanText(input)
    ?.toLowerCase()
    .replace(/[\s_\-.'’]/g, '')
    .replace(/(省|市|自治区|特别行政区|province|city|shi|sheng)$/g, '')
    .trim() ?? '';
}

function makeAliasIndex(seed: RegionSeed[]): Map<string, RegionSeed[]> {
  const index = new Map<string, RegionSeed[]>();
  for (const r of seed) {
    const keys = new Set<string>([normalizeKey(r.code), normalizeKey(r.nameZh), normalizeKey(r.nameEn), normalizeKey(r.pinyin)]);
    for (const a of r.aliases) keys.add(normalizeKey(a));
    for (const a of r.aliSpellings) keys.add(normalizeKey(a));
    for (const k of keys) {
      if (!k) continue;
      const list = index.get(k) ?? [];
      if (!list.includes(r)) list.push(r);
      index.set(k, list);
    }
  }
  return index;
}

const PROVINCE_INDEX = makeAliasIndex(PROVINCES);
const CITY_INDEX = makeAliasIndex(CITIES);

function toRegion(seed: RegionSeed): Region {
  return { ...seed, aliases: [...seed.aliases], aliSpellings: [...seed.aliSpellings] };
}

export function provinceByCode(code: string): Region | null {
  const seed = BY_CODE.get(code);
  return seed && seed.level === 'province' ? toRegion(seed) : null;
}

export function cityByCode(code: string): Region | null {
  const seed = BY_CODE.get(code);
  return seed && seed.level === 'city' ? toRegion(seed) : null;
}

export function citiesOfProvince(provinceCode: string): Region[] {
  return (CITY_BY_PROVINCE.get(provinceCode) ?? []).map(toRegion);
}

function resolveOne(input: string, level: 'province' | 'city'): Region | null {
  const key = normalizeKey(input);
  if (!key) return null;
  const index = level === 'province' ? PROVINCE_INDEX : CITY_INDEX;
  const direct = index.get(key);
  if (direct && direct.length === 1) return toRegion(direct[0]);
  if (direct && direct.length > 1) {
    // 同名城市（极少见）：返回第一个并在上层做 province 约束
    return toRegion(direct[0]);
  }
  if (level === 'province') {
    const noise = PROVINCE_NOISE[key] ?? PROVINCE_NOISE[`${key}province`];
    if (noise) {
      const found = PROVINCES.find((p) => p.nameEn.toLowerCase() === noise.toLowerCase());
      if (found) return toRegion(found);
    }
  }
  return null;
}

export interface ResolvedLocationQuery {
  province: Region | null;
  city: Region | null;
}

export function resolveLocationQuery(input: { province?: string; city?: string }): ResolvedLocationQuery {
  let province = input.province ? resolveOne(input.province, 'province') : null;
  let city = input.city ? resolveOne(input.city, 'city') : null;

  if (input.province && !province) {
    throw new AliError('INVALID_ARGUMENT', `unknown province: ${input.province}`, {
      details: { candidates: fuzzy(input.province, 5).map((r) => ({ code: r.code, nameEn: r.nameEn, nameZh: r.nameZh })) },
    });
  }
  if (input.city && !city) {
    throw new AliError('INVALID_ARGUMENT', `unknown city: ${input.city}`, {
      details: { candidates: fuzzy(input.city, 5).map((r) => ({ code: r.code, nameEn: r.nameEn, nameZh: r.nameZh })) },
    });
  }
  if (city && !province) {
    province = provinceByCode(city.parentCode);
  }
  if (province && city && city.parentCode !== province.code) {
    throw new AliError('INVALID_ARGUMENT', `city ${city.nameEn} is not in province ${province.nameEn}`, {
      details: { province: province.code, city: city.code, cities: citiesOfProvince(province.code).map((c) => c.nameEn) },
    });
  }
  return { province, city };
}

export function listRegions(opts: { level?: 'province' | 'city'; province?: string } = {}): {
  level?: 'province' | 'city';
  province: Region | null;
  items: Region[];
} {
  const province = opts.province ? resolveOne(opts.province, 'province') : null;
  if (opts.province && !province) {
    throw new AliError('INVALID_ARGUMENT', `unknown province: ${opts.province}`);
  }
  if (opts.level === 'province') return { level: 'province', province: null, items: PROVINCES.map(toRegion) };
  if (opts.level === 'city') {
    const items = province ? citiesOfProvince(province.code) : CITIES.map(toRegion);
    return { level: 'city', province, items };
  }
  return { province: null, items: REGION_SEED.map(toRegion) };
}

function fuzzy(q: string, limit: number): RegionSeed[] {
  const key = normalizeKey(q);
  if (!key) return [];
  const scored = REGION_SEED.map((r) => {
    const hay = [r.nameZh, r.nameEn, r.pinyin, ...r.aliases].map(normalizeKey);
    let score = 0;
    for (const h of hay) {
      if (h === key) score = 100;
      else if (h.startsWith(key)) score = Math.max(score, 80);
      else if (h.includes(key)) score = Math.max(score, 60);
      if (score >= 100) break;
    }
    return { r, score };
  })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return scored.map((x) => x.r);
}

export function searchRegions(q: string, limit = 20): Region[] {
  return fuzzy(q, limit).map(toRegion);
}

/** 从阿里详情地址/公司名解析省/市（用于 strict 回填过滤） */
export function parseSupplierLocation(input: {
  provinceText?: string | null;
  addressText?: string | null;
  companyName?: string | null;
  country?: string | null;
}): SupplierLocation {
  const provinceText = cleanText(input.provinceText);
  const addressText = cleanText(input.addressText);
  const companyName = cleanText(input.companyName);
  const country = input.country ?? 'CN';

  let province: Region | null = provinceText ? resolveOne(provinceText, 'province') : null;
  if (!province && addressText) {
    for (const token of addressText.split(',').map((s) => s.trim()).reverse()) {
      const p = resolveOne(token, 'province');
      if (p) {
        province = p;
        break;
      }
    }
  }
  let city: Region | null = null;
  if (addressText) {
    const tokens = addressText.split(',').map((s) => s.trim()).filter(Boolean);
    for (const token of [...tokens].reverse()) {
      const c = resolveOne(token, 'city');
      if (c) {
        if (!province || c.parentCode === province.code) {
          city = c;
          break;
        }
      }
    }
  }
  let confidence: SupplierLocation['confidence'] = 'unknown';
  if (province && city) confidence = 'high';
  else if (province) confidence = 'medium';
  else if (city) confidence = 'low';
  if (!city && companyName) {
    for (const c of CITIES) {
      if (province && c.parentCode !== province.code) continue;
      const hit = [c.nameEn, c.nameZh, ...c.aliases].some((alias) => {
        const a = normalizeKey(alias);
        return a.length >= 3 && normalizeKey(companyName).includes(a);
      });
      if (hit) {
        city = toRegion(c);
        confidence = province ? 'medium' : 'low';
        break;
      }
    }
  }
  return {
    country,
    ...(country === 'CN' ? { countryName: 'China' } : {}),
    province: province?.nameEn ?? null,
    provinceCode: province?.code ?? null,
    city: city?.nameEn ?? null,
    cityCode: city?.code ?? null,
    address: addressText,
    display: province ? `${province.nameEn}, ${country === 'CN' ? 'China' : country}` : null,
    confidence,
    source: 'detail',
  };
}
