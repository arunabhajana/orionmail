import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { Attachment } from "@/lib/types";

interface MessageDetail {
    body: string;
    attachments: Attachment[];
}

export function useEmailBody(emailId: string | undefined, emailUid: number | undefined, emailUnread: boolean | undefined, folder: string | undefined, onMarkAsRead?: (id: string) => void) {
    const [bodyContent, setBodyContent] = useState<string>("");
    const [attachments, setAttachments] = useState<Attachment[]>([]);
    const [isLoadingBody, setIsLoadingBody] = useState<boolean>(false);
    const [iframeHeight, setIframeHeight] = useState<number>(400);
    const [error, setError] = useState<string | null>(null);

    const fetchBody = async () => {
        if (!emailUid) return;
        setIsLoadingBody(true);
        setError(null);
        setIframeHeight(400); // Reset height on new email
        try {
            const dbFolder = folder === "sent" ? "sent" : "INBOX";
            const detail: MessageDetail = await invoke('get_message_body', { folder: dbFolder, uid: emailUid });
            setBodyContent(detail.body || "<p>Message has no content.</p>");
            setAttachments(detail.attachments || []);
        } catch (err) {
            console.error("Failed to load message body:", err);
            if (String(err).includes("No active account")) {
                localStorage.removeItem("orion_user");
                window.location.href = "/";
                return;
            }
            setError(String(err));
            setBodyContent("");
            setAttachments([]);
        } finally {
            setIsLoadingBody(false);
        }
    };

    // Fetch the email body content via IPC
    useEffect(() => {
        let isMounted = true;
        if (!emailId || emailUid === undefined) {
            setBodyContent("");
            setAttachments([]);
            setError(null);
            return;
        }

        const runFetch = async () => {
            setIsLoadingBody(true);
            setError(null);
            setIframeHeight(400);
            try {
                const dbFolder = folder === "sent" ? "sent" : "INBOX";
                const detail: MessageDetail = await invoke('get_message_body', { folder: dbFolder, uid: emailUid });
                if (isMounted) {
                    setBodyContent(detail.body || "<p>Message has no content.</p>");
                    setAttachments(detail.attachments || []);
                }
            } catch (err) {
                console.error("Failed to load message body:", err);
                if (String(err).includes("No active account")) {
                    localStorage.removeItem("orion_user");
                    window.location.href = "/";
                    return;
                }
                if (isMounted) {
                    setError(String(err));
                    setBodyContent("");
                    setAttachments([]);
                }
            } finally {
                if (isMounted) {
                    setIsLoadingBody(false);
                }
            }
        };

        runFetch();

        // Listen for background prefetch completion
        const unlisten = listen('mail:body_cached', (event) => {
            const payload = event.payload as { folder: string; uid: number };
            const dbFolder = folder === "sent" ? "sent" : "inbox";
            if (payload.folder === dbFolder && payload.uid === emailUid) {
                // Background fetch finished for the email we are currently looking at!
                // Re-fetch to grab the newly cached content from SQLite
                fetchBody();
            }
        });

        return () => {
            isMounted = false;
            unlisten.then(f => f());
        };
    }, [emailId, emailUid, folder]);

    // Trigger optimistic "mark as read" if the email is unread
    useEffect(() => {
        if (emailId && emailUnread && onMarkAsRead) {
            onMarkAsRead(emailId);
        }
    }, [emailId, emailUnread, onMarkAsRead]);

    // Handle iframe resize messages sent from the injected srcDoc script
    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            if (event.data?.type === 'resize' && event.data?.id === emailId) {
                setIframeHeight(event.data.height + 30); // Add a small buffer
            }
        };

        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, [emailId]);

    return { bodyContent, attachments, isLoadingBody, iframeHeight, error, retry: fetchBody };
}
