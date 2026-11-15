/**
 * 地区归一化 / 省市解析测试
 */
import { describe, expect, it } from 'vitest';
import {
  listRegions,
  parseSupplierLocation,
  resolveLocationQuery,
  searchRegions,
  provinceByCode,
  cityByCode,
} from '../src/adapters/alibaba/regions.js';

describe('地区字典', () => {
  it('31 省级行政区', () => {
    const all = listRegions({ level: 'province' });
    expect(all.items.length).toBe(31);
  });
  it('河北下有 11 个地级市', () => {
    const cities = listRegions({ level: 'city', province: 'Hebei' });
    expect(cities.items.length).toBe(11);
    expect(cities.items.map((c) => c.nameEn)).toContain('Hengshui');
  });
  it('中文/英文/拼音/代码均可归一化', () => {
    for (const input of ['河北', '河北省', 'Hebei', 'HEBEI', 'hebei', 'CN-13']) {
      expect(resolveLocationQuery({ province: input }).province?.nameEn).toBe('Hebei');
    }
  });
  it('只给城市时反查省份', () => {
    const r = resolveLocationQuery({ city: '衡水' });
    expect(r.province?.nameEn).toBe('Hebei');
    expect(r.city?.nameEn).toBe('Hengshui');
  });
  it('城市不属于该省时报错', () => {
    expect(() => resolveLocationQuery({ province: 'Hebei', city: 'Guangzhou' })).toThrow(/not in province/);
  });
  it('未知地区带候选', () => {
    try {
      resolveLocationQuery({ province: 'Hebi' });
      throw new Error('should throw');
    } catch (err) {
      expect(String((err as { code?: string }).code)).toBe('INVALID_ARGUMENT');
    }
  });
  it('地区搜索命中', () => {
    expect(searchRegions('衡水')[0]?.nameEn).toBe('Hengshui');
    expect(searchRegions('shenzhen')[0]?.nameEn).toBe('Shenzhen');
  });
});

describe('省市地址解析', () => {
  it('完整地址：省 + 市', () => {
    const loc = parseSupplierLocation({
      provinceText: 'Hebei',
      addressText: 'Zhang Qi Village, Jianghe Town, Hengshui, Hebei, China',
      companyName: 'Hengshui Kangyuan Rubber And Plastic Technology Co., Ltd.',
    });
    expect(loc.province).toBe('Hebei');
    expect(loc.city).toBe('Hengshui');
    expect(loc.cityCode).toBe('CN-13-1311');
    expect(loc.confidence).toBe('high');
  });
  it('只有省时 confidence=medium', () => {
    const loc = parseSupplierLocation({ provinceText: 'Hebei', addressText: 'Hebei, China' });
    expect(loc.province).toBe('Hebei');
    expect(loc.city).toBeNull();
    expect(loc.confidence).toBe('medium');
  });
  it('地址带噪声拼写（HEBEI / Gunagdong）', () => {
    const loc = parseSupplierLocation({ provinceText: 'Gunagdong', addressText: 'Foshan, Gunagdong, China' });
    expect(loc.province).toBe('Guangdong');
  });
  it('代码查询', () => {
    expect(provinceByCode('CN-13')?.nameEn).toBe('Hebei');
    expect(cityByCode('CN-13-1311')?.nameEn).toBe('Hengshui');
  });
});
