/**
 * Ground-truth labels for the Pack 2 contract fixtures.
 *
 * For each fixture we record what playbook applies, which clauses a careful
 * attorney would expect the model to extract, and what risk level + matched
 * playbook rule each should carry.
 *
 * Match semantics (used by eval/contracts/run.ts):
 *   - clauseType: enum match
 *   - matchedRuleId: exact string match (null means "no rule applied")
 *   - riskLevel: exact enum match
 *
 * Observed clauses are paired to expected by (clauseType, matchedRuleId).
 * Unmatched expected entries are false negatives; unmatched observed
 * entries beyond the expected count are false positives.
 */

import type { ClauseType, RiskLevel } from '@/lib/packs/contract-review/schema';

export type ExpectedClause = {
  clauseType: ClauseType;
  matchedRuleId: string | null;
  riskLevel: RiskLevel;
};

export type ContractLabel = {
  expectedPlaybookId: 'mutual-nda' | 'msa' | 'service-agreement';
  expectedClauses: ExpectedClause[];
  expectedReviewStatus: 'needs_review' | 'auto_approved' | 'rejected';
  expectedFlaggedCount: number; // count of clauses with risk medium or high
};

export const CONTRACT_LABELS: Record<string, ContractLabel> = {
  'mutual-nda-clean': {
    expectedPlaybookId: 'mutual-nda',
    expectedReviewStatus: 'auto_approved',
    expectedFlaggedCount: 0,
    expectedClauses: [
      { clauseType: 'confidentiality', matchedRuleId: 'nda-mutual-confidentiality', riskLevel: 'low' },
      { clauseType: 'term', matchedRuleId: 'nda-bounded-term', riskLevel: 'low' },
      { clauseType: 'ip_assignment', matchedRuleId: 'nda-no-ip-grant', riskLevel: 'low' },
      { clauseType: 'governing_law', matchedRuleId: 'nda-acceptable-governing-law', riskLevel: 'low' },
    ],
  },

  'one-way-nda-bad': {
    expectedPlaybookId: 'mutual-nda',
    expectedReviewStatus: 'needs_review',
    expectedFlaggedCount: 4,
    expectedClauses: [
      { clauseType: 'confidentiality', matchedRuleId: 'nda-mutual-confidentiality', riskLevel: 'high' },
      { clauseType: 'term', matchedRuleId: 'nda-bounded-term', riskLevel: 'high' },
      { clauseType: 'ip_assignment', matchedRuleId: 'nda-no-ip-grant', riskLevel: 'high' },
      { clauseType: 'governing_law', matchedRuleId: 'nda-acceptable-governing-law', riskLevel: 'high' },
    ],
  },

  'msa-vendor-friendly': {
    expectedPlaybookId: 'msa',
    expectedReviewStatus: 'needs_review',
    expectedFlaggedCount: 4,
    expectedClauses: [
      { clauseType: 'limitation_of_liability', matchedRuleId: 'msa-liability-cap', riskLevel: 'high' },
      { clauseType: 'indemnity', matchedRuleId: 'msa-mutual-indemnity', riskLevel: 'high' },
      { clauseType: 'termination', matchedRuleId: 'msa-termination-for-convenience', riskLevel: 'high' },
      { clauseType: 'payment_terms', matchedRuleId: 'msa-payment-net-30', riskLevel: 'medium' },
    ],
  },

  'msa-clean': {
    expectedPlaybookId: 'msa',
    expectedReviewStatus: 'auto_approved',
    expectedFlaggedCount: 0,
    expectedClauses: [
      { clauseType: 'limitation_of_liability', matchedRuleId: 'msa-liability-cap', riskLevel: 'low' },
      { clauseType: 'indemnity', matchedRuleId: 'msa-mutual-indemnity', riskLevel: 'low' },
      { clauseType: 'termination', matchedRuleId: 'msa-termination-for-convenience', riskLevel: 'low' },
      { clauseType: 'payment_terms', matchedRuleId: 'msa-payment-net-30', riskLevel: 'low' },
    ],
  },

  'msa-balanced': {
    expectedPlaybookId: 'msa',
    expectedReviewStatus: 'needs_review',
    expectedFlaggedCount: 2,
    expectedClauses: [
      { clauseType: 'limitation_of_liability', matchedRuleId: 'msa-liability-cap', riskLevel: 'low' },
      { clauseType: 'indemnity', matchedRuleId: 'msa-mutual-indemnity', riskLevel: 'medium' },
      { clauseType: 'termination', matchedRuleId: 'msa-termination-for-convenience', riskLevel: 'low' },
      { clauseType: 'payment_terms', matchedRuleId: 'msa-payment-net-30', riskLevel: 'high' },
    ],
  },

  'nda-mixed': {
    expectedPlaybookId: 'mutual-nda',
    expectedReviewStatus: 'needs_review',
    expectedFlaggedCount: 2,
    expectedClauses: [
      { clauseType: 'confidentiality', matchedRuleId: 'nda-mutual-confidentiality', riskLevel: 'low' },
      { clauseType: 'term', matchedRuleId: 'nda-bounded-term', riskLevel: 'high' },
      { clauseType: 'ip_assignment', matchedRuleId: 'nda-no-ip-grant', riskLevel: 'medium' },
      { clauseType: 'governing_law', matchedRuleId: 'nda-acceptable-governing-law', riskLevel: 'low' },
    ],
  },

  'service-clean': {
    expectedPlaybookId: 'service-agreement',
    expectedReviewStatus: 'auto_approved',
    expectedFlaggedCount: 0,
    expectedClauses: [
      { clauseType: 'term', matchedRuleId: 'svc-no-auto-renewal-trap', riskLevel: 'low' },
      { clauseType: 'limitation_of_liability', matchedRuleId: 'svc-bounded-liability', riskLevel: 'low' },
    ],
  },

  'service-bad': {
    expectedPlaybookId: 'service-agreement',
    expectedReviewStatus: 'needs_review',
    expectedFlaggedCount: 2,
    expectedClauses: [
      { clauseType: 'term', matchedRuleId: 'svc-no-auto-renewal-trap', riskLevel: 'medium' },
      { clauseType: 'limitation_of_liability', matchedRuleId: 'svc-bounded-liability', riskLevel: 'high' },
    ],
  },
};
