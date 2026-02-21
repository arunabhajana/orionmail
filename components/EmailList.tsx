"use client";

import React, { memo } from 'react';
import { Search, Star, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Email } from '@/lib/data';
import { motion, AnimatePresence } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';

// Global cache to prevent duplicate fetches across remounts and concurrent requests
const fetchedPreviewUIDs = new Set<string>();
const fetchingUIDs = new Set<string>();

// --- Types ---

interface EmailListProps {
    className?: string;
    emails: Email[];
    selectedEmailId: string | null;
    onSelectEmail: (id: string) => void;
    onToggleStar?: (emailId: string) => void;
    onSync?: () => void;
    isSyncing?: boolean;
}

// --- Constants ---


// --- Sub-Components ---

const SearchBar = memo(() => (
    <div className="relative group">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground w-4 h-4 transition-colors group-focus-within:text-primary" />
        <input
            className={cn(
                "w-full rounded-lg py-2 pl-9 pr-4 text-sm outline-none transition-all",
                "bg-white/50 border border-white/20 placeholder:text-muted-foreground/70",
                "focus:ring-2 focus:ring-primary/20 focus:border-primary/50"
            )}
            placeholder="Search messages..."
            type="text"
        />
    </div>
));
SearchBar.displayName = "SearchBar";

const FilterTabs = memo(() => (
    <div className="flex gap-4 border-b border-black/5 pb-1">
        <button className="text-foreground border-b-2 border-primary pb-2 text-sm font-semibold">
            All
        </button>
        <button className="text-muted-foreground pb-2 text-sm font-medium hover:text-foreground transition-colors">
            Unread
        </button>
        <button className="text-muted-foreground pb-2 text-sm font-medium hover:text-foreground transition-colors">
            Flagged
        </button>
    </div>
));
FilterTabs.displayName = "FilterTabs";

const EmailListItem = memo(({
    email,
    isSelected,
    onSelect,
    onToggleStar
}: {
    email: Email;
    isSelected: boolean;
    onSelect?: (id: string) => void;
    onToggleStar?: (id: string) => void;
}) => {
    const [previewText, setPreviewText] = React.useState(email.preview || "");
    const itemRef = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
        // If we already fetched it globally, we don't need to observe
        if (fetchedPreviewUIDs.has(email.id)) return;

        let debounceTimer: NodeJS.Timeout;

        const observer = new IntersectionObserver(
            (entries) => {
                const [entry] = entries;
                if (entry.isIntersecting) {
                    debounceTimer = setTimeout(async () => {
                        if (fetchedPreviewUIDs.has(email.id) || fetchingUIDs.has(email.id)) return;

                        fetchingUIDs.add(email.id);
                        try {
                            const body: string = await invoke("get_message_body", { uid: Number(email.id) });
                            if (body) {
                                // Strip hidden items, strip HTML, and normalize whitespace
                                const stripped = body
                                    .replace(/<[^>]*display\s*:\s*none[^>]*>[\s\S]*?<\/[^>]+>/gi, ' ')
                                    .replace(/<[^>]+>/g, ' ')
                                    .replace(/\s+/g, ' ')
                                    .trim();
                                const newPreview = stripped.length > 160 ? stripped.substring(0, 160) + '...' : stripped;
                                if (newPreview) {
                                    setPreviewText(newPreview);
                                }
                                fetchedPreviewUIDs.add(email.id);
                            }
                        } catch (err) {
                            console.error("Failed to hydrate preview for UID", email.id, err);
                        } finally {
                            fetchingUIDs.delete(email.id);
                        }
                    }, 150); // Debounce to allow fast scrolling without firing
                } else {
                    clearTimeout(debounceTimer);
                }
            },
            { threshold: 0.1, rootMargin: '100px' }
        );

        if (itemRef.current) {
            observer.observe(itemRef.current);
        }

        return () => {
            clearTimeout(debounceTimer);
            observer.disconnect();
        };
    }, [email.id]);

    return (
        <motion.div
            ref={itemRef}
            layoutId={`email-${email.id}`}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            whileHover={{ scale: 1.01, backgroundColor: "rgba(255,255,255,0.4)" }}
            onClick={() => onSelect?.(email.id)}
            className={cn(
                "px-4 py-4 cursor-pointer transition-all duration-200 border-b border-black/5",
                isSelected
                    ? "bg-primary/10 border-l-4 border-l-primary" // Selected
                    : "border-l-4 border-transparent" // Regular
            )}
        >
            <div className="flex justify-between items-start mb-1">
                <div className="flex items-center gap-2">
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onToggleStar?.(email.id);
                        }}
                        className="group/star p-1 -ml-1 rounded-full hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                    >
                        <Star
                            className={cn(
                                "w-4 h-4 transition-all duration-200",
                                email.starred
                                    ? "fill-yellow-400 text-yellow-400 scale-110"
                                    : "text-muted-foreground/40 group-hover/star:text-muted-foreground group-hover/star:scale-110"
                            )}
                        />
                    </button>
                    {email.unread && !isSelected && (
                        <span className="w-2 h-2 rounded-full bg-primary shrink-0 animate-pulse" />
                    )}
                    <span className={cn(
                        "text-sm truncate max-w-[160px]",
                        isSelected || email.unread
                            ? "font-semibold text-foreground"
                            : "font-medium text-foreground/80"
                    )}>
                        {email.sender}
                    </span>
                </div>
                <span className={cn(
                    "text-[11px] font-medium whitespace-nowrap",
                    isSelected ? "text-primary" : "text-muted-foreground"
                )}>
                    {email.time}
                </span>
            </div>
            <h4 className={cn(
                "text-sm mb-1 truncate pr-2",
                isSelected ? "font-semibold text-foreground/90" : "font-medium text-foreground/70"
            )}>
                {email.subject}
            </h4>
            <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
                {previewText}
            </p>
        </motion.div>
    );
});
EmailListItem.displayName = "EmailListItem";

// --- Main Component ---

const EmailList: React.FC<EmailListProps> = ({
    className,
    emails,
    selectedEmailId,
    onSelectEmail,
    onToggleStar,
    onSync,
    isSyncing
}) => {
    return (
        <main
            className={cn(
                "glass-list flex flex-col h-full border-r",
                "bg-white/60 backdrop-blur-3xl border-black/5",
                className
            )}
        >
            {/* 1. Header Area with Search & Filter */}
            <div className="p-4 space-y-4 shrink-0 z-10">
                <div className="flex items-center gap-2">
                    <div className="flex-1">
                        <SearchBar />
                    </div>
                    <button
                        onClick={onSync}
                        disabled={isSyncing}
                        className={cn(
                            "p-2 rounded-lg bg-white/50 border border-white/20 hover:bg-white/80 transition-colors flex items-center justify-center",
                            isSyncing && "opacity-70 cursor-not-allowed"
                        )}
                        title="Sync Emails"
                    >
                        <RefreshCw className={cn("w-4 h-4 text-muted-foreground", isSyncing && "animate-spin text-primary")} />
                    </button>
                </div>
                <FilterTabs />
            </div>

            {/* 2. Scrollable List */}
            <div className="flex-1 overflow-y-auto custom-scrollbar">
                <AnimatePresence>
                    {emails.map((email) => (
                        <EmailListItem
                            key={email.id}
                            email={email}
                            isSelected={selectedEmailId === email.id}
                            onSelect={onSelectEmail}
                            onToggleStar={onToggleStar}
                        />
                    ))}
                </AnimatePresence>
            </div>
        </main>
    );
};

export default EmailList;
