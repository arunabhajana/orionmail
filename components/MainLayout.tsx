"use client";

import React from 'react';
import Sidebar from '@/components/Sidebar';
import EmailList from '@/components/EmailList';
import EmailDetail from '@/components/EmailDetail';
import { cn } from '@/lib/utils'; // Keep utility for merging if needed

export default function MainLayout() {
    const [selectedEmail, setSelectedEmail] = React.useState<any>(null); // Lift state up for selection

    return (
        /* Main Dashboard Container - Full Window Fill */
        <div className="flex h-full w-full overflow-hidden bg-white/40">
            {/* Column 1: Sidebar */}
            <Sidebar className="w-64 flex flex-col shrink-0" />

            {/* Column 2: Message List */}
            <EmailList
                className="w-[380px] flex flex-col shrink-0"
                onSelectEmail={setSelectedEmail}
                selectedEmailId={selectedEmail ? selectedEmail.id : '1'} // Default select first
            />

            {/* Column 3: Reading Pane */}
            <EmailDetail
                className="flex-1 flex flex-col"
                email={selectedEmail}
            />
        </div>
    );
}
