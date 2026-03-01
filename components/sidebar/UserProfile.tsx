"use client";

import React, { memo, useState } from "react";
import { Settings, LogOut, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { useAuth } from "@/components/AuthContext";

const ProfileDropdown = ({ onClose }: { onClose: () => void }) => {
    const { user, logout } = useAuth();

    return (
        <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="absolute top-full left-0 w-full mt-2 p-1.5 rounded-xl border border-white/20 dark:border-white/10 bg-white/70 dark:bg-[#1C1C1E]/90 backdrop-blur-xl shadow-2xl z-50 origin-top"
        >
            <div className="flex flex-col gap-1">
                <Link href="/settings" onClick={onClose} className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-foreground hover:bg-black/5 transition-colors cursor-pointer">
                    <Settings className="w-4 h-4 text-muted-foreground" />
                    <span>Settings</span>
                </Link>
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-foreground hover:bg-black/5 transition-colors cursor-pointer">
                    <UserPlus className="w-4 h-4 text-muted-foreground" />
                    <span>Add Account</span>
                </div>
                <div className="h-px bg-black/5 my-1" />
                <div
                    onClick={() => {
                        if (user) logout(user.email);
                        onClose();
                    }}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-red-600 hover:bg-red-500/10 transition-colors cursor-pointer"
                >
                    <LogOut className="w-4 h-4" />
                    <span>Sign Out</span>
                </div>
            </div>
        </motion.div>
    );
};

export const UserProfile = memo(() => {
    const [isOpen, setIsOpen] = useState(false);
    const { user, loading } = useAuth();

    if (loading) {
        return (
            <div className="p-6">
                <div className="w-full h-[60px] animate-pulse bg-white/20 rounded-xl" />
            </div>
        );
    }

    if (!user) {
        return (
            <div className="p-6">
                <Link
                    href="/"
                    className="w-full p-3 flex items-center justify-center gap-2 rounded-xl bg-primary/10 border border-primary/20 text-sm font-medium text-primary hover:bg-primary/20 transition-all focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                    Sign In
                </Link>
            </div>
        );
    }

    const initials = user.name
        ? user.name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2)
        : user.email[0].toUpperCase();

    return (
        <div className="relative">
            <AnimatePresence>
                {isOpen && <ProfileDropdown onClose={() => setIsOpen(false)} />}
            </AnimatePresence>

            <button
                onClick={() => setIsOpen(!isOpen)}
                className={cn(
                    "w-full p-6 flex items-center gap-3 transition-all duration-200 outline-none group text-left",
                    "hover:bg-white/30 dark:hover:bg-white/5 border-b border-white/10",
                    isOpen && "bg-white/30 dark:bg-white/5"
                )}
            >
                {user.picture ? (
                    <div
                        className="size-10 rounded-full bg-cover bg-center border border-white/40 shadow-sm shrink-0"
                        style={{ backgroundImage: `url('${user.picture}')` }}
                        aria-label="User Avatar"
                    />
                ) : (
                    <div className="size-10 rounded-full bg-primary/10 border border-white/40 flex items-center justify-center text-primary font-bold text-sm shrink-0">
                        {initials}
                    </div>
                )}
                <div className="flex flex-col overflow-hidden">
                    <span className="text-slate-900 font-semibold dark:text-white/90 text-sm truncate tracking-tight">
                        {user.name || "Elena Ross"}
                    </span>
                    <span className="text-slate-500 dark:text-white/50 text-xs truncate">
                        {user.email}
                    </span>
                </div>
            </button>
        </div>
    );
});
UserProfile.displayName = "UserProfile";
