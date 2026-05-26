'use server';

import { put } from '@vercel/blob';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { extractPdfText } from '@/lib/parsing';
import { runWorkflow } from '@/lib/workflow/engine';
import { courtNoticePack } from '@/lib/packs/court-notice';
import { requireWorkspaceCtx, toPackContext } from '@/lib/workspace/context';

export type UploadResult = { ok: false; error: string };

export async function uploadNotice(_prev: UploadResult | null, formData: FormData): Promise<UploadResult> {
  const ctx = await requireWorkspaceCtx();

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: 'Select a PDF to upload.' };
  }
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    return { ok: false, error: 'Only PDF files are supported in v1.' };
  }
  if (file.size > 10 * 1024 * 1024) {
    return { ok: false, error: 'Max upload size is 10MB.' };
  }

  try {
    const buffer = await file.arrayBuffer();

    const blob = await put(`notices/${Date.now()}-${file.name}`, file, {
      access: 'private',
      addRandomSuffix: true,
    });

    const { text } = await extractPdfText(buffer);

    await runWorkflow(courtNoticePack, {
      text,
      rawFileUrl: blob.url,
      // Forwarded-email PDFs carry the original sender in a "From:" header
      // (this is how paralegals route them to the firm inbox). If present,
      // feed it to the deterministic sender allowlist; otherwise leave null
      // and let the link-host check carry the trust signal.
      senderEmail: extractFromHeader(text),
    }, toPackContext(ctx));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error during upload';
    console.error('Upload failed:', err);
    return { ok: false, error: message };
  }

  revalidatePath('/');
  redirect('/');
}

function extractFromHeader(text: string): string | null {
  const m = text.match(/^From:\s*(.+)$/im);
  if (!m) return null;
  // The line may contain a name + angle-bracket email; pull just the address.
  const addr = m[1].match(/<([^>]+)>/);
  return (addr ? addr[1] : m[1]).trim() || null;
}
