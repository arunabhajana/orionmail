export interface TrashHeader {
    folder: string;
    uid: number;
    uid_validity: number;
    subject: string;
    from: string;
    date: number;
    seen: boolean;
    flagged: boolean;
    has_attachments: boolean;
    thread_id: string | null;
    snippet: string | null;
    to: string | null;
    message_id: string | null;
    tags: string[];
}

export interface PendingTrashAction {
    id: string;
    desired: 'inbox' | 'trash' | 'deleted';
    revision: number;
    version: number;
    phase: string;
    deleted: boolean;
    cached: boolean;
    locallyTouched?: boolean;
    last_error: string | null;
    optimistic: boolean;
    source: TrashHeader;
}

export interface TrashRollback {
    account_id: string;
    id: string;
    revision: number;
    reverted: boolean;
    source?: TrashHeader;
    error?: string;
}
