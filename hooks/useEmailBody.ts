import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

export function useEmailBody(emailId: string | undefined, emailUnread: boolean | undefined, onMarkAsRead?: (id: string) => void) {
    const [bodyContent, setBodyContent] = useState<string>("");
    const [isLoadingBody, setIsLoadingBody] = useState<boolean>(false);
    const [iframeHeight, setIframeHeight] = useState<number>(400);

    // Fetch the email body content via IPC
    useEffect(() => {
        let isMounted = true;
        if (!emailId) {
            setBodyContent("");
            return;
        }

        const fetchBody = async () => {
            setIsLoadingBody(true);
            setIframeHeight(400); // Reset height on new email
            try {
                const fetchedBody: string = await invoke('get_message_body', { uid: Number(emailId) });
                if (isMounted) {
                    setBodyContent(fetchedBody || "<p>Message has no content.</p>");
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
                }
            } finally {
                if (isMounted) {
                    setIsLoadingBody(false);
                }
            }
        };

        fetchBody();

        // Trigger optimistic "mark as read" if the email is unread
        if (emailUnread && onMarkAsRead) {
            onMarkAsRead(emailId);
        }

        return () => {
            isMounted = false;
        };
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

    return { bodyContent, isLoadingBody, iframeHeight };
}
