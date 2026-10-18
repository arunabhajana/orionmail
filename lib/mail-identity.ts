import type { Email } from './types';

export function mailIdentity(email: Email): string {
    return email.messageId?.trim()
        ? JSON.stringify(['message', email.messageId.trim(), email.timestamp, email.senderEmail, email.subject])
        : JSON.stringify(['source', email.folder, email.uid]);
}

export function sameMail(a: Email, b: Email): boolean {
    return a.id === b.id || mailIdentity(a) === mailIdentity(b);
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
