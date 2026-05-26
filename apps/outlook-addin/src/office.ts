/**
 * Office.js helpers narrowed to what the Outlook task pane uses.
 *
 * Each helper guards on the Office host being present so the React app
 * can run in a plain browser tab for fast UI iteration without throwing.
 */

export type ItemSnapshot = {
  subject: string;
  bodyText: string;
  attachments: AttachmentMeta[];
};

export type AttachmentMeta = {
  id: string;
  name: string;
  size: number;
  contentType: string;
  attachmentType: string;
};

function getItem(): Office.MessageRead | Office.AppointmentRead | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mailbox = (Office?.context as any)?.mailbox;
  return (mailbox?.item ?? null) as Office.MessageRead | Office.AppointmentRead | null;
}

export function readSubject(): string {
  const item = getItem();
  return item?.subject ?? '';
}

export async function readBodyText(): Promise<string> {
  const item = getItem();
  if (!item) return '';
  return new Promise((resolve, reject) => {
    item.body.getAsync(Office.CoercionType.Text, (result) => {
      if (result.status === Office.AsyncResultStatus.Succeeded) {
        resolve(result.value ?? '');
      } else {
        reject(new Error(result.error?.message ?? 'body.getAsync failed'));
      }
    });
  });
}

export async function readAttachments(): Promise<AttachmentMeta[]> {
  const item = getItem();
  if (!item || !('attachments' in item)) return [];
  return ((item.attachments ?? []) as Office.AttachmentDetails[]).map((a) => ({
    id: a.id,
    name: a.name,
    size: a.size,
    contentType: a.contentType,
    attachmentType: a.attachmentType,
  }));
}

/**
 * Pull a single attachment's bytes via the Office EWS getAttachmentContentAsync
 * API. Returns base64-encoded bytes — the API gives them to us that way and
 * the server route accepts them in that shape.
 */
export async function readAttachmentBase64(attachmentId: string): Promise<string> {
  const item = getItem();
  if (!item || typeof item.getAttachmentContentAsync !== 'function') {
    throw new Error('Attachments unavailable on this item');
  }
  return new Promise((resolve, reject) => {
    item.getAttachmentContentAsync(attachmentId, (result) => {
      if (result.status === Office.AsyncResultStatus.Succeeded) {
        // result.value.format is Office.MailboxEnums.AttachmentContentFormat
        // — Base64 in practice for binary attachments. ICAL / URL formats are
        // edge cases we skip.
        const value = result.value;
        if (value.format === Office.MailboxEnums.AttachmentContentFormat.Base64) {
          resolve(value.content);
        } else {
          reject(new Error(`Unsupported attachment format: ${value.format}`));
        }
      } else {
        reject(new Error(result.error?.message ?? 'getAttachmentContentAsync failed'));
      }
    });
  });
}

export async function readItemSnapshot(): Promise<ItemSnapshot> {
  const [subject, bodyText, attachments] = await Promise.all([
    Promise.resolve(readSubject()),
    readBodyText(),
    readAttachments(),
  ]);
  return { subject, bodyText, attachments };
}
