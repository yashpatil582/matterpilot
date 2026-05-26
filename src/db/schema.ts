import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  jsonb,
  real,
  boolean,
  pgEnum,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const noticeStatusEnum = pgEnum('notice_status', [
  'received',
  'parsing',
  'needs_review',
  'routed',
  'suspicious',
  'failed',
]);

export const noticeTypeEnum = pgEnum('notice_type', [
  'meeting_341',
  'deficiency',
  'motion_to_dismiss',
  'discharge',
  'relief_from_stay',
  'claim_deadline',
  'unknown',
]);

export const noticeSourceEnum = pgEnum('notice_source', ['pdf', 'email']);
export const taskStatusEnum = pgEnum('task_status', ['open', 'in_progress', 'done', 'cancelled']);
export const senderTrustEnum = pgEnum('sender_trust', ['allow', 'flag', 'block']);
export const memberRoleEnum = pgEnum('member_role', ['paralegal', 'attorney', 'admin']);
export const retentionPolicyEnum = pgEnum('retention_policy', ['30d', '90d', '1y', '7y', 'forever']);
export const matterStatusEnum = pgEnum('matter_status', ['open', 'on_hold', 'closed']);

export const clauseTypeEnum = pgEnum('clause_type', [
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
]);
export const riskLevelEnum = pgEnum('risk_level', ['low', 'medium', 'high']);
export const reviewStatusEnum = pgEnum('review_status', [
  'analyzing',
  'needs_review',
  'auto_approved',
  'rejected',
]);

export const workspaces = pgTable('workspaces', {
  id: uuid('id').defaultRandom().primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const matters = pgTable(
  'matters',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    caseId: uuid('case_id').references(() => cases.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    clientName: text('client_name'),
    status: matterStatusEnum('status').notNull().default('open'),
    retentionPolicy: retentionPolicyEnum('retention_policy').notNull().default('7y'),
    legalHold: boolean('legal_hold').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('matters_workspace_idx').on(t.workspaceId)],
);

export const documents = pgTable(
  'documents',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    matterId: uuid('matter_id').references(() => matters.id, { onDelete: 'set null' }),
    kind: text('kind').notNull(),
    sourceConnector: text('source_connector'),
    sourceRef: text('source_ref'),
    blobUrl: text('blob_url'),
    name: text('name'),
    mimeType: text('mime_type'),
    bytes: integer('bytes'),
    legalHold: boolean('legal_hold').notNull().default(false),
    retentionPolicy: retentionPolicyEnum('retention_policy'),
    playbookId: text('playbook_id'),
    reviewStatus: reviewStatusEnum('review_status'),
    flaggedClauseCount: integer('flagged_clause_count'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('documents_workspace_idx').on(t.workspaceId),
    index('documents_matter_idx').on(t.matterId),
  ],
);

export const contractClauses = pgTable(
  'contract_clauses',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    matterId: uuid('matter_id').references(() => matters.id, { onDelete: 'set null' }),
    documentId: uuid('document_id')
      .references(() => documents.id, { onDelete: 'cascade' })
      .notNull(),
    ordinal: integer('ordinal').notNull(),
    clauseType: clauseTypeEnum('clause_type').notNull(),
    text: text('text').notNull(),
    startOffset: integer('start_offset'),
    endOffset: integer('end_offset'),
    confidence: real('confidence'),
    riskLevel: riskLevelEnum('risk_level').notNull(),
    matchedPlaybookRuleId: text('matched_playbook_rule_id'),
    redlineSuggestion: text('redline_suggestion'),
    reasoning: text('reasoning'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('contract_clauses_workspace_idx').on(t.workspaceId),
    index('contract_clauses_document_idx').on(t.documentId),
    index('contract_clauses_risk_idx').on(t.riskLevel),
  ],
);

export const cases = pgTable(
  'cases',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    caseNumber: text('case_number').notNull().unique(),
    debtorName: text('debtor_name'),
    district: text('district'),
    chapter: integer('chapter'),
    filedAt: timestamp('filed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('cases_debtor_name_idx').on(t.debtorName),
    index('cases_workspace_idx').on(t.workspaceId),
  ],
);

export const notices = pgTable(
  'notices',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    matterId: uuid('matter_id').references(() => matters.id, { onDelete: 'set null' }),
    caseId: uuid('case_id').references(() => cases.id, { onDelete: 'set null' }),
    source: noticeSourceEnum('source').notNull(),
    type: noticeTypeEnum('type'),
    status: noticeStatusEnum('status').notNull().default('received'),
    rawText: text('raw_text'),
    rawFileUrl: text('raw_file_url'),
    senderEmail: text('sender_email'),
    senderDomain: text('sender_domain'),
    confidence: real('confidence'),
    classificationReasoning: text('classification_reasoning'),
    receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('notices_status_idx').on(t.status),
    index('notices_received_at_idx').on(t.receivedAt),
    index('notices_workspace_idx').on(t.workspaceId),
    index('notices_matter_idx').on(t.matterId),
  ],
);

export const parseRuns = pgTable('parse_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
  noticeId: uuid('notice_id')
    .references(() => notices.id, { onDelete: 'cascade' })
    .notNull(),
  model: text('model').notNull(),
  stage: text('stage').notNull(),
  prompt: text('prompt'),
  rawOutput: jsonb('raw_output'),
  durationMs: integer('duration_ms'),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  costUsd: real('cost_usd'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const extractedEvents = pgTable('extracted_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
  noticeId: uuid('notice_id')
    .references(() => notices.id, { onDelete: 'cascade' })
    .notNull(),
  type: noticeTypeEnum('type').notNull(),
  hearingAt: timestamp('hearing_at', { withTimezone: true }),
  courtroom: text('courtroom'),
  virtualUrl: text('virtual_url'),
  trustee: text('trustee'),
  judge: text('judge'),
  deadline: timestamp('deadline', { withTimezone: true }),
  docketSummary: text('docket_summary'),
  fieldConfidences: jsonb('field_confidences'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const tasks = pgTable('tasks', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
  matterId: uuid('matter_id').references(() => matters.id, { onDelete: 'set null' }),
  caseId: uuid('case_id').references(() => cases.id, { onDelete: 'set null' }),
  noticeId: uuid('notice_id').references(() => notices.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  description: text('description'),
  dueAt: timestamp('due_at', { withTimezone: true }),
  assignee: text('assignee'),
  status: taskStatusEnum('status').notNull().default('open'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const reviewDecisions = pgTable('review_decisions', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
  noticeId: uuid('notice_id')
    .references(() => notices.id, { onDelete: 'cascade' })
    .notNull(),
  reviewerEmail: text('reviewer_email').notNull(),
  fieldChanges: jsonb('field_changes'),
  notes: text('notes'),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }).defaultNow().notNull(),
});

export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    entity: text('entity').notNull(),
    entityId: uuid('entity_id').notNull(),
    actor: text('actor').notNull(),
    action: text('action').notNull(),
    before: jsonb('before'),
    after: jsonb('after'),
    at: timestamp('at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('audit_entity_idx').on(t.entity, t.entityId),
    index('audit_workspace_idx').on(t.workspaceId),
  ],
);

export const senderPolicies = pgTable(
  'sender_policies',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    domain: text('domain').notNull(),
    trustLevel: senderTrustEnum('trust_level').notNull(),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('sender_policies_workspace_domain_idx').on(t.workspaceId, t.domain)],
);

export const workspaceMembers = pgTable(
  'workspace_members',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    name: text('name'),
    role: memberRoleEnum('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('workspace_members_workspace_email_idx').on(t.workspaceId, t.email)],
);

export type Workspace = typeof workspaces.$inferSelect;
export type NewWorkspace = typeof workspaces.$inferInsert;
export type Matter = typeof matters.$inferSelect;
export type NewMatter = typeof matters.$inferInsert;
export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type ContractClause = typeof contractClauses.$inferSelect;
export type NewContractClause = typeof contractClauses.$inferInsert;
export type Case = typeof cases.$inferSelect;
export type NewCase = typeof cases.$inferInsert;
export type Notice = typeof notices.$inferSelect;
export type NewNotice = typeof notices.$inferInsert;
export type ParseRun = typeof parseRuns.$inferSelect;
export type ExtractedEvent = typeof extractedEvents.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type ReviewDecision = typeof reviewDecisions.$inferSelect;
export type AuditEvent = typeof auditEvents.$inferSelect;
export type WorkspaceMember = typeof workspaceMembers.$inferSelect;
export type NewWorkspaceMember = typeof workspaceMembers.$inferInsert;
