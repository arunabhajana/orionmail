"use client";

import React, { useEffect, useState } from "react";
import { useAuth } from "./AuthContext";
import LoadingOrion from "./LoadingOrion";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";

export function GlobalLoader() {
    const { loading, mailboxLoading, isBootstrappingInbox, user } = useAuth();
    const pathname = usePathname();

    // Initially true to cover the boot process seamlessly
    const [isVisible, setIsVisible] = useState(true);
    const [message, setMessage] = useState("Verifying Session");
    const [subMessage, setSubMessage] = useState("Authenticating...");

    useEffect(() => {
        let isAnyLoading = false;

        if (loading) {
            isAnyLoading = true;
            setMessage("Verifying Session");
            setSubMessage("Authenticating...");
        } else if (mailboxLoading) {
            isAnyLoading = true;
            setMessage("Connecting");
            setSubMessage("Establishing secure IMAP connection...");
        } else if (isBootstrappingInbox) {
            isAnyLoading = true;
            setMessage("Initializing");
            setSubMessage("Downloading your recent emails...");
        } else if (pathname === "/" && user && !loading) {
            // Special case: we are on the boot screen and about to redirect.
            // Keep it visible until pathname changes to /inbox.
            isAnyLoading = true;
            setMessage("Launching Orion");
            setSubMessage("Preparing your workspace...");
        }

        if (isAnyLoading) {
            setIsVisible(true);
        } else {
            // Give a short delay to bridge gaps, but now with Framer Motion 
            // the exit animation itself provides an extremely smooth bridge!
            const timer = setTimeout(() => {
                setIsVisible(false);
            }, 300);
            return () => clearTimeout(timer);
        }
    }, [loading, mailboxLoading, isBootstrappingInbox, pathname]);

    // Use z-[999] to ensure it covers everything including the titlebar
    return (
        <AnimatePresence>
            {isVisible && (
                <motion.div 
                    initial={{ opacity: 1 }}
                    exit={{ opacity: 0, filter: "blur(20px)", scale: 1.05 }}
                    transition={{ duration: 0.8, ease: "easeInOut" }}
                    style={{ position: "fixed", inset: 0, zIndex: 50 }}
                >
                    <LoadingOrion message={message} subMessage={subMessage} />
                </motion.div>
            )}
        </AnimatePresence>
    );
}
