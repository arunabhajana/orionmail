import { usePathname } from 'next/navigation';
import { useAppPreferences } from "@/components/AppPreferencesContext";
import { confirm } from "@tauri-apps/plugin-dialog";
import { useState, useEffect, useRef, useCallback, type RefObject } from "react";
import { useAuth } from "@/components/AuthContext";
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

export function useEmailBody(emailId: string | undefined, emailUid: number | undefined, emailUnread: boolean | undefined, folder: string | undefined, iframeRef: RefObject<HTMLIFrameElement | null>, onMarkAsRead?: (id: string) => void, localId?: string, uidValidity?: number) {
    const { preferences } = useAppPreferences();
    const pathname=usePathname();
    const { user } = useAuth();
    const [bodyContent, setBodyContent] = useState<string>("");
    const [attachments, setAttachments] = useState<Attachment[]>([]);
    const [extractedData, setExtractedData] = useState<ExtractedData | null>(null);
    const [isLoadingBody, setIsLoadingBody] = useState<boolean>(false);
    const [iframeHeight, setIframeHeight] = useState<number>(400);
    const [error, setError] = useState<string | null>(null);

    const retryRef = useRef<() => Promise<void>>(async () => {});
    const loadedKey = useRef<string | null>(null);
    const [readyBody, setReadyBody] = useState<{ key: string } | null>(null);
    const retry = useCallback(() => retryRef.current(), []);

    useEffect(() => {
        let active = true;
        let inFlight = false;
        const key = `${user?.id}:${folder}:${emailUid}:${uidValidity}:${emailId}`;
        const dbFolder = folder
            ? (folder.toLowerCase().startsWith('tag:') ? folder : folder.toLowerCase())
            : "inbox";

        const load = async () => {
            if (!active || inFlight || !user?.id || !emailId || emailUid === undefined) return;
            inFlight = true;
            setIsLoadingBody(loadedKey.current !== key);
            setError(null);
            if (loadedKey.current !== key) setIframeHeight(400);
            try {
                // This command already waits for an in-progress backend prefetch.
                // Re-fetching on body_cached used to duplicate IPC and reset the reader.
                const detail = await invoke<MessageDetail>('get_message_body', { folder: dbFolder, uid: emailUid, localId, accountId: user.id, expectedUidValidity: uidValidity });
                if (!active) return;
                loadedKey.current = key;
                setReadyBody({ key });
                setBodyContent(detail.body || "<p>Message has no content.</p>");
                setAttachments(detail.attachments || []);
                setExtractedData(detail.extractedData || null);
            } catch (err) {
                if (!active) return;
                console.error("Failed to load message body:", err);
                if (String(err).match(/No active account|NEEDS_REAUTH|TOKEN_REFRESH_FAILED/)) {
                    localStorage.removeItem("orion_user");
                    window.location.href = "/";
                    return;
                }
                if (loadedKey.current !== key) {
                    setError(String(err));
                    setBodyContent("");
                    setAttachments([]);
                    setExtractedData(null);
                }
            } finally {
                inFlight = false;
                if (active) setIsLoadingBody(false);
            }
        };
        retryRef.current = load;
        if (loadedKey.current !== key) {
            loadedKey.current = null;
            setBodyContent("");
            setAttachments([]);
            setExtractedData(null);
        }
        setError(null);
        setIsLoadingBody(false);
        void load();

        const unlistenExtracted = listen<{
            accountId: string; folder: string; uid: number; extractedData: ExtractedData;
        }>('mail:re_extracted', ({ payload }) => {
            if (active && payload.accountId === user?.id && payload.folder === dbFolder && payload.uid === emailUid) {
                setExtractedData(payload.extractedData);
            }
        });
        const handleSimulateError = (event: Event) => {
            const detail = (event as CustomEvent).detail;
            if (active && detail) {
                setError(detail);
                setBodyContent("");
                setAttachments([]);
                setExtractedData(null);
            }
        };
        window.addEventListener("orion:simulate_error", handleSimulateError);
        return () => {
            active = false;
            void unlistenExtracted.then(unlisten => unlisten()).catch(console.error);
            window.removeEventListener("orion:simulate_error", handleSimulateError);
        };
    }, [emailId, emailUid, folder, user?.id, localId, uidValidity]);

    const readCallback = useRef(onMarkAsRead);
    const unreadRef = useRef(emailUnread);
    readCallback.current = onMarkAsRead;
    unreadRef.current = emailUnread;
    const readAttempt = useRef<string | null>(null);
    useEffect(() => { readAttempt.current = null; }, [emailId, emailUid, folder, user?.id, uidValidity]);
    // A timer belongs to one opening; rerenders and an explicit unread action do not reopen it.
    useEffect(() => {
        const key = `${user?.id}:${folder}:${emailUid}:${uidValidity}:${emailId}`;
        if (pathname!=='/inbox' || !emailId || readyBody?.key !== key || loadedKey.current !== key || isLoadingBody || error || !unreadRef.current || preferences.markRead === 'manual' || readAttempt.current === key) return;
        const delay = preferences.markRead === 'immediate' ? 0 : Number(preferences.markRead) * 1000;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const schedule = () => {
            clearTimeout(timer);
            if (document.visibilityState !== 'visible' || !document.hasFocus() || readAttempt.current === key) return;
            timer = setTimeout(() => { if (unreadRef.current) { readAttempt.current = key; readCallback.current?.(emailId); } }, delay);
        };
        schedule();
        document.addEventListener('visibilitychange', schedule);
        window.addEventListener('focus', schedule);
        window.addEventListener('blur', schedule);
        return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', schedule); window.removeEventListener('focus', schedule); window.removeEventListener('blur', schedule); };
    }, [emailId, emailUid, folder, user?.id, uidValidity, preferences.markRead, readyBody, isLoadingBody, error, pathname]);

    // Handle iframe messages sent from the injected srcDoc script
    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            if (!emailId || event.source !== iframeRef.current?.contentWindow) return;
            if (event.origin !== "null" || !event.data || typeof event.data !== "object" || event.data.id !== emailId) return;

            if (event.data.type === "resize") {
                const height = event.data.height;
                if (typeof height === "number" && Number.isFinite(height) && height >= 0 && height <= 20000) {
                    setIframeHeight(height + 8);
                }
            } else if (event.data.type === "open_url" && typeof event.data.url === "string" && isAllowedExternalUrl(event.data.url)) {
                const url = event.data.url;
                void (async () => {
                    if (!url.toLowerCase().startsWith('mailto:') && preferences.confirmExternalLinks && !await confirm(`Open this link in your browser?\n\n${url.slice(0, 1000)}`, { title: 'Open external link', kind: 'info', okLabel: 'Open link', cancelLabel: 'Cancel' })) return;
                    await invoke("open_url", { url });
                })().catch(console.error);
            }
        };

        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, [emailId, iframeRef, preferences.confirmExternalLinks]);

    return { bodyContent, attachments, extractedData, isLoadingBody, iframeHeight, error, retry };
}
