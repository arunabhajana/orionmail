import type { Email } from './types';

// No subject heuristics: a conversation requires explicit reply metadata.
export function groupConversations(emails: Email[]): Email[] {
    const groups = new Map<string, Email[]>();
    for (const email of emails) {
        const key = email.locationId ? `location:${email.id}` : email.threadId || email.messageId || `row:${email.id}`;
        const items = groups.get(key) || [];
        items.push(email);
        groups.set(key, items);
    }
    return [...groups.values()].map(items => {
        const latest = items.reduce((a,b) => a.timestamp >= b.timestamp ? a : b);
        return items.length === 1 ? latest : { ...latest, resurfacedAt:Math.max(...items.map(email=>email.resurfacedAt||0))||undefined, snoozedUntil:items.find(email=>email.snoozedUntil)?.snoozedUntil, pinned:items.some(email=>email.pinned), conversationCount: items.length, conversationUnread: items.some(email=>email.unread), conversationIds: items.map(email => email.id) };
    }).sort((a,b) => b.timestamp-a.timestamp);
}
