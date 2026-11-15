/**
 * 搜索页解析：SSR HTML -> window._PAGE_DATA_ -> 供应商摘要
 */
import { AliError } from '../../errors/catalog.js';
import type { SupplierSummary } from '../../domain/supplier.js';
import { absoluteUrl, storeSubdomainFromUrl } from '../../domain/supplier.js';
import { parseYears } from '../../domain/common.js';
import { classifyMembership } from './membership.js';
import {
  asArr,
  asBool,
  asNum,
  asObj,
  asStr,
  extractPageData,
  getPath,
  splitCsv,
} from './helpers.js';

export interface ParsedSearchPage {
  pageIndex: number;
  pageSize: number;
  totalCount: number | null;
  adCount: number;
  items: SupplierSummary[];
  keyword: string | null;
}

export function parseSearchPage(html: string): ParsedSearchPage {
  const pageData = extractPageData(html);
  if (!pageData) {
    throw new AliError('UPSTREAM_CHANGED', 'window._PAGE_DATA_ not found in search page (page may be captcha/blank)');
  }
  const offerResult = asObj(pageData.offerResultData);
  if (!offerResult) {
    throw new AliError('UPSTREAM_CHANGED', 'offerResultData missing in _PAGE_DATA_');
  }
  const offerList = asArr(offerResult.offerList);
  const items: SupplierSummary[] = [];
  let adCount = 0;
  let rank = 0;
  offerList.forEach((raw, index) => {
    const obj = asObj(raw);
    if (!obj) return;
    const companyId = asStr(obj.companyId);
    const companyName = asStr(obj.companyName);
    if (!companyId || !companyName) return;
    const isAd = obj.newAd === true || asObj(obj.adInfo) !== null;
    if (isAd) adCount++;
    else rank++;
    const adInfo = asObj(obj.adInfo);
    const goldYearsText = asStr(obj.goldYears);
    const membership = classifyMembership({
      list: {
        verifiedSupplierPro: asBool(obj.verifiedSupplierPro),
        isAssessedSupplier: asBool(obj.isAssessedSupplier),
        goldYearsText,
      },
    });
    const provideProducts = asStr(obj.provideProducts) ?? '';
    const storeUrl = absoluteUrl(asStr(obj.action));
    const adType: SupplierSummary['adType'] = isAd
      ? String(getPath(adInfo, 'creativeInfo.tpText') ?? '').toLowerCase().includes('sponsor')
        ? 'top_sponsor'
        : 'p4p'
      : null;
    items.push({
      companyId,
      companyName,
      storeUrl,
      storeSubdomain: storeSubdomainFromUrl(storeUrl),
      logoUrl: absoluteUrl(asStr(obj.companyIcon)),
      country: 'CN',
      location: {
        country: 'CN',
        countryName: 'China',
        province: null,
        provinceCode: null,
        city: null,
        cityCode: null,
        address: null,
        display: null,
        confidence: 'unknown',
        source: 'none',
      },
      joinedYears: parseYears(goldYearsText),
      joinedYearsText: goldYearsText,
      supplierIndex: null,
      membership,
      mainProducts: splitCsv(provideProducts),
      mainProductsText: provideProducts || null,
      rating: {
        score: asNum(obj.reviewScore),
        count: asNum(obj.reviewCount) !== null ? Math.trunc(asNum(obj.reviewCount) as number) : null,
      },
      businessType: { raw: null, manufacturer: null, tradingCompany: null },
      staffText: asStr(obj.staff),
      factoryAreaText: asStr(obj.area),
      transactionsText: asStr(obj.transactions),
      responseTime: asStr(obj.replyAvgTime),
      capabilityTags: asArr(obj.tag).map((t) => asStr(t)).filter((t): t is string => !!t),
      rank: isAd ? null : rank,
      isAd,
      adType,
      position: index + 1,
      enriched: false,
    });
  });
  return {
    pageIndex: asNum(offerResult.pageIndex) !== null ? Math.trunc(asNum(offerResult.pageIndex) as number) : 1,
    pageSize: asNum(offerResult.pageSize) !== null ? Math.trunc(asNum(offerResult.pageSize) as number) : 20,
    totalCount: asNum(offerResult.totalCount),
    adCount,
    items,
    keyword: asStr(pageData.keyword),
  };
}

/** 从 _PAGE_DATA_ 中提取页级筛选信息（用于 debug/元数据，可选） */
export function parsePageMeta(html: string): { keyword: string | null; tab: string | null; serverUri: string | null } {
  const pageData = extractPageData(html);
  if (!pageData) return { keyword: null, tab: null, serverUri: null };
  return {
    keyword: asStr(pageData.keyword),
    tab: asStr(getPath(pageData, 'requestData.tab')),
    serverUri: asStr(getPath(pageData, 'requestData.serverUri')),
  };
}
