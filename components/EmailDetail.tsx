"use client";

import React, { memo } from 'react';
import {
    Archive,
    Trash2,
    Reply,
    MoreVertical,
    AlertOctagon,
    File,
    Download,
    Star
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Email } from '@/lib/data';
import { motion, AnimatePresence } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import DOMPurify from 'isomorphic-dompurify';
import sanitizeHtml from 'sanitize-html';

// --- Types ---

interface EmailDetailProps {
    className?: string;
    email?: Email | null;
    onToggleStar?: (emailId: string) => void;
    onDeleteMessage?: (emailId: string) => void;
    onMarkAsRead?: (emailId: string) => void;
}

// --- Sub-Components ---

const ToolbarButton = memo(({
    icon: Icon,
    onClick,
    className
}: {
    icon: React.ElementType;
    onClick?: () => void;
    className?: string;
}) => (
    <button
        onClick={onClick}
        className={cn(
            "p-2 rounded-lg transition-colors",
            "text-muted-foreground dark:text-white/60 hover:bg-muted dark:hover:bg-white/10 hover:text-foreground dark:hover:text-white/90",
            className
        )}
    >
        <Icon className="w-5 h-5" />
    </button>
));
ToolbarButton.displayName = "ToolbarButton";

const DetailToolbar = memo(({ isStarred, onToggleStar, onDelete }: { isStarred?: boolean; onToggleStar?: () => void; onDelete?: () => void }) => (
    <div className="h-16 px-6 flex items-center justify-between border-b border-border/60 shrink-0 bg-background/50 backdrop-blur-sm">
        <div className="flex items-center gap-2">
            <ToolbarButton icon={Archive} />
            <ToolbarButton icon={AlertOctagon} />
            <ToolbarButton icon={Trash2} onClick={onDelete} />
            <div className="w-px h-6 bg-border mx-2" />
            <button
                onClick={onToggleStar}
                className="p-2 rounded-lg transition-colors text-muted-foreground dark:text-white/60 hover:bg-muted dark:hover:bg-white/10 hover:text-foreground dark:hover:text-white/90 group"
            >
                <Star className={cn(
                    "w-5 h-5 transition-all",
                    isStarred ? "fill-yellow-400 text-yellow-400" : "group-hover:text-yellow-400"
                )} />
            </button>
        </div>
        <div className="flex items-center gap-2">
            <button
                className={cn(
                    "flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors",
                    "border border-border dark:border-white/10 text-foreground dark:text-white/90 hover:bg-muted dark:hover:bg-white/10"
                )}
            >
                <Reply className="w-[18px] h-[18px]" />
                Reply
            </button>
            <ToolbarButton icon={MoreVertical} />
        </div>
    </div>
));
DetailToolbar.displayName = "DetailToolbar";

const MessageHeader = memo(({ email }: { email: Email }) => (
    <header className="mb-8">
        <motion.h1
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-2xl font-bold tracking-tight text-foreground dark:text-white/90 mb-6 leading-tight"
        >
            {email.subject}
        </motion.h1>
        <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
                <div
                    className="w-12 h-12 rounded-full bg-cover bg-center border border-border"
                    style={{ backgroundImage: `url('${email?.avatar || ""}')` }}
                />
                <div>
                    <div className="flex items-center gap-2">
                        <span className="font-bold tracking-tight text-foreground dark:text-white/90">{email.sender}</span>
                        <span className="text-muted-foreground dark:text-white/50 text-sm">&lt;{email.senderEmail}&gt;</span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-sm text-muted-foreground dark:text-white/50">To:</span>
                        <span className="text-sm font-medium text-foreground/80 dark:text-white/70">Arunabha Jana</span>
                    </div>
                </div>
            </div>
            <span className="text-sm font-medium text-muted-foreground dark:text-white/50">
                {email.date}
            </span>
        </div>
    </header>
));
MessageHeader.displayName = "MessageHeader";

const AttachmentCard = memo(({ attachment }: { attachment: { name: string; size: string; type: string } }) => (
    <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className={cn(
            "mt-8 p-3 rounded-xl flex items-center gap-4 max-w-sm transition-colors",
            "border border-border bg-muted/30 hover:bg-muted/50"
        )}
    >
        <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-primary/10 text-primary">
            <File className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">{attachment.name}</p>
            <p className="text-xs text-muted-foreground">{attachment.size} • {attachment.type}</p>
        </div>
        <button className="p-2 text-muted-foreground hover:text-primary transition-colors">
            <Download className="w-5 h-5" />
        </button>
    </motion.div>
));
AttachmentCard.displayName = "AttachmentCard";

// --- Main Component ---

const EmailDetail: React.FC<EmailDetailProps> = ({ className, email, onToggleStar, onDeleteMessage, onMarkAsRead }) => {
    const [bodyContent, setBodyContent] = React.useState<string>("");
    const [isLoadingBody, setIsLoadingBody] = React.useState<boolean>(false);
    const [iframeHeight, setIframeHeight] = React.useState<number>(400);

    React.useEffect(() => {
        let isMounted = true;
        if (!email?.id) {
            setBodyContent("");
            return;
        }

        const fetchBody = async () => {
            setIsLoadingBody(true);
            setIframeHeight(400); // Reset height on new email
            try {
                const fetchedBody: string = await invoke('get_message_body', { uid: Number(email.id) });
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
        if (email.unread && onMarkAsRead) {
            onMarkAsRead(email.id);
        }

        return () => {
            isMounted = false;
        };
    }, [email?.id, email?.unread, onMarkAsRead]);

    React.useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            if (event.data?.type === 'resize' && event.data?.id === email?.id) {
                setIframeHeight(event.data.height + 30); // Add a small buffer
            }
        };

        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, [email?.id]);

    if (!email) {
        return (
            <section className={cn(
                "flex flex-col h-full items-center justify-center text-muted-foreground gap-4 transition-colors",
                "bg-white/40 dark:bg-black/20 backdrop-blur-3xl", // Glass effect
                className
            )}>
                <div className="w-16 h-16 rounded-2xl bg-black/5 dark:bg-white/10 flex items-center justify-center">
                    <File className="w-8 h-8 opacity-50" />
                </div>
                <div className="text-center">
                    <h3 className="font-semibold text-foreground text-lg">No Message Selected</h3>
                    <p className="text-sm opacity-70">Select an email to view its details</p>
                </div>
            </section>
        );
    }

    return (
        <section
            className={cn(
                "flex flex-col h-full bg-white dark:bg-[#111111] transition-colors",
                className
            )}
        >
            <DetailToolbar
                isStarred={email?.starred}
                onToggleStar={() => email && onToggleStar?.(email.id)}
                onDelete={() => email && onDeleteMessage?.(email.id)}
            />

            {/* Content Scroll Area */}
            <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
                <AnimatePresence mode="wait">
                    <motion.div
                        key={email.id}
                        initial={{ opacity: 0, x: 10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -10 }}
                        transition={{ duration: 0.2 }}
                        className="w-full max-w-5xl mx-auto"
                    >
                        <MessageHeader email={email} />

                        {isLoadingBody ? (
                            <div className="flex h-32 items-center justify-center">
                                <div className="h-6 w-6 animate-spin rounded-full border-b-2 border-primary"></div>
                                <span className="ml-3 text-sm text-muted-foreground animate-pulse">Fetching message body...</span>
                            </div>
                        ) : (
                            <iframe
                                title="Email Content"
                                className="w-full bg-white border-0 email-content-iframe"
                                sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts"
                                scrolling="no"
                                style={{ height: `${iframeHeight}px`, overflow: 'hidden' }}
                                srcDoc={`
                                    <!DOCTYPE html>
                                    <html>
                                    <head>
                                        <meta charset="utf-8">
                                        <meta name="viewport" content="width=device-width, initial-scale=1">
                                        <style>
                                            html, body { font-family: system-ui, -apple-system, sans-serif; margin: 0; padding: 0; overflow: hidden; width: 100%; }
                                            img { max-width: 100%; height: auto; }
                                            a { color: #2563eb; }
                                            #email-content-wrapper { display: block; overflow: hidden; }
                                        </style>
                                    </head>
                                    <body>
                                        <div id="email-content-wrapper">
                                            ${DOMPurify.sanitize(
                                    sanitizeHtml(bodyContent, {
                                        allowedTags: sanitizeHtml.defaults.allowedTags.concat([
                                            "img", "table", "tbody", "tr", "td", "th", "style", "head", "meta", "html", "body"
                                        ]),
                                        allowedAttributes: {
                                            a: ["href", "name", "target"],
                                            img: ["src", "alt", "width", "height"],
                                            td: ["colspan", "rowspan", "align"],
                                            "*": ["style"]
                                        }
                                    }),
                                    { FORBID_TAGS: ['script', 'iframe', 'object', 'embed'] }
                                )}
                                        </div>
                                        <script>
                                            const wrapper = document.getElementById('email-content-wrapper');
                                            let lastHeight = 0;
                                            
                                            const sendHeight = () => {
                                                if (!wrapper) return;
                                                // Only measure the strict wrapper height, ignoring the stretched iframe
                                                const height = wrapper.scrollHeight;
                                                
                                                if (height !== lastHeight) {
                                                    lastHeight = height;
                                                    window.parent.postMessage({ type: 'resize', height: height, id: '${email.id}' }, '*');
                                                }
                                            };
                                            
                                            window.addEventListener('load', sendHeight);
                                            
                                            // 1. Observe size changes strictly on wrapper, NOT document.body
                                            new ResizeObserver(sendHeight).observe(wrapper);
                                            
                                            // 2. Observe DOM mutations strictly inside wrapper
                                            new MutationObserver(sendHeight).observe(wrapper, { 
                                                childList: true, subtree: true, attributes: true 
                                            });
                                            
                                            // 3. Aggressive polling for 5 seconds
                                            let pollCount = 0;
                                            const pollInterval = setInterval(() => {
                                                sendHeight();
                                                pollCount++;
                                                if (pollCount > 50) clearInterval(pollInterval);
                                            }, 100);
                                        </script>
                                    </body>
                                    </html>
                                `}
                            />
                        )}

                        {email.attachments?.map((att, i) => (
                            <AttachmentCard key={i} attachment={att} />
                        ))}
                    </motion.div>
                </AnimatePresence>
            </div>
        </section>
    );
};

export default EmailDetail;
