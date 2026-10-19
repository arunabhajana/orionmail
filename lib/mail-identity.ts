import type { Email } from './types';

export function mailIdentity(email: Email): string {
    return email.messageId?.trim()
        ? JSON.stringify(['message', email.messageId.trim(), email.timestamp, email.senderEmail, email.subject])
        : JSON.stringify(['source', email.folder, email.uid]);
}

export function sameMail(a: Email, b: Email): boolean {
    return a.id === b.id || mailIdentity(a) === mailIdentity(b);
}

const MAIL_SCALARS = [
    'id', 'uid', 'uidValidity', 'messageId', 'sender', 'senderEmail', 'to',
    'subject', 'preview', 'date', 'time', 'timestamp', 'unread', 'starred',
    'folder', 'avatar', 'body', 'tagsPending',
] as const satisfies readonly (keyof Email)[];

/** Preserve unchanged row objects so a quiet sync does not redraw every card. */
export function reuseUnchangedMail(previous: Email[], incoming: Email[]): Email[] {
    const byId = new Map(previous.map(email => [email.id, email]));
    const next = incoming.map(email => {
        const old = byId.get(email.id);
        if (!old || MAIL_SCALARS.some(key => old[key] !== email[key])
            || old.tags.length !== email.tags.length
            || old.tags.some((tag, index) => tag !== email.tags[index])
            || old.attachments.length !== email.attachments.length
            || old.attachments.some((attachment, index) => {
                const other = email.attachments[index];
                return attachment.partId !== other.partId || attachment.name !== other.name
                    || attachment.size !== other.size || attachment.type !== other.type;
            })) return email;
        return old;
    });
    return next.length === previous.length && next.every((email, index) => email === previous[index])
        ? previous : next;
}

// Callers put fresh provider/cache rows first. Older rows must never restore
// removed tags or stale flags when a refresh is merged into a scrolled list.
export function dedupeMail(emails: Email[]): Email[] {
    const unique = new Map<string, Email>();
    for (const email of emails) {
        const key = mailIdentity(email);
        if (!unique.has(key)) unique.set(key, email);
    }
    return [...unique.values()].sort((a, b) => b.timestamp - a.timestamp ||
        (a.folder < b.folder ? 1 : a.folder > b.folder ? -1 : 0) || b.uid - a.uid);
}
