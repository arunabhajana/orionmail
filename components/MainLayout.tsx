"use client";

import React, { useState, useLayoutEffect, useRef } from 'react';
import Sidebar from '@/components/Sidebar';
import EmailList from '@/components/EmailList';
import EmailDetail from '@/components/EmailDetail';
import { MOCK_EMAILS } from '@/lib/data';

import { AnimatePresence } from 'framer-motion';
import ComposeModal from '@/components/ComposeModal';
import gsap from 'gsap';

export default function MainLayout() {
    const [selectedEmailId, setSelectedEmailId] = useState<string | null>(MOCK_EMAILS[0].id);
    const [isComposeOpen, setIsComposeOpen] = useState(false);

    // --- New State for Folders & Stars ---
    const [currentFolder, setCurrentFolder] = useState<string>("inbox");
    const [emails, setEmails] = useState(MOCK_EMAILS);

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

    useLayoutEffect(() => {
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
    }, []);

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
