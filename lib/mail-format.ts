import type { Email, NativeMessageHeader } from './types';
import { formatEmailTime } from './utils';

export function formatNativeEmail(msg: NativeMessageHeader, accountId?: string): Email {
    let folder = msg.folder;
    if (!folder) folder = "inbox";
    else if (folder.toLowerCase() === "sent") folder = "sent";
    // Preserve case for tags, standardize others
    else if (!folder.toLowerCase().startsWith("tag:")) folder = folder.toLowerCase();
    let senderName = msg.from.split('<')[0].trim();
    if (!senderName) {
        const emailMatch = msg.from.match(/<([^>]+)>/);
        senderName = emailMatch ? emailMatch[1].split('@')[0] : msg.from;
    }

    return {
        id: `${folder}-${msg.uid}`,
        accountId,
        uid: msg.uid,
        uidValidity: msg.uid_validity,
        messageId: msg.message_id ?? undefined,
        threadId: msg.thread_id ?? undefined,
        sender: senderName,
        senderEmail: msg.from,
        to: msg.to || undefined,
        subject: msg.subject || '(No Subject)',
        preview: msg.snippet?.trim() || msg.subject?.substring(0, 100) || 'No preview available',
        time: formatEmailTime(msg.date * 1000),
        date: new Date(msg.date * 1000).toLocaleString(),
        timestamp: msg.date * 1000,
        unread: !msg.seen,
        folder,
        tags: msg.tags || [],
        starred: msg.flagged,
        body: msg.snippet || '<p>Message body not fetched in this milestone.</p>',
        attachments: [],
    };
}
