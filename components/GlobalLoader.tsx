"use client";

import React from "react";
import { useAuth } from "./AuthContext";
import LoadingOrion from "./LoadingOrion";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";

export function GlobalLoader() {
    const { loading, mailboxLoading, isBootstrappingInbox, user } = useAuth();
    const pathname = usePathname();

    const isVisible = loading || mailboxLoading || isBootstrappingInbox || pathname === '/' && Boolean(user);
    const message = loading ? 'Verifying Session' : mailboxLoading ? 'Connecting' : isBootstrappingInbox ? 'Setting up your mailbox' : 'Launching OrionMail';
    const subMessage = loading ? 'Authenticating…' : mailboxLoading ? 'Establishing a secure connection…' : isBootstrappingInbox ? 'Your first sync can take a little while. Recent messages load first.' : 'Preparing your workspace…';

    // Use z-[999] to ensure it covers everything including the titlebar
    return (
        <AnimatePresence>
            {isVisible && (
                <motion.div 
                    initial={{ opacity: 1 }}
                    exit={{ opacity: 0, filter: "blur(20px)", scale: 1.05 }}
                    transition={{ duration: 0.18, ease: "easeInOut" }}
                    style={{ position: "fixed", inset: 0, zIndex: 50 }}
                >
                    <LoadingOrion message={message} subMessage={subMessage} />
                </motion.div>
            )}
        </AnimatePresence>
    );
}
