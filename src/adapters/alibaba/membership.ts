/**
 * 会员识别（list + detail 合并，输出枚举 + 证据）
 *
 * 规则见 docs/05-会员体系与识别规则.md 与 docs/02-接口草案.md §3.3：
 *   verified_pro > verified_supplier > gold_supplier > unknown
 * 注意：isGold 不作主判据；companyHasPassOnsite ≠ 金品。
 */
import type { Membership } from '../../domain/membership.js';
import { parseYears } from '../../domain/common.js';

const LABEL: Record<Membership['plan'], string> = {
  verified_pro: 'Verified Pro Supplier',
  verified_supplier: 'Verified Supplier',
  gold_supplier: 'Gold Supplier',
  unknown: 'Unknown',
};

const RANK: Record<Membership['plan'], number> = {
  verified_pro: 3,
  verified_supplier: 2,
  gold_supplier: 1,
  unknown: 0,
};

export interface ListMembershipInput {
  verifiedSupplierPro?: boolean | null;
  isAssessedSupplier?: boolean | null;
  goldYearsText?: string | null;
}

export interface DetailMembershipInput {
  companyHasPassAssessment?: boolean | null;
  companyHasPassOnsite?: boolean | null;
  companyHasPassBaseVerify?: boolean | null;
  companyHasPassAV?: boolean | null;
  accountIsPaidMember?: boolean | null;
  isGold?: boolean | null;
  isNewGolden?: boolean | null;
  assessmentCertCompany?: string | null;
  goldYearsText?: string | null;
}

export interface ClassifyInput {
  list?: ListMembershipInput | null;
  detail?: DetailMembershipInput | null;
}

export function classifyMembership(input: ClassifyInput): Membership {
  const list = input.list ?? null;
  const detail = input.detail ?? null;
  const goldYears =
    parseYears(detail?.goldYearsText ?? null) ?? parseYears(list?.goldYearsText ?? null);
  const verifiedPro = list?.verifiedSupplierPro === true;
  const assessed =
    list?.isAssessedSupplier === true || detail?.companyHasPassAssessment === true;
  const paidMember = detail?.accountIsPaidMember ?? null;
  const goldSupplier = detail?.isGold ?? null;

  let plan: Membership['plan'] = 'unknown';
  if (verifiedPro) plan = 'verified_pro';
  else if (assessed) plan = 'verified_supplier';
  else if (paidMember === true) plan = 'gold_supplier';
  else if ((goldYears ?? 0) > 0) plan = 'gold_supplier';
  else if (goldSupplier === true) plan = 'gold_supplier';

  const evidenceFields: Record<string, unknown> = {};
  if (list) {
    if (list.verifiedSupplierPro !== undefined) evidenceFields.verifiedSupplierPro = list.verifiedSupplierPro;
    if (list.isAssessedSupplier !== undefined) evidenceFields.isAssessedSupplier = list.isAssessedSupplier;
    if (list.goldYearsText) evidenceFields.goldYearsText = list.goldYearsText;
  }
  if (detail) {
    if (detail.companyHasPassAssessment !== undefined) evidenceFields.companyHasPassAssessment = detail.companyHasPassAssessment;
    if (detail.companyHasPassOnsite !== undefined) evidenceFields.companyHasPassOnsite = detail.companyHasPassOnsite;
    if (detail.companyHasPassBaseVerify !== undefined) evidenceFields.companyHasPassBaseVerify = detail.companyHasPassBaseVerify;
    if (detail.companyHasPassAV !== undefined) evidenceFields.companyHasPassAV = detail.companyHasPassAV;
    if (detail.accountIsPaidMember !== undefined) evidenceFields.accountIsPaidMember = detail.accountIsPaidMember;
    if (detail.isGold !== undefined) evidenceFields.isGold = detail.isGold;
    if (detail.assessmentCertCompany) evidenceFields.assessmentCertCompany = detail.assessmentCertCompany;
  }

  return {
    plan,
    label: LABEL[plan],
    rank: RANK[plan],
    verifiedSupplier: assessed,
    verifiedPro,
    paidMember,
    goldSupplier,
    onsiteAssessment: detail?.companyHasPassOnsite ?? null,
    baseVerify: detail?.companyHasPassBaseVerify ?? null,
    assessedBy: detail?.assessmentCertCompany ?? null,
    goldYears,
    evidence: {
      source: detail ? (list ? 'merged' : 'detail') : 'list',
      fields: evidenceFields,
    },
  };
}
