/**
 * 会员体系与识别结果（归一化枚举 + 证据）
 *
 * 规则见 docs/05-会员体系与识别规则.md；判定优先级：
 *   verified_pro > verified_supplier > gold_supplier > unknown
 */
import { z } from 'zod';
import { MembershipPlanSchema } from './common.js';

export const MembershipEvidenceSchema = z
  .object({
    source: z.enum(['list', 'detail', 'merged']),
    fields: z.record(z.string(), z.unknown()).default({}),
  })
  .meta({ id: 'MembershipEvidence' });

export const MembershipSchema = z
  .object({
    plan: MembershipPlanSchema,
    label: z.string(),
    rank: z.number().int().min(0).max(3),
    verifiedSupplier: z.boolean().default(false),
    verifiedPro: z.boolean().default(false),
    paidMember: z.boolean().nullable().default(null),
    goldSupplier: z.boolean().nullable().default(null),
    onsiteAssessment: z.boolean().nullable().default(null),
    baseVerify: z.boolean().nullable().default(null),
    assessedBy: z.string().nullable().default(null),
    goldYears: z.number().int().nullable().default(null),
    evidence: MembershipEvidenceSchema,
  })
  .meta({ id: 'Membership' });

export type Membership = z.infer<typeof MembershipSchema>;

export const MembershipPlanInfoSchema = z
  .object({
    code: MembershipPlanSchema,
    labelEn: z.string(),
    labelZh: z.string(),
    rank: z.number().int().min(0).max(3),
    description: z.string(),
  })
  .meta({ id: 'MembershipPlanInfo' });

export const MembershipRuleSchema = z
  .object({
    if: z.string(),
    then: z.string(),
    confidence: z.enum(['high', 'medium', 'low']),
    source: z.enum(['list', 'detail']),
  })
  .meta({ id: 'MembershipRule' });

export const MembershipCatalogSchema = z
  .object({
    plans: z.array(MembershipPlanInfoSchema),
    rules: z.array(MembershipRuleSchema),
    supplierIndex: z
      .object({
        field: z.string(),
        range: z.tuple([z.number(), z.number()]),
        label: z.string(),
        note: z.string(),
      })
      .meta({ id: 'SupplierIndexInfo' }),
    storeRating: z
      .object({
        field: z.string(),
        range: z.tuple([z.number(), z.number()]),
        label: z.string(),
      })
      .meta({ id: 'StoreRatingInfo' }),
    cautions: z.array(z.string()),
  })
  .meta({ id: 'MembershipCatalog' });

export type MembershipPlanInfo = z.infer<typeof MembershipPlanInfoSchema>;
export type MembershipCatalog = z.infer<typeof MembershipCatalogSchema>;
