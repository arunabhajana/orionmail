"use client";

import React, { useEffect, useState } from "react";
import MainLayout from "@/components/MainLayout";
import { useAuth } from "@/components/AuthContext";
import { invoke } from "@tauri-apps/api/core";

interface Mailbox {
  name: string;
  delimiter: string;
}

export default function InboxPage() {
  const { user, loading, mailboxLoading, setMailboxLoading, needsRefresh, isBootstrappingInbox } = useAuth();
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && user && !needsRefresh) {
      fetchMailboxes();
    }
  }, [loading, user, needsRefresh]);

  const fetchMailboxes = async () => {
    setMailboxLoading(true);
    setError(null);
    try {
      const result = await invoke<Mailbox[]>("get_mailboxes");
      setMailboxes(result);
      console.log("IMAP: Mailboxes fetched successfully", result);
    } catch (err: any) {
      console.error("IMAP: Connection failed", err);
      setError("Mailbox connection failed. Please check your internet or refresh token.");
    } finally {
      setMailboxLoading(false);
    }
  };

  // If still performing initial auth bootstrap
  if (loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[#F8F9FA]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-4 border-slate-200 border-t-blue-500 rounded-full animate-spin" />
          <div className="text-slate-500 font-medium animate-pulse">Verifying Session...</div>
        </div>
      </div>
    );
  }

  // If connecting to IMAP
  if (mailboxLoading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[#F8F9FA]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-4 border-slate-200 border-t-blue-500 rounded-full animate-spin" />
          <div className="text-slate-500 font-medium animate-pulse">Connecting to mailbox...</div>
        </div>
      </div>
    );
  }

  // If initial inbox sync is running after first login
  if (isBootstrappingInbox) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[#F8F9FA]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-4 border-slate-200 border-t-blue-500 rounded-full animate-spin" />
          <div className="text-slate-500 font-medium animate-pulse">Initializing your Inbox...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-screen w-screen flex flex-col">
      {error && (
        <div className="absolute top-4 right-4 z-50 bg-red-50 border border-red-100 text-red-600 px-4 py-2 rounded-lg shadow-sm text-sm">
          {error}
        </div>
      )}

      <MainLayout />
    </div>
  );
}
