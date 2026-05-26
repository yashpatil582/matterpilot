/**
 * Shared enum value tuples for Pack 2.
 *
 * Single source of truth for the enums that appear in both the LLM tool
 * schema and the Drizzle pgEnum columns. Keeping them as TS `const` arrays
 * lets Zod + JSON-Schema + drizzle all reference the same list.
 */

export const CLAUSE_TYPE_VALUES = [
  'confidentiality',
  'term',
  'indemnity',
  'limitation_of_liability',
  'governing_law',
  'termination',
  'ip_assignment',
  'non_compete',
  'data_protection',
  'payment_terms',
  'other',
] as const;

export const RISK_LEVEL_VALUES = ['low', 'medium', 'high'] as const;

export const REVIEW_STATUS_VALUES = [
  'analyzing',
  'needs_review',
  'auto_approved',
  'rejected',
] as const;

export type ClauseType = (typeof CLAUSE_TYPE_VALUES)[number];
export type RiskLevel = (typeof RISK_LEVEL_VALUES)[number];
export type ReviewStatus = (typeof REVIEW_STATUS_VALUES)[number];
