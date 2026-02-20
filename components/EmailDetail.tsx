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

// --- Types ---

interface EmailDetailProps {
    className?: string;
    email?: Email | null;
    onToggleStar?: (emailId: string) => void;
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
            "text-muted-foreground hover:bg-muted hover:text-foreground",
            className
        )}
    >
        <Icon className="w-5 h-5" />
    </button>
));
ToolbarButton.displayName = "ToolbarButton";

const DetailToolbar = memo(({ isStarred, onToggleStar }: { isStarred?: boolean; onToggleStar?: () => void }) => (
    <div className="h-16 px-6 flex items-center justify-between border-b border-border/60 shrink-0 bg-background/50 backdrop-blur-sm">
        <div className="flex items-center gap-2">
            <ToolbarButton icon={Archive} />
            <ToolbarButton icon={AlertOctagon} />
            <ToolbarButton icon={Trash2} />
            <div className="w-px h-6 bg-border mx-2" />
            <button
                onClick={onToggleStar}
                className="p-2 rounded-lg transition-colors text-muted-foreground hover:bg-muted hover:text-foreground group"
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
                    "border border-border text-foreground hover:bg-muted"
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
            className="text-2xl font-bold text-foreground mb-6 leading-tight"
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
                        <span className="font-bold text-foreground">{email.sender}</span>
                        <span className="text-muted-foreground text-sm">&lt;{email.senderEmail}&gt;</span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-sm text-muted-foreground">To:</span>
                        <span className="text-sm font-medium text-foreground/80">Arunabha Jana</span>
                    </div>
                </div>
            </div>
            <span className="text-sm font-medium text-muted-foreground">
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

const EmailDetail: React.FC<EmailDetailProps> = ({ className, email, onToggleStar }) => {
    const [bodyContent, setBodyContent] = React.useState<string>("");
    const [isLoadingBody, setIsLoadingBody] = React.useState<boolean>(false);

    React.useEffect(() => {
        let isMounted = true;
        if (!email?.id) {
            setBodyContent("");
            return;
        }

        const fetchBody = async () => {
            setIsLoadingBody(true);
            try {
                const fetchedBody: string = await invoke('get_message_body', { uid: Number(email.id) });
                if (isMounted) {
                    setBodyContent(fetchedBody || "<p>Message has no content.</p>");
                }
            } catch (err) {
                console.error("Failed to load message body:", err);
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

        return () => {
            isMounted = false;
        };
    }, [email?.id]);

    if (!email) {
        return (
            <section className={cn(
                "flex flex-col h-full items-center justify-center text-muted-foreground gap-4",
                "bg-white/40 backdrop-blur-3xl", // Glass effect
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
                "flex flex-col h-full bg-white", // Explicit white
                className
            )}
        >
            <DetailToolbar
                isStarred={email?.starred}
                onToggleStar={() => email && onToggleStar?.(email.id)}
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
                        className="max-w-3xl mx-auto"
                    >
                        <MessageHeader email={email} />

                        {isLoadingBody ? (
                            <div className="flex h-32 items-center justify-center">
                                <div className="h-6 w-6 animate-spin rounded-full border-b-2 border-primary"></div>
                                <span className="ml-3 text-sm text-muted-foreground animate-pulse">Fetching message body...</span>
                            </div>
                        ) : (
                            <article
                                className="prose prose-slate max-w-none"
                                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(bodyContent, { FORBID_TAGS: ['style', 'script', 'link', 'meta'] }) }}
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
