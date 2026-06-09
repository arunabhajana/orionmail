"use client";

import React, { useEffect, useState } from "react";
import MainLayout from "@/components/MainLayout";
import { useAuth } from "@/components/AuthContext";
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


  // The GlobalLoader in layout.tsx will handle showing the immersive animation
  // with dynamic text for loading, mailboxLoading, and isBootstrappingInbox.
  // We just return null to prevent MainLayout from mounting prematurely.
  if (loading || mailboxLoading || isBootstrappingInbox) {
    return null;
  }

  return (
    <div className="relative h-screen w-screen flex flex-col">
      <MainLayout />
    </div>
  );
}
