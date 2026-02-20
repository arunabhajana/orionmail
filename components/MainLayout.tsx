"use client";

import React, { useState, useLayoutEffect, useRef, useEffect } from 'react';
import Sidebar from '@/components/Sidebar';
import EmailList from '@/components/EmailList';
import EmailDetail from '@/components/EmailDetail';
import { Email } from '@/lib/data';

import { AnimatePresence } from 'framer-motion';
import ComposeModal from '@/components/ComposeModal';
import gsap from 'gsap';
import { invoke } from '@tauri-apps/api/core';

export default function MainLayout() {
    const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
    const [isComposeOpen, setIsComposeOpen] = useState(false);

    // --- New State for Folders & Stars ---
    const [currentFolder, setCurrentFolder] = useState<string>("inbox");
    const [emails, setEmails] = useState<Email[]>([]);
    const [isSyncing, setIsSyncing] = useState(false);
    const [isBootstrapping, setIsBootstrapping] = useState(true);

    const layoutRef = useRef<HTMLDivElement>(null);

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

    const handleSync = async (isBackground = false) => {
        if (isSyncing) return;
        setIsSyncing(true);
        try {
            const messages: any[] = await invoke('get_inbox_messages');
            const formattedEmails = messages.map((msg, index) => ({
                id: msg.uid.toString(),
                sender: msg.from.split('<')[0].trim() || msg.from,
                senderEmail: msg.from,
                subject: msg.subject || '(No Subject)',
                preview: 'Message body not fetched.',
                avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(msg.from.split('<')[0].trim() || msg.from)}&background=random`,
                time: new Date(msg.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                date: msg.date,
                unread: !msg.seen,
                folder: "inbox" as const,
                tags: [],
                starred: msg.flagged,
                body: '<p>Message body not fetched in this milestone.</p>',
            }));

            // Replaces the emails array directly.
            setEmails(formattedEmails);
        } catch (e) {
            console.error("Failed to sync messages:", e);
            if (!isBackground) {
                alert("Failed to sync messages: " + (e as any).toString());
            }
        } finally {
            setIsSyncing(false);
        }
    };

    useEffect(() => {
        const loadCache = async () => {
            try {
                const cached: any[] = await invoke('get_cached_messages');
                if (cached && cached.length > 0) {
                    const formattedEmails = cached.map((msg, index) => ({
                        id: msg.uid.toString(),
                        sender: msg.from.split('<')[0].trim() || msg.from,
                        senderEmail: msg.from,
                        subject: msg.subject || '(No Subject)',
                        preview: 'Message body not fetched.',
                        avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(msg.from.split('<')[0].trim() || msg.from)}&background=random`,
                        time: new Date(msg.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                        date: msg.date,
                        unread: !msg.seen,
                        folder: "inbox" as const,
                        tags: [],
                        starred: msg.flagged,
                        body: '<p>Message body not fetched in this milestone.</p>',
                    }));
                    setEmails(formattedEmails);
                }
            } catch (error) {
                console.error("Failed to load cache", error);
            } finally {
                setIsBootstrapping(false);

                // Delay background sync to prevent layout jank
                setTimeout(() => {
                    handleSync(true);
                }, 500);
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
        return <div className="flex h-full w-full items-center justify-center bg-white/40"><p className="text-muted-foreground animate-pulse">Loading Inbox...</p></div>;
    }

    return (
        /* Main Dashboard Container - Full Window Fill */
        <div ref={layoutRef} className="flex h-full w-full overflow-hidden bg-white/40">
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
