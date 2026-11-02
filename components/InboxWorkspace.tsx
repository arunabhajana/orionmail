"use client";
import MainLayout from './MainLayout';
// Retained by PersistentInbox. Mail commands connect lazily; cached mail does
// not need a fresh get_mailboxes round trip before it can be displayed.
export default function InboxWorkspace() {
    return <div className="relative flex h-full min-h-0 w-full flex-col"><MainLayout /></div>;
}
