/**
 * 上游 URL 构造器（全部来自 docs/02-接口草案.md §24.4 与两轮实测）
 */
import type { Config } from '../../config/schema.js';

export interface SearchUrlParams {
  keyword: string;
  page: number;
  country?: string;
  filters?: {
    verifiedSupplier?: boolean;
    verifiedPro?: boolean;
    tradeAssurance?: boolean;
    minReviewScore?: string;
    companyAuthTags?: string[];
    productAuthTags?: string[];
    capabilities?: string[];
  };
  sort?: 'default' | 'resrat';
}

/** 能力标签英文名 → tagKvPairIntFilter id（实测） */
export const CAPABILITY_IDS: Record<string, string> = {
  'suppliers fortune 500 companies': '5',
  'design-based customization': '6',
  'sample-based customization': '7',
  'environmentally compliant': '8',
  'finished product inspection': '10',
  'full customization': '11',
  'quality management certified': '12',
  'r&d capabilities': '13',
  'socially responsible': '34',
  'supplier assessment procedures': '35',
};

export function buildSearchUrl(cfg: Config, params: SearchUrlParams): string {
  const url = new URL(cfg.searchUrl);
  url.searchParams.set('fsb', 'y');
  url.searchParams.set('IndexArea', 'product_en');
  url.searchParams.set('has4Tab', 'true');
  url.searchParams.set('keywords', params.keyword);
  url.searchParams.set('originKeywords', params.keyword);
  url.searchParams.set('tab', 'supplier');
  url.searchParams.set('page', String(params.page));
  if (params.country) url.searchParams.set('country', params.country);
  const f = params.filters ?? {};
  if (f.verifiedSupplier) url.searchParams.set('assessmentCompany', 'true');
  if (f.verifiedPro) url.searchParams.set('verifiedPro', '1');
  if (f.tradeAssurance) url.searchParams.set('ta', 'y');
  if (f.minReviewScore) url.searchParams.set('reviewScore', f.minReviewScore);
  for (const tag of f.companyAuthTags ?? []) url.searchParams.append('companyAuthTag', tag);
  for (const tag of f.productAuthTags ?? []) url.searchParams.append('productAuthTag', tag);
  for (const cap of f.capabilities ?? []) {
    const id = CAPABILITY_IDS[cap.toLowerCase()] ?? (/^\d+$/.test(cap) ? cap : null);
    if (id) url.searchParams.append('tagKvPairIntFilter', id);
  }
  if (params.sort === 'resrat') url.searchParams.set('sortType', 'RESRAT');
  return url.toString();
}

/** 供应商详情组件接口（从 www worker 页跨子域 POST） */
export function buildRenderApiUrl(subdomain: string): string {
  return `https://${subdomain}.en.alibaba.com/event/app/alisite/render.htm`;
}

export function renderApiBody(subdomain: string, componentKeys = 'shopSign,companyCard,companyOverview'): string {
  return new URLSearchParams({
    esiteSubDomain: `https://${subdomain}.en.alibaba.com`,
    renderType: 'component',
    clientType: 'PC',
    componentKeys,
  }).toString();
}

/** 认证工厂目录（insights gateway） */
export function buildFactoryApiUrl(cfg: Config, params: { categoryId: string; page: number; pageSize: number }): string {
  const url = new URL(cfg.factoryApiUrl);
  url.searchParams.set('modelId', '10300');
  url.searchParams.set('endpoint', 'pc');
  url.searchParams.set('categoryIds', params.categoryId);
  url.searchParams.set('pageNo', String(params.page));
  url.searchParams.set('pageSize', String(params.pageSize));
  return url.toString();
}

export function buildCompanyProfileUrl(subdomain: string): string {
  return `https://${subdomain}.en.alibaba.com/company_profile.html`;
}
