/**
 * 认证工厂目录解析（insights gateway modelId=10300）
 */
import { AliError } from '../../errors/catalog.js';
import type { FactoryItem } from '../../domain/factories.js';
import { parseYears } from '../../domain/common.js';
import { asArr, asBool, asNum, asObj, asStr, getPath, splitCsv } from './helpers.js';

export interface ParsedFactoryPage {
  pageNo: number;
  totalNum: number | null;
  items: FactoryItem[];
}

export function parseFactoryPage(json: unknown): ParsedFactoryPage {
  const root = asObj(json);
  if (!root) throw new AliError('UPSTREAM_CHANGED', 'factory api: invalid json');
  const code = asNum(root.code);
  if (code !== 200) {
    throw new AliError('UPSTREAM_ERROR', `factory api code=${String(root.code)} msg=${asStr(root.msg) ?? ''}`);
  }
  const data = asObj(root.data);
  const list = asArr(data?.list);
  const page = asObj(data?.page);
  const items: FactoryItem[] = [];
  for (const raw of list) {
    const obj = asObj(raw);
    if (!obj) continue;
    const companyId = asStr(obj.companyId);
    const companyName = asStr(obj.companyName);
    if (!companyId || !companyName) continue;
    const products = asArr(obj.productList).map((p) => {
      const po = asObj(p);
      return {
        title: asStr(po?.title) ?? asStr(po?.subject) ?? null,
        imageUrl: asStr(po?.imageUrl) ?? asStr(getPath(po, 'imageUrls.original')) ?? null,
        url: asStr(po?.action) ?? asStr(po?.url) ?? null,
      };
    });
    items.push({
      companyId,
      companyName,
      companyUrl: asStr(obj.companyUrl),
      countryCode: asStr(obj.countryCode) ?? 'CN',
      province: asStr(obj.factoryProvince),
      goldSupplierYears: parseYears(asStr(obj.goldSupplierYearsText) ?? asNum(obj.goldSupplierYears)),
      goldSupplierYearsText: asStr(obj.goldSupplierYearsText),
      assessedSupplier: asBool(obj.assessedSupplier) === true,
      tradeAssurance: asBool(obj.tradeAssurance) === true,
      rate: asNum(obj.rate),
      reviews: asNum(obj.reviews) !== null ? Math.trunc(asNum(obj.reviews) as number) : null,
      onTimeShipping: asStr(obj.companyOnTimeShipping),
      responseTime: asStr(obj.responseTime),
      employeesText: asStr(obj.totalEmployeesText),
      factorySizeText: asStr(obj.factorySizeText),
      products,
    });
  }
  return {
    pageNo: asNum(page?.pageNo) !== null ? Math.trunc(asNum(page?.pageNo) as number) : 1,
    totalNum: asNum(page?.totalNum),
    items,
  };
}

/** 兼容直接导出 splitCsv 供测试使用 */
export { splitCsv };
