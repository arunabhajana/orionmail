export interface DraftAttachment { id: string; name: string; size: number; mime_type: string; handle?: string; }
export interface DraftPayload { to: string[]; pending_to: string; cc: string; bcc: string; subject: string; html: string; plain: string; attachments: DraftAttachment[]; }
export interface MailDraft { id: string; revision: number; payload: DraftPayload; updated_at: number; remote_id: string | null; state: string; error: string | null; conflict: boolean; }
export interface DraftSummary { id: string; revision: number; subject: string; to: string[]; preview: string; updated_at: number; state: string; error: string | null; conflict: boolean; attachments: number; }
export function draftStatus(state: string): string {
    return ({ synced: 'Saved to Gmail', queued: 'Saved on device', checking: 'Checking Gmail', sending: 'Sending', sent: 'Message sent', send_unknown: 'Check Sent in Gmail', unsupported: 'Edit in Gmail', deleting: 'Discarding', needs_attachments: 'Reattach files' } as Record<string, string>)[state] || 'Saved on device';
}
