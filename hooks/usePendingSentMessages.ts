import { useState, useCallback } from 'react';
import { Email } from '@/lib/types';

export interface PendingSentMessage {
    id: string; // Internal temporary ID while sending
    messageId?: string; // Authoritative Message-ID from SMTP
    subject: string;
    recipients: string[];
    createdAt: number;
    status: 'sending' | 'syncing';
}

// 5 minutes timeout for ghost messages
const PENDING_SENT_TIMEOUT = 5 * 60 * 1000;

export function normalizeMessageId(id: string): string {
    return id.trim().replace(/^<|>$/g, "").toLowerCase();
}

export function usePendingSentMessages() {
    const [pendingMessages, setPendingMessages] = useState<PendingSentMessage[]>([]);

    const cleanupStaleMessages = useCallback(() => {
        const now = Date.now();
        setPendingMessages(prev => prev.filter(msg => {
            if (now - msg.createdAt > PENDING_SENT_TIMEOUT) {
                console.warn("Removed stale pending message:", msg);
                return false;
            }
            return true;
        }));
    }, []);

    const addPendingMessage = useCallback((msg: PendingSentMessage) => {
        setPendingMessages(prev => [msg, ...prev]);
        cleanupStaleMessages();
    }, [cleanupStaleMessages]);

    const updatePendingToSyncing = useCallback((id: string, messageId: string) => {
        setPendingMessages(prev => prev.map(msg => 
            msg.id === id 
                ? { ...msg, status: 'syncing', messageId: normalizeMessageId(messageId) }
                : msg
        ));
        cleanupStaleMessages();
    }, [cleanupStaleMessages]);

    const removePendingMessage = useCallback((id: string) => {
        setPendingMessages(prev => prev.filter(msg => msg.id !== id));
    }, []);

    const reconcileWithDb = useCallback((dbMessages: Email[]) => {
        setPendingMessages(prev => {
            const next = prev.filter(pending => {
                // Remove if it's older than timeout
                if (Date.now() - pending.createdAt > PENDING_SENT_TIMEOUT) {
                    return false;
                }
                
                // If we don't have a messageId yet (still 'sending'), don't reconcile it yet
                if (!pending.messageId || pending.status === 'sending') {
                    return true;
                }

                // Check if the authoritative DB message has arrived
                const isSynced = dbMessages.some(dbMsg => {
                    // dbMsg must have messageId parsed from IMAP now, but it's an Email type.
                    // We need to add messageId to Email type or use a hack.
                    // Let's assume Email will have messageId added.
                    const dbMessageId = (dbMsg as any).messageId;
                    if (!dbMessageId) return false;
                    
                    return normalizeMessageId(dbMessageId) === pending.messageId;
                });

                return !isSynced;
            });
            return next;
        });
    }, []);

    return {
        pendingMessages,
        addPendingMessage,
        updatePendingToSyncing,
        removePendingMessage,
        reconcileWithDb,
        cleanupStaleMessages,
    };
}
