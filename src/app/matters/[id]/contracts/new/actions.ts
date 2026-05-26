'use server';

import { and, eq } from 'drizzle-orm';
import { put } from '@vercel/blob';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { db, schema } from '@/db';
import { extractPdfText } from '@/lib/parsing';
import { runWorkflow } from '@/lib/workflow/engine';
import { contractReviewPack } from '@/lib/packs/contract-review';
import { getPlaybook } from '@/lib/packs/contract-review/playbooks';
import { indexDocument } from '@/lib/rag/index';
import { requireRole, toPackContext } from '@/lib/workspace/context';

export type UploadResult = { ok: false; error: string };

const MAX_BYTES = 10 * 1024 * 1024;

async function readContractText(file: File, buffer: ArrayBuffer): Promise<string> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.txt') || file.type === 'text/plain') {
    return new TextDecoder('utf-8').decode(buffer);
  }
  const { text } = await extractPdfText(buffer);
  return text;
}

async function ensureMatterInWorkspace(workspaceId: string, matterId: string) {
  const [m] = await db
    .select({ id: schema.matters.id })
    .from(schema.matters)
    .where(
      and(eq(schema.matters.id, matterId), eq(schema.matters.workspaceId, workspaceId)),
    )
    .limit(1);
  return m ?? null;
}

export async function uploadContract(
  matterId: string,
  _prev: UploadResult | null,
  formData: FormData,
): Promise<UploadResult> {
  const ctx = await requireRole(['admin', 'attorney', 'paralegal']);

  const matter = await ensureMatterInWorkspace(ctx.workspaceId, matterId);
  if (!matter) return { ok: false, error: 'Matter not found in this workspace.' };

  const playbookId = String(formData.get('playbookId') ?? '').trim();
  if (!playbookId) return { ok: false, error: 'Select a playbook.' };
  if (!getPlaybook(playbookId))
    return { ok: false, error: `Unknown playbook: ${playbookId}` };

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: 'Select a PDF or .txt contract.' };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, error: 'Max upload size is 10MB.' };
  }
  const lowerName = file.name.toLowerCase();
  const isPdf = file.type === 'application/pdf' || lowerName.endsWith('.pdf');
  const isTxt = file.type === 'text/plain' || lowerName.endsWith('.txt');
  if (!isPdf && !isTxt) {
    return { ok: false, error: 'Only PDF or .txt files are supported.' };
  }

  let outcomeDocumentId: string;
  try {
    const buffer = await file.arrayBuffer();
    const blob = await put(`contracts/${Date.now()}-${file.name}`, file, {
      access: 'private',
      addRandomSuffix: true,
    });
    const text = await readContractText(file, buffer);

    const outcome = await runWorkflow(
      contractReviewPack,
      {
        text,
        rawFileUrl: blob.url,
        fileName: file.name,
        playbookId,
        matterId,
      },
      toPackContext(ctx, { matterId }),
    );
    outcomeDocumentId = outcome.documentId;

    // Best-effort matter-scoped RAG indexing. Embeddings are optional —
    // if OPENAI_API_KEY isn't set the call no-ops. Failures here must not
    // break the upload flow; the contract is already persisted.
    try {
      await indexDocument({
        workspaceId: ctx.workspaceId,
        matterId,
        documentId: outcome.documentId,
        text,
      });
    } catch (e) {
      console.warn('RAG indexing failed (non-fatal):', e instanceof Error ? e.message : e);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error during upload';
    console.error('Contract upload failed:', err);
    return { ok: false, error: message };
  }

  revalidatePath(`/matters/${matterId}`);
  redirect(`/matters/${matterId}/contracts/${outcomeDocumentId}`);
}
