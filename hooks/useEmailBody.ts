import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

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

    // Fetch the email body content via IPC
    useEffect(() => {
        let isMounted = true;
        if (!emailId || emailUid === undefined) {
            setBodyContent("");
            setAttachments([]);
            return;
        }

        const fetchBody = async () => {
            setIsLoadingBody(true);
            setIframeHeight(400); // Reset height on new email
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
                    setBodyContent(`<p class="text-red-500">Error loading message body: ${err}</p>`);
                    setAttachments([]);
                }
            } finally {
                if (isMounted) {
                    setIsLoadingBody(false);
                }
            }
        };

        fetchBody();

        return () => {
            isMounted = false;
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

    return { bodyContent, attachments, isLoadingBody, iframeHeight };
}
