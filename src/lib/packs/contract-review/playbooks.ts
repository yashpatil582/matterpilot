/**
 * Playbook DSL — encodes a firm's negotiating position into a set of rules
 * the LLM applies clause-by-clause.
 *
 * Each playbook targets a contract archetype (Mutual NDA, MSA, SaaS).
 * Each rule applies to a clause type and declares what good looks like
 * (must / mustNot), what the redline should propose, and how severe a
 * violation is. The risk_level a clause carries comes from the rule it
 * violated (high > medium > low > clean).
 *
 * This file is the only place playbooks live in code today. In a real
 * deployment, they would be editable per-workspace via the admin UI — the
 * shape is stable JSON so a database-backed store is a straight swap later.
 */

export type ClauseType =
  | 'confidentiality'
  | 'term'
  | 'indemnity'
  | 'limitation_of_liability'
  | 'governing_law'
  | 'termination'
  | 'ip_assignment'
  | 'non_compete'
  | 'data_protection'
  | 'payment_terms'
  | 'other';

export type RiskLevel = 'low' | 'medium' | 'high';

export type PlaybookRule = {
  id: string;
  clauseType: ClauseType;
  description: string;
  must: string[];
  mustNot: string[];
  expectedKeywords: string[];
  suggestedRedline: string;
  severity: RiskLevel;
};

export type Playbook = {
  id: string;
  name: string;
  description: string;
  applicableClauseTypes: ClauseType[];
  rules: PlaybookRule[];
};

export const MUTUAL_NDA: Playbook = {
  id: 'mutual-nda',
  name: 'Mutual NDA',
  description: 'Symmetric NDA — both parties exchange confidential information and bear equal obligations.',
  applicableClauseTypes: ['confidentiality', 'term', 'ip_assignment', 'governing_law'],
  rules: [
    {
      id: 'nda-mutual-confidentiality',
      clauseType: 'confidentiality',
      description: 'Confidentiality obligations must apply to both parties symmetrically.',
      must: ['mutual', 'each party', 'both parties'],
      mustNot: ['one-way', 'unilateral', 'discloser shall'],
      expectedKeywords: ['confidential information', 'non-disclosure', 'shall not disclose'],
      suggestedRedline:
        'Replace asymmetric language with: "Each party agrees to hold the other party\'s Confidential Information in strict confidence."',
      severity: 'high',
    },
    {
      id: 'nda-bounded-term',
      clauseType: 'term',
      description: 'Confidentiality term should be bounded (2–5 years), not perpetual.',
      must: ['years', 'expire', 'terminate'],
      mustNot: ['perpetual', 'in perpetuity', 'indefinitely'],
      expectedKeywords: ['term', 'duration', 'period'],
      suggestedRedline:
        'Cap the obligation: "Confidentiality obligations shall survive for three (3) years after termination of this Agreement."',
      severity: 'medium',
    },
    {
      id: 'nda-no-ip-grant',
      clauseType: 'ip_assignment',
      description: 'NDA must not assign or grant IP rights; it merely protects info.',
      must: [],
      mustNot: ['assign', 'transfer', 'grant', 'license to use'],
      expectedKeywords: ['intellectual property', 'ownership', 'rights'],
      suggestedRedline:
        'Strike any IP assignment language. Add: "Nothing in this Agreement transfers ownership or grants any license to either party\'s intellectual property."',
      severity: 'high',
    },
    {
      id: 'nda-acceptable-governing-law',
      clauseType: 'governing_law',
      description: 'Governing law should be a neutral or firm-friendly jurisdiction.',
      must: ['New York', 'Delaware', 'California'],
      mustNot: [],
      expectedKeywords: ['governed by', 'laws of', 'jurisdiction'],
      suggestedRedline:
        'Propose: "This Agreement shall be governed by the laws of the State of New York, without regard to its conflict of laws principles."',
      severity: 'low',
    },
  ],
};

export const MSA: Playbook = {
  id: 'msa',
  name: 'Master Services Agreement',
  description: 'Standard B2B services agreement covering scope, fees, indemnity, liability, and termination.',
  applicableClauseTypes: [
    'limitation_of_liability',
    'indemnity',
    'termination',
    'payment_terms',
    'governing_law',
    'ip_assignment',
    'confidentiality',
  ],
  rules: [
    {
      id: 'msa-liability-cap',
      clauseType: 'limitation_of_liability',
      description: 'Liability must be capped — fees paid in the prior 12 months is the standard.',
      must: ['cap', 'limited', 'shall not exceed'],
      mustNot: ['unlimited', 'no limitation', 'without limitation as to amount'],
      expectedKeywords: ['liability', 'damages', 'limitation'],
      suggestedRedline:
        'Cap aggregate liability: "Each party\'s total liability arising out of this Agreement shall not exceed the fees paid by Client to Vendor in the twelve (12) months preceding the claim."',
      severity: 'high',
    },
    {
      id: 'msa-mutual-indemnity',
      clauseType: 'indemnity',
      description: 'Indemnity should be mutual, with carve-outs for gross negligence and willful misconduct.',
      must: ['each party', 'mutual', 'gross negligence', 'willful misconduct'],
      mustNot: ['client shall indemnify and hold harmless vendor for any and all'],
      expectedKeywords: ['indemnify', 'defend', 'hold harmless'],
      suggestedRedline:
        'Make indemnity mutual: "Each party shall indemnify the other against third-party claims arising from the indemnifying party\'s gross negligence or willful misconduct."',
      severity: 'high',
    },
    {
      id: 'msa-termination-for-convenience',
      clauseType: 'termination',
      description: 'Both parties should be able to terminate for convenience with 30 days notice.',
      must: ['for convenience', '30 days', 'thirty (30) days', 'written notice'],
      mustNot: ['no termination', 'irrevocable', 'cannot be terminated'],
      expectedKeywords: ['terminate', 'termination', 'notice'],
      suggestedRedline:
        'Add convenience termination: "Either party may terminate this Agreement for convenience upon thirty (30) days\' prior written notice to the other party."',
      severity: 'medium',
    },
    {
      id: 'msa-payment-net-30',
      clauseType: 'payment_terms',
      description: 'Payment terms must not exceed Net-30 without justification.',
      must: ['Net 30', 'thirty (30) days', '30 days'],
      mustNot: ['Net 60', 'Net 90', 'sixty (60) days', 'ninety (90) days'],
      expectedKeywords: ['payment', 'invoice', 'due', 'days'],
      suggestedRedline:
        'Tighten to Net-30: "Vendor shall invoice Client monthly; Client shall pay each undisputed invoice within thirty (30) days of receipt."',
      severity: 'medium',
    },
  ],
};

export const SERVICE_AGREEMENT: Playbook = {
  id: 'service-agreement',
  name: 'Standard Service Agreement',
  description: 'Lightweight services agreement for short-engagement vendors.',
  applicableClauseTypes: ['term', 'termination', 'governing_law', 'limitation_of_liability'],
  rules: [
    {
      id: 'svc-no-auto-renewal-trap',
      clauseType: 'term',
      description: 'Auto-renewal must provide a 30+ day opt-out window before each renewal.',
      must: ['30 days', 'thirty (30) days', 'opt out', 'non-renewal'],
      mustNot: ['automatically renew without notice'],
      expectedKeywords: ['term', 'renewal', 'auto-renew'],
      suggestedRedline:
        'Add opt-out: "This Agreement may auto-renew for successive one-year terms unless either party gives written notice of non-renewal at least thirty (30) days before the end of the then-current term."',
      severity: 'medium',
    },
    {
      id: 'svc-bounded-liability',
      clauseType: 'limitation_of_liability',
      description: 'Total liability must be capped at fees paid.',
      must: ['cap', 'limited', 'shall not exceed', 'fees paid'],
      mustNot: ['unlimited liability'],
      expectedKeywords: ['liability', 'damages'],
      suggestedRedline:
        'Cap liability at fees paid: "Vendor\'s total liability shall not exceed the fees paid by Client under this Agreement."',
      severity: 'high',
    },
  ],
};

export const PLAYBOOKS: readonly Playbook[] = [MUTUAL_NDA, MSA, SERVICE_AGREEMENT];

const PLAYBOOK_BY_ID = new Map(PLAYBOOKS.map((p) => [p.id, p]));

export function getPlaybook(id: string): Playbook | undefined {
  return PLAYBOOK_BY_ID.get(id);
}

export function listPlaybooks(): readonly Playbook[] {
  return PLAYBOOKS;
}
