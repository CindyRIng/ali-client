/**
 * 上游解析器单元测试（用 2026-11-15 真机探路产物做 fixture，不启浏览器）
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractPageData, firstNumber, cleanText, splitCsv } from '../src/adapters/alibaba/helpers.js';
import { parseSearchPage } from '../src/adapters/alibaba/page-data.js';
import { parseRenderResponse, mapSupplierDetail } from '../src/adapters/alibaba/detail.js';
import { parseFactoryPage } from '../src/adapters/alibaba/factory.js';
import { classifyMembership } from '../src/adapters/alibaba/membership.js';

const ART = path.join(process.cwd(), 'exploration/2026-11-15/artifacts');

function loadJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(path.join(ART, file), 'utf8')) as T;
}

describe('helpers', () => {
  it('extractPageData 能平衡扫描完整 JSON', () => {
    const html = '<script>window._PAGE_DATA_ = {"a":{"b":"},"},"c":[1,2]};</script>';
    const data = extractPageData(html);
    expect(data).toEqual({ a: { b: '},' }, c: [1, 2] });
  });
  it('extractPageData 缺失时返回 null', () => {
    expect(extractPageData('<html></html>')).toBeNull();
  });
  it('文本归一化', () => {
    expect(firstNumber('5,000+ m²')).toBe(5000);
    expect(firstNumber('$2231223')).toBe(2231223);
    expect(cleanText('a &amp; b')).toBe('a & b');
    expect(splitCsv('Solid Tires, Forklift Tires')).toEqual(['Solid Tires', 'Forklift Tires']);
  });
});

describe('搜索页解析（匿名真机 fixture）', () => {
  const pageData = loadJson<Record<string, unknown>>('anon/anon_search_hebei_p1.page_data.json');
  const html = `window._PAGE_DATA_ = ${JSON.stringify(pageData)};`;
  const parsed = parseSearchPage(html);

  it('解析出页级信息与供应商卡片', () => {
    expect(parsed.pageSize).toBe(20);
    expect(parsed.items.length).toBeGreaterThan(10);
    expect(parsed.totalCount).toBeGreaterThan(100);
    const first = parsed.items[0];
    expect(first.companyId).toMatch(/^\d+$/);
    expect(first.companyName.length).toBeGreaterThan(3);
    expect(first.storeSubdomain).toBeTruthy();
  });

  it('去重键唯一（companyId）', () => {
    const ids = parsed.items.map((x) => x.companyId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('广告卡有标记', () => {
    const ads = parsed.items.filter((x) => x.isAd);
    expect(ads.length).toBeGreaterThanOrEqual(1);
    expect(ads[0].adType).toBeTruthy();
  });
});

describe('详情组件解析（匿名真机 fixture）', () => {
  const components = loadJson<Record<string, Record<string, unknown>>>('anon/anon_detail_components_full.json');
  const fakeResponse = {
    data: {
      shopSign: { data: JSON.stringify(components.shopSign) },
      companyCard: { data: JSON.stringify(components.companyCard) },
      companyOverview: { data: JSON.stringify(components.companyOverview) },
    },
  };
  const parsed = parseRenderResponse(fakeResponse);
  const detail = mapSupplierDetail({
    companyId: '258180302',
    components: parsed,
    list: { verifiedSupplierPro: false, isAssessedSupplier: true, goldYearsText: '6 yrs' },
  });

  it('核心字段：上平台年限 / Supplier Index / 主营产品', () => {
    expect(detail.companyId).toBe('258180302');
    expect(detail.joinedYears).toBe(6);
    expect(detail.supplierIndex?.stars).toBe(2);
    expect(detail.supplierIndex?.maxStars).toBe(5);
    expect(detail.mainProducts).toContain('Solid Tires');
  });

  it('省市解析：Hengshui / Hebei', () => {
    expect(detail.location.province).toBe('Hebei');
    expect(detail.location.city).toBe('Hengshui');
    expect(detail.location.confidence).toBe('high');
    expect(detail.location.provinceCode).toBe('CN-13');
  });

  it('会员识别：金品诚企 + SGS + 实地验厂', () => {
    expect(detail.membership.plan).toBe('verified_supplier');
    expect(detail.membership.verifiedSupplier).toBe(true);
    expect(detail.membership.onsiteAssessment).toBe(true);
    expect(detail.membership.assessedBy).toContain('SGS');
  });

  it('基础经营指标', () => {
    expect(detail.performance.storeRating.score).toBe(4.6);
    expect(detail.performance.onTimeDeliveryRate).toBe('100.0%');
    expect(detail.performance.totalExportRevenueUSD).toBe(2231223);
    expect(detail.performance.floorSpaceM2).toBe(5000);
    expect(detail.performance.productionLines).toBe(10);
    expect(detail.profile.establishedYear).toBe(2018);
    expect(detail.profile.employees).toContain('People');
  });

  it('身份与信任字段', () => {
    expect(detail.identity.key).toBe('strengthFactory');
    expect(detail.businessType.raw).toBe('Manufacturer, Trading Company');
    expect(detail.trust.tradeAssurance.enabled).toBe(true);
    expect(detail.trust.verifiedSupplier).toBe(true);
  });
});

describe('会员识别规则（实测样本）', () => {
  it('verified_pro 最高优先', () => {
    const m = classifyMembership({ list: { verifiedSupplierPro: true, isAssessedSupplier: true, goldYearsText: '12 yrs' } });
    expect(m.plan).toBe('verified_pro');
    expect(m.rank).toBe(3);
  });
  it('金品诚企', () => {
    const m = classifyMembership({ list: { verifiedSupplierPro: false, isAssessedSupplier: true }, detail: { companyHasPassAssessment: true } });
    expect(m.plan).toBe('verified_supplier');
  });
  it('出口通：付费且未 assessed，不依赖 isGold', () => {
    const m = classifyMembership({ list: { isAssessedSupplier: false }, detail: { accountIsPaidMember: true, isGold: false } });
    expect(m.plan).toBe('gold_supplier');
  });
  it('onsite 不等于金品', () => {
    const m = classifyMembership({ detail: { companyHasPassOnsite: true, accountIsPaidMember: true, companyHasPassAssessment: false } });
    expect(m.plan).toBe('gold_supplier');
    expect(m.onsiteAssessment).toBe(true);
  });
  it('未知', () => {
    expect(classifyMembership({ list: {} }).plan).toBe('unknown');
  });
});

describe('认证工厂目录解析（匿名真机 fixture）', () => {
  const json = loadJson<Record<string, unknown>>('factory_model10300.json');
  const parsed = parseFactoryPage(json);
  it('解析出工厂列表与省份', () => {
    expect(parsed.items.length).toBeGreaterThan(0);
    const first = parsed.items[0];
    expect(first.companyId).toMatch(/^\d+$/);
    expect(first.province).toBeTruthy();
  });
});
