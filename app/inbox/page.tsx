"use client";

import React, { useEffect, useState } from "react";
import MainLayout from "@/components/MainLayout";
import { useAuth } from "@/components/AuthContext";
import LogoSpinner from "@/components/LogoSpinner";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";

interface Mailbox {
  name: string;
  delimiter: string;
}

export default function InboxPage() {
  const { user, loading, mailboxLoading, setMailboxLoading, mailboxConnected, setMailboxConnected, needsRefresh, isBootstrappingInbox } = useAuth();
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);

  useEffect(() => {
    // Only connect to the mailbox once per session.
    // mailboxConnected lives in AuthContext (root layout) so it survives navigations.
    // Without this guard, every time the user navigates back from settings,
    // InboxPage would remount, re-run fetchMailboxes, and flash "Connecting to mailbox..."
    if (!loading && user && !needsRefresh && !mailboxConnected) {
      fetchMailboxes();
    }
  }, [loading, user, needsRefresh, mailboxConnected]);

  const fetchMailboxes = async () => {
    setMailboxLoading(true);
    try {
      const result = await invoke<Mailbox[]>("get_mailboxes");
      setMailboxes(result);
      setMailboxConnected(true); // Mark as connected so we never re-run this on navigation
      console.log("IMAP: Mailboxes fetched successfully", result);
    } catch (err: any) {
      console.error("IMAP: Connection failed", err);
      toast.error("Mailbox connection failed", {
        description: "Please check your internet connection and try again.",
        duration: 5000,
      });
    } finally {
      setMailboxLoading(false);
    }
  };


  // If still performing initial auth bootstrap
  if (loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[#F8F9FA]/80 dark:bg-[#09090b]/80 backdrop-blur-xl transition-colors">
        <LogoSpinner message="Verifying Session..." />
      </div>
    );
  }

  // If connecting to IMAP
  if (mailboxLoading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[#F8F9FA]/80 dark:bg-[#09090b]/80 backdrop-blur-xl transition-colors">
        <LogoSpinner message="Connecting to mailbox..." />
      </div>
    );
  }

  // If initial inbox sync is running after first login
  if (isBootstrappingInbox) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[#F8F9FA]/80 dark:bg-[#09090b]/80 backdrop-blur-xl transition-colors">
        <LogoSpinner message="Initializing your Inbox..." />
      </div>
    );
  }

  return (
    <div className="relative h-screen w-screen flex flex-col">
      <MainLayout />
    </div>
  );
}
