"use client";

import React, { useState, useLayoutEffect, useRef, useEffect } from 'react';
import Sidebar from '@/components/Sidebar';
import EmailList from '@/components/EmailList';
import EmailDetail from '@/components/EmailDetail';
import { Email } from '@/lib/data';

import { motion, AnimatePresence } from 'framer-motion';
import ComposeModal from '@/components/ComposeModal';
import gsap from 'gsap';
import { invoke } from '@tauri-apps/api/core';
import DOMPurify from 'isomorphic-dompurify';
import { useSync } from '@/components/SyncContext';
import LogoSpinner from '@/components/LogoSpinner';

export default function MainLayout() {
    const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
    const [isComposeOpen, setIsComposeOpen] = useState(false);

    // --- New State for Folders & Stars ---
    const [currentFolder, setCurrentFolder] = useState<string>("inbox");
    const [emails, setEmails] = useState<Email[]>([]);
    const { isSyncing, setIsSyncing, setSyncMessage } = useSync();
    const [isBootstrapping, setIsBootstrapping] = useState(true);
    const [syncError, setSyncError] = useState<string | null>(null);

    const layoutRef = useRef<HTMLDivElement>(null);
    const hasSyncedRef = useRef(false);

    // --- Derived State ---

    const filteredEmails = emails.filter(email => {
        if (currentFolder === "starred") {
            return email.starred;
        }
        return email.folder === currentFolder;
    });

    const selectedEmail = emails.find(e => e.id === selectedEmailId);

    // --- Handlers ---

    const toggleStar = (emailId: string) => {
        setEmails(prev => prev.map(email =>
            email.id === emailId ? { ...email, starred: !email.starred } : email
        ));
    };

    const fetchCache = async () => {
        try {
            const cached: any[] = await invoke('get_cached_messages');
            if (cached && cached.length > 0) {
                const formattedEmails = cached.map((msg, index) => ({
                    id: msg.uid.toString(),
                    sender: msg.from.split('<')[0].trim() || msg.from,
                    senderEmail: msg.from,
                    subject: msg.subject || '(No Subject)',
                    preview: msg.snippet?.trim() || msg.subject?.substring(0, 100) || 'No preview available',
                    avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(msg.from.split('<')[0].trim() || msg.from)}&background=random`,
                    time: new Date(msg.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                    date: msg.date,
                    unread: !msg.seen,
                    folder: "inbox" as const,
                    tags: [],
                    starred: msg.flagged,
                    body: msg.snippet || '<p>Message body not fetched in this milestone.</p>',
                }));
                setEmails(formattedEmails);
                return true;
            }
            return false;
        } catch (error) {
            console.error("Failed to load cache", error);
            return false;
        }
    };

    const handleSync = (isBackground = false) => {
        if (isSyncing) return Promise.resolve();
        setIsSyncing(true);
        setSyncError(null);

        return invoke('sync_inbox')
            .then((newMessages: unknown) => {
                const count = Number(newMessages);
                console.log(`Synced: ${count} new emails`);

                if (!isBackground) {
                    if (count > 0) {
                        setSyncMessage(`${count} new email${count !== 1 ? 's' : ''}`);
                    } else {
                        setSyncMessage("No new emails");
                    }
                    setTimeout(() => setSyncMessage(null), 3000);
                }

                return fetchCache();
            })
            .catch((e) => {
                console.error("Failed to sync messages:", e);
                if (!isBackground) {
                    setSyncError("Failed to sync messages. Please try again.");
                    setTimeout(() => setSyncError(null), 3000);
                }
            })
            .finally(() => {
                setIsSyncing(false);
            });
    };

    const blockForInitialSync = async () => {
        // Since AuthContext (or another component) might have already triggered `sync_inbox`,
        // the Rust mutex might be locked. If the database is completely empty, 
        // we must literally wait and poll the cache until the background sync thread finishes 
        // pumping the first batch of SQLite messages to disk.
        return new Promise<void>((resolve) => {
            const pollInterval = setInterval(async () => {
                try {
                    const hasMessages = await fetchCache();
                    if (hasMessages) {
                        clearInterval(pollInterval);
                        resolve();
                    }
                } catch (err) {
                    // Ignore transient load errors
                }
            }, 500);

            // Safety timeout
            setTimeout(() => {
                clearInterval(pollInterval);
                resolve();
            }, 120000); // 2 min max wait
        });
    };

    useEffect(() => {
        const loadCache = async () => {
            const hasCache = await fetchCache();

            if (!hasCache) {
                // DB is empty, sync is likely already running in the background. Block and poll.
                // If this is a fresh launch (not after login), we trigger sync ourselves.
                handleSync(false);
                await blockForInitialSync();
            }

            // Drop bootstrap loader only after emails are available
            setIsBootstrapping(false);

            if (!hasSyncedRef.current) {
                hasSyncedRef.current = true;

                // If we already had a cache, we just spun up instantly. 
                // Delay a background sync to grab new items to prevent layout jank.
                if (hasCache) {
                    setTimeout(() => {
                        handleSync(true);
                    }, 500);
                }
            }
        };

        loadCache();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useLayoutEffect(() => {
        if (isBootstrapping) return;

        const ctx = gsap.context(() => {
            const tl = gsap.timeline();

            tl.from('.sidebar-anim', {
                x: -30,
                opacity: 0,
                duration: 0.6,
                ease: "power2.out"
            });

            tl.from('.list-anim', {
                opacity: 0,
                duration: 0.8,
                ease: "power1.inOut"
            }, "-=0.4");

            tl.from('.detail-anim', {
                x: 30,
                opacity: 0,
                duration: 0.6,
                ease: "power2.out"
            }, "-=0.6");
        }, layoutRef);

        return () => ctx.revert();
    }, [isBootstrapping]);

    if (isBootstrapping) {
        return (
            <div className="flex h-full w-full items-center justify-center bg-slate-50/50 backdrop-blur-sm">
                <LogoSpinner message="Syncing Inbox..." />
            </div>
        );
    }

    return (
        /* Main Dashboard Container - Full Window Fill */
        <div ref={layoutRef} className="flex h-full w-full overflow-hidden bg-white/40 relative">
            {/* Sync Error Toast */}
            <AnimatePresence>
                {syncError && (
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 20 }}
                        className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50 bg-red-500/90 text-white px-4 py-2 rounded-lg shadow-lg text-sm font-medium backdrop-blur-md"
                    >
                        {syncError}
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Column 1: Sidebar */}
            <Sidebar
                className="sidebar-anim w-64 flex flex-col shrink-0"
                onCompose={() => setIsComposeOpen(true)}
                currentFolder={currentFolder}
                onFolderSelect={setCurrentFolder}
            />

            {/* Column 2: Message List */}
            <EmailList
                className="list-anim w-[380px] flex flex-col shrink-0"
                emails={filteredEmails}
                selectedEmailId={selectedEmailId}
                onSelectEmail={(id) => setSelectedEmailId(id)}
                onToggleStar={toggleStar}
                onSync={handleSync}
                isSyncing={isSyncing}
            />

            {/* Column 3: Reading Pane */}
            <EmailDetail
                className="detail-anim flex-1 flex flex-col"
                email={selectedEmail}
                onToggleStar={toggleStar}
            />

            {/* Compose Modal Overlay */}
            <AnimatePresence>
                {isComposeOpen && (
                    <ComposeModal onClose={() => setIsComposeOpen(false)} />
                )}
            </AnimatePresence>
        </div>
    );
}
