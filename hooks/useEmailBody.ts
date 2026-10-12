import { useState, useEffect, type RefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { Attachment } from "@/lib/types";

import { ExtractedData } from "@/lib/smart-actions";

function isAllowedExternalUrl(raw: string): boolean {
    if (!raw || raw.length > 8192 || raw.trim() !== raw || /[\u0000-\u001f\u007f]/.test(raw)) return false;

    try {
        const parsed = new URL(raw);
        if (parsed.protocol === "http:" || parsed.protocol === "https:") {
            return Boolean(parsed.hostname) && !parsed.username && !parsed.password;
        }
        if (parsed.protocol === "mailto:") {
            return Boolean(parsed.pathname) && !parsed.hostname && !parsed.hash;
        }
        return false;
    } catch {
        return false;
    }
}

interface MessageDetail {
    body: string;
    attachments: Attachment[];
    extractedData?: ExtractedData;
}

export function useEmailBody(emailId: string | undefined, emailUid: number | undefined, emailUnread: boolean | undefined, folder: string | undefined, iframeRef: RefObject<HTMLIFrameElement | null>, onMarkAsRead?: (id: string) => void) {
    const [bodyContent, setBodyContent] = useState<string>("");
    const [attachments, setAttachments] = useState<Attachment[]>([]);
    const [extractedData, setExtractedData] = useState<ExtractedData | null>(null);
    const [isLoadingBody, setIsLoadingBody] = useState<boolean>(false);
    const [iframeHeight, setIframeHeight] = useState<number>(400);
    const [error, setError] = useState<string | null>(null);

    const fetchBody = async () => {
        if (!emailUid) return;
        setIsLoadingBody(true);
        setError(null);
        setIframeHeight(400); // Reset height on new email
        try {
            const dbFolder = folder || "inbox";
            console.log("Fetching body for folder:", dbFolder, "uid:", emailUid, "original folder prop:", folder);
            const detail: MessageDetail = await invoke('get_message_body', { folder: dbFolder, uid: emailUid });
            setBodyContent(detail.body || "<p>Message has no content.</p>");
            setAttachments(detail.attachments || []);
            setExtractedData(detail.extractedData || null);
        } catch (err) {
            console.error("Failed to load message body:", err);
            if (String(err).match(/No active account|NEEDS_REAUTH|TOKEN_REFRESH_FAILED/)) {
                localStorage.removeItem("orion_user");
                window.location.href = "/";
                return;
            }
            setError(String(err));
            setBodyContent("");
            setAttachments([]);
            setExtractedData(null);
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
            setExtractedData(null);
            setError(null);
            return;
        }

        const runFetch = async () => {
            setIsLoadingBody(true);
            setError(null);
            setIframeHeight(400);
            try {
                const dbFolder = folder || "inbox";
                console.log("Fetching body for folder:", dbFolder, "uid:", emailUid, "original folder prop:", folder);
                const detail: MessageDetail = await invoke('get_message_body', { folder: dbFolder, uid: emailUid });
                if (isMounted) {
                    setBodyContent(detail.body || "<p>Message has no content.</p>");
                    setAttachments(detail.attachments || []);
                    setExtractedData(detail.extractedData || null);
                }
            } catch (err) {
                console.error("Failed to load message body:", err);
                if (String(err).match(/No active account|NEEDS_REAUTH|TOKEN_REFRESH_FAILED/)) {
                    localStorage.removeItem("orion_user");
                    window.location.href = "/";
                    return;
                }
                if (isMounted) {
                    setError(String(err));
                    setBodyContent("");
                    setAttachments([]);
                    setExtractedData(null);
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
            const dbFolder = folder ? (folder.toLowerCase().startsWith('tag:') ? folder : folder.toLowerCase()) : "inbox";
            if (payload.folder === dbFolder && payload.uid === emailUid) {
                fetchBody();
            }
        });

        const unlistenExtracted = listen('mail:re_extracted', (event) => {
            const payload = event.payload as { folder: string; uid: number; extractedData: ExtractedData };
            const dbFolder = folder === "sent" ? "sent" : "inbox";
            if (payload.folder === dbFolder && payload.uid === emailUid) {
                if (isMounted) {
                    setExtractedData(payload.extractedData);
                }
            }
        });

        // Listen for dev tools simulate error event
        const handleSimulateError = (e: Event) => {
            const customEvent = e as CustomEvent;
            if (isMounted && customEvent.detail) {
                setError(customEvent.detail);
                setBodyContent("");
                setAttachments([]);
                setExtractedData(null);
            }
        };
        window.addEventListener("orion:simulate_error", handleSimulateError);

        return () => {
            isMounted = false;
            unlisten.then(f => f());
            unlistenExtracted.then(f => f());
            window.removeEventListener("orion:simulate_error", handleSimulateError);
        };
    }, [emailId, emailUid, folder]);

    // Trigger optimistic "mark as read" if the email is unread
    useEffect(() => {
        if (emailId && emailUnread && onMarkAsRead) {
            onMarkAsRead(emailId);
        }
    }, [emailId, emailUnread, onMarkAsRead]);

    // Handle iframe messages sent from the injected srcDoc script
    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            if (!emailId || event.source !== iframeRef.current?.contentWindow) return;
            if (event.origin !== "null" || !event.data || typeof event.data !== "object" || event.data.id !== emailId) return;

            if (event.data.type === "resize") {
                const height = event.data.height;
                if (typeof height === "number" && Number.isFinite(height) && height >= 0 && height <= 20000) {
                    setIframeHeight(height + 30);
                }
            } else if (event.data.type === "open_url" && typeof event.data.url === "string" && isAllowedExternalUrl(event.data.url)) {
                invoke("open_url", { url: event.data.url }).catch(console.error);
            }
        };

        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, [emailId, iframeRef]);

    return { bodyContent, attachments, extractedData, isLoadingBody, iframeHeight, error, retry: fetchBody };
}
