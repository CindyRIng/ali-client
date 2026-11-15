/**
 * 公司详情解析：render.htm 组件（shopSign / companyCard / companyOverview）→ SupplierDetail
 */
import { AliError } from '../../errors/catalog.js';
import { parseYears } from '../../domain/common.js';
import type { SupplierDetail } from '../../domain/supplier.js';
import { absoluteUrl } from '../../domain/supplier.js';
import { classifyMembership, type ListMembershipInput } from './membership.js';
import { parseSupplierLocation } from './regions.js';
import {
  asArr,
  asBool,
  asNum,
  asObj,
  asStr,
  cleanText,
  firstNumber,
  getPath,
  parseJsonMaybe,
  pickBool,
  pickValue,
  revenueKind,
  splitCsv,
} from './helpers.js';

export interface RenderComponents {
  shopSign: Record<string, unknown> | null;
  companyCard: Record<string, unknown> | null;
  companyOverview: Record<string, unknown> | null;
}

export function parseRenderResponse(json: unknown): RenderComponents {
  const root = asObj(json);
  const data = asObj(root?.data);
  if (!data) throw new AliError('UPSTREAM_CHANGED', 'render.htm response missing data');
  const component = (key: string): Record<string, unknown> | null => {
    const comp = asObj(data[key]);
    if (!comp) return null;
    const inner = asObj(parseJsonMaybe(comp.data));
    if (!inner) return null;
    return asObj(inner.data) ?? inner;
  };
  return {
    shopSign: component('shopSign'),
    companyCard: component('companyCard'),
    companyOverview: component('companyOverview'),
  };
}

function authGroupItems(card: Record<string, unknown> | null, group: string): Record<string, unknown>[] {
  const groups = asArr(getPath(card, 'authCards.value.authGroupInfoList'));
  const found = groups
    .map((g) => asObj(g))
    .find((g) => g && asStr(g.authGroup) === group);
  if (!found) return [];
  return asArr(found.authInfoList).map((x) => asObj(x)).filter((x): x is Record<string, unknown> => !!x);
}

function authValue(items: Record<string, unknown>[], key: string): string | null {
  const item = items.find((x) => asStr(x.authKey) === key);
  return item ? asStr(item.authValue) : null;
}

function authNames(items: Record<string, unknown>[]): string[] {
  return items
    .map((x) => asStr(x.authName) ?? asStr(x.authNameForBuyer))
    .filter((x): x is string => !!x);
}

export interface MapDetailOptions {
  companyId: string;
  components: RenderComponents;
  list?: ListMembershipInput | null;
}

export function mapSupplierDetail(opts: MapDetailOptions): SupplierDetail {
  const { companyId, components, list } = opts;
  const shop = components.shopSign;
  const card = components.companyCard;
  const ov = components.companyOverview;
  if (!shop && !card) {
    throw new AliError('UPSTREAM_CHANGED', 'render.htm components shopSign/companyCard both missing');
  }

  const companyName = asStr(shop?.companyName) ?? asStr(card?.companyName) ?? `Company ${companyId}`;
  const subdomainRaw = asStr(shop?.esiteSubDomain);
  const subdomain = subdomainRaw ? subdomainRaw.split('.')[0] : null;
  const storeUrl = subdomain ? `https://${subdomain}.en.alibaba.com/company_profile.html` : null;
  const logo = absoluteUrl(asStr(shop?.companyLogoFileUrl) ?? asStr(card?.companyLogoFileUrl));
  const country = asStr(shop?.companyRegisterCountry) ?? asStr(card?.companyRegisterCountry) ?? 'CN';

  const joinedYearsText =
    pickValue(shop?.companyJoinYears) ??
    pickValue(card?.companyJoinYears) ??
    pickValue(shop?.accountJoinYears) ??
    null;
  const joinedYears = parseYears(joinedYearsText);

  const productsFromOverview = pickValue(ov?.supplierMainProducts);
  const productsFromCard = asStr(getPath(card, 'companyMainMarket.descMarkets.0.products'));
  const productsFromShop = asArr(shop?.supplierMainProducts)
    .map((p) => asStr(p))
    .filter((p): p is string => !!p);
  const mainProducts = productsFromOverview
    ? splitCsv(productsFromOverview)
    : productsFromCard
      ? splitCsv(productsFromCard)
      : productsFromShop;

  const businessTypeRaw =
    asStr(pickValue(card?.companyBusinessType)) ??
    asStr(pickValue(shop?.companyBusinessType)) ??
    asStr(pickValue(ov?.companyBusinessType));

  const provinceText = pickValue(shop?.companyRegisterProvince) ?? pickValue(ov?.companyLocation);
  const addressText = pickValue(shop?.supplierOperationalAddress);
  const location = parseSupplierLocation({
    provinceText,
    addressText,
    companyName,
    country,
  });

  const identityInfo =
    asObj(getPath(card, 'authCards.value.identityInfo')) ?? asObj(getPath(ov, 'companyIdentityInfo.value'));
  const identity = {
    key: asStr(identityInfo?.identityKey),
    name: asStr(identityInfo?.identityName),
    nameZh: asStr(identityInfo?.identityNameMdsKey) ?? null,
    verified: pickBool(shop?.companyHasPassAssessment) ?? asBool(card?.companyHasPassAssessment),
    description: cleanText(asStr(identityInfo?.identityDesc)),
  };

  const assessmentCert =
    asStr(getPath(ov, 'assessmentCertCompany.value.title')) ??
    asStr(getPath(ov, 'assessmentCertCompany.value.name')) ??
    asStr(getPath(shop, 'assessmentCertCompany.title')) ??
    asStr(getPath(shop, 'assessmentCertCompany.name')) ??
    asStr(getPath(card, 'assessmentCertCompany.title'));
  const detailFlags = {
    companyHasPassAssessment:
      pickBool(shop?.companyHasPassAssessment) ?? asBool(card?.companyHasPassAssessment),
    companyHasPassOnsite: pickBool(shop?.companyHasPassOnsite) ?? asBool(card?.companyHasPassOnsite),
    companyHasPassBaseVerify:
      pickBool(shop?.companyHasPassBaseVerify) ?? asBool(card?.companyHasPassBaseVerify),
    companyHasPassAV: pickBool(shop?.companyHasPassAV) ?? asBool(card?.companyHasPassAV),
    accountIsPaidMember: asBool(shop?.accountIsPaidMember) ?? asBool(card?.accountIsPaidMember),
    isGold: asBool(card?.isGold),
    isNewGolden: pickBool(shop?.isNewGolden) ?? asBool(card?.isNewGolden),
    assessmentCertCompany: assessmentCert,
    goldYearsText: joinedYearsText,
  };
  const membership = classifyMembership({ list, detail: detailFlags });

  const stars =
    asNum(shop?.supplierStars) !== null
      ? Math.trunc(asNum(shop?.supplierStars) as number)
      : asNum(card?.supplierStars) !== null
        ? Math.trunc(asNum(card?.supplierStars) as number)
        : null;
  const maxStarsRaw = Math.trunc(
    asNum(pickValue(shop?.maxStar)) ?? asNum(pickValue(card?.maxStar)) ?? 5,
  );
  const supplierIndex = {
    stars,
    maxStars: Math.min(5, Math.max(1, maxStarsRaw)),
    label: 'Supplier Index',
    source: 'shopSign.supplierStars',
  };

  const basic = authGroupItems(card, 'basicCapacity');
  const productionService = authGroupItems(card, 'productionServiceCapacity');
  const qualityAssurance = authGroupItems(card, 'qualityAssuranceCapability');

  const reviews = asObj(card?.supplierRatingReviews);
  const ratingScore = asNum(reviews?.averageStar);
  const ratingCount = asNum(reviews?.totalReviewOrderCount);

  const marketsRaw = asArr(getPath(card, 'companyMainMarket.descMarkets'));
  const topMarkets = marketsRaw
    .map((m) => {
      const mo = asObj(m);
      if (!mo) return null;
      const name = asStr(mo.name);
      if (!name) return null;
      const percent = firstNumber(asStr(mo.percentFormat) ?? null);
      const products = splitCsv(asStr(mo.products));
      return { market: name, percent, products };
    })
    .filter((m): m is { market: string; percent: number | null; products: string[] } => !!m);

  const revenueText = authValue(basic, 'totalExportRevenuePreYear');
  const floorText = authValue(basic, 'companyBuildingTotalLandSize');
  const linesText = authValue(basic, 'productionCapacityProductionLineNumber');
  const rankText = asStr(getPath(shop, 'factoryRank.value.rankInfo'));
  const rankUrl = asStr(getPath(shop, 'factoryRank.value.venueUrl'));

  const annualRevenueText = pickValue(ov?.companyTotalRevenue);
  const profile = {
    establishedYear: (() => {
      const n = asNum(pickValue(ov?.companyEstablishedYear));
      return n !== null ? Math.trunc(n) : null;
    })(),
    annualRevenue: annualRevenueText
      ? { value: annualRevenueText, kind: revenueKind(annualRevenueText) }
      : null,
    employees: pickValue(ov?.companyNumberOfEmployees),
    mainMarkets: splitCsv(pickValue(ov?.companyMainMarket)),
    paymentMethods: pickValue(ov?.supplierAcceptedPaymentType),
    deliveryTerms: pickValue(ov?.supplierAcceptedDeliveryTerms),
    contractManufacturing: asArr(asObj(ov?.supplierContractManufacturing)?.value)
      .map((x) => asStr(x))
      .filter((x): x is string => !!x),
    description: cleanText(pickValue(ov?.companyDescription)),
    advantageDescription: cleanText(pickValue(ov?.supplierAdvantageDescription)),
    capacityTags: asArr(ov?.capacityTags)
      .map((t) => asObj(t))
      .map((t) => asStr(t?.title) ?? asStr(t?.value))
      .filter((x): x is string => !!x),
    source: 'companyOverview',
  };

  const abilityTags = asArr(getPath(shop, 'companyAbilityTags.resultMapList'))
    .map((t) => asObj(t))
    .map((t) => asStr(t?.tagNameValue))
    .filter((x): x is string => !!x);

  const trust = {
    tradeAssurance: {
      enabled:
        pickBool(shop?.baoAccountIsDisplayAssurance) === true ||
        pickBool(card?.baoAccountIsDisplayAssurance) === true ||
        asBool(card?.hasTAOrderYear) === true,
      amountText: asStr(card?.baoAccountAmount),
      creditLevel: asNum(card?.baoAccountCreditLevel) !== null ? Math.trunc(asNum(card?.baoAccountCreditLevel) as number) : null,
      hasOrderYear: asBool(card?.hasTAOrderYear),
    },
    baseVerify: detailFlags.companyHasPassBaseVerify,
    onsiteAssessment: detailFlags.companyHasPassOnsite,
    assessedBy: assessmentCert,
    verifiedSupplier: membership.verifiedSupplier,
    verifiedPro: membership.verifiedPro,
  };

  const detail: SupplierDetail = {
    companyId,
    companyName,
    storeUrl,
    storeSubdomain: subdomain,
    logoUrl: logo,
    country,
    location,
    joinedYears,
    joinedYearsText,
    supplierIndex,
    membership,
    mainProducts,
    mainProductsText: mainProducts.length ? mainProducts.join(', ') : null,
    rating: {
      score: ratingScore,
      count: ratingCount !== null ? Math.trunc(ratingCount) : null,
    },
    businessType: {
      raw: businessTypeRaw,
      manufacturer: businessTypeRaw ? /manufacturer/i.test(businessTypeRaw) : null,
      tradingCompany: businessTypeRaw ? /trading\s*company/i.test(businessTypeRaw) : null,
    },
    staffText: asStr(getPath(card, 'companyNumberOfEmployees')) ?? null,
    factoryAreaText: floorText,
    transactionsText: revenueText,
    responseTime: asStr(card?.sesameReplyAvgTimeRange) ?? authValue(basic, 'responseTime'),
    capabilityTags: asArr(card?.tag).map((t) => asStr(t)).filter((x): x is string => !!x),
    rank: null,
    isAd: false,
    adType: null,
    position: 0,
    enriched: true,
    identity,
    profile,
    performance: {
      storeRating: {
        score: asNum(authValue(basic, 'storeScore')?.split('/')[0] ?? null),
        count: ratingCount !== null ? Math.trunc(ratingCount) : null,
      },
      onTimeDeliveryRate: authValue(basic, 'onTimeDeliveryRate'),
      responseTime: authValue(basic, 'responseTime'),
      responseRate: asStr(card?.supplierResponseRate),
      totalExportRevenueUSD: firstNumber(revenueText),
      totalExportRevenueText: revenueText,
      floorSpaceM2: firstNumber(floorText),
      floorSpaceText: floorText,
      productionLines: (() => {
        const n = firstNumber(linesText);
        return n !== null ? Math.trunc(n) : null;
      })(),
      factoryRank: rankText ? { text: rankText, url: rankUrl } : null,
      topMarkets,
    },
    capabilities: {
      customization: authNames(productionService),
      qualityControl: authNames(qualityAssurance),
      assessmentTags: abilityTags,
      serviceTags: [],
    },
    trust,
    fetchedAt: new Date().toISOString(),
    raw: {
      companyJoinYears: joinedYearsText,
      supplierStars: stars,
      supplierRating: asNum(card?.supplierRating),
      companyHasPassAssessment: detailFlags.companyHasPassAssessment,
      companyHasPassOnsite: detailFlags.companyHasPassOnsite,
      companyHasPassBaseVerify: detailFlags.companyHasPassBaseVerify,
      companyHasPassAV: detailFlags.companyHasPassAV,
      accountIsPaidMember: detailFlags.accountIsPaidMember,
      isGold: detailFlags.isGold,
      businessTypeRaw,
      identityKey: identity.key,
      assessmentCertCompany: assessmentCert,
      supplierIndexSource: 'shopSign.supplierStars',
    },
  };
  return detail;
}
