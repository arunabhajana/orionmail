"use client";

import React, { useState } from 'react';
import Sidebar from '@/components/Sidebar';
import EmailList from '@/components/EmailList';
import EmailDetail from '@/components/EmailDetail';
import { MOCK_EMAILS, Email } from '@/lib/data';

export default function MainLayout() {
    const [selectedEmailId, setSelectedEmailId] = useState<string | null>(MOCK_EMAILS[0].id);

    const selectedEmail = MOCK_EMAILS.find(e => e.id === selectedEmailId);

    return (
        /* Main Dashboard Container - Full Window Fill */
        <div className="flex h-full w-full overflow-hidden bg-white/40">
            {/* Column 1: Sidebar */}
            <Sidebar className="w-64 flex flex-col shrink-0" />

            {/* Column 2: Message List */}
            <EmailList
                className="w-[380px] flex flex-col shrink-0"
                emails={MOCK_EMAILS}
                selectedEmailId={selectedEmailId}
                onSelectEmail={(id) => setSelectedEmailId(id)}
            />

            {/* Column 3: Reading Pane */}
            <EmailDetail
                className="flex-1 flex flex-col"
                email={selectedEmail}
            />
        </div>
    );
}
