"use client";

import React, { memo, useState } from "react";
import {
    Inbox,
    Send,
    File,
    Trash2,
    Settings,
    LogOut,
    UserPlus,
    Pencil,
    Star
} from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link"; // Import Link for navigation

import { UserProfile } from "./sidebar/UserProfile";
import { NavItem, TagItem } from "./sidebar/SidebarNavItem";
import { NavItemConfig, TagConfig } from "@/lib/types";

// --- Types ---

interface SidebarProps {
    className?: string;
    onCompose: () => void;
    currentFolder?: string;
    onFolderSelect?: (folder: string) => void;
    unreadCount?: number;
}

// --- Constants ---

const NAV_ITEMS: NavItemConfig[] = [
    { icon: Inbox, label: "Inbox", id: "inbox" },
    { icon: Star, label: "Starred", id: "starred" },
    { icon: Send, label: "Sent", id: "sent" },
    { icon: File, label: "Drafts", id: "drafts" },
    { icon: Trash2, label: "Trash", id: "trash" },
];

const TAG_ITEMS: TagConfig[] = [
    { label: "Work", colorClass: "bg-orange-400" },
    { label: "Personal", colorClass: "bg-green-400" },
];

// --- Constants ---

// --- Main Component ---

const Sidebar: React.FC<SidebarProps> = ({ className, onCompose, currentFolder, onFolderSelect, unreadCount }) => {
    return (
        <aside
            className={cn(
                // Glassmorphism Base
                "flex flex-col h-full border-r",
                "bg-white/40 dark:bg-[#1C1C21]/70 backdrop-blur-2xl border-white/20 dark:border-white/5 transition-colors relative overflow-hidden",     // Light & Dark Mode
                className
            )}
        >
            {/* Dark Mode Purple Mesh Overlay */}
            <div className="absolute inset-0 z-0 hidden dark:block pointer-events-none opacity-40">
                <div className="absolute top-[-10%] left-[-10%] w-[120%] h-[50%] bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-purple-900/40 via-violet-900/10 to-transparent blur-3xl rounded-full mix-blend-screen" />
                <div className="absolute bottom-[-10%] right-[-10%] w-[100%] h-[50%] bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-fuchsia-900/30 via-purple-900/10 to-transparent blur-3xl rounded-full mix-blend-screen" />
            </div>
            {/* Content Wrapper for z-index */}
            <div className="relative z-10 flex flex-col h-full w-full">
                {/* 1. Header / User Profile */}
                <UserProfile />

                {/* 2. Navigation Items */}
                <nav className="flex-1 px-3 py-2 space-y-1 overflow-y-auto custom-scrollbar">
                    <div className="mb-6 space-y-1">
                        {NAV_ITEMS.map((item) => (
                            <NavItem
                                key={item.id}
                                {...item}
                                badge={item.id === "inbox" && unreadCount && unreadCount > 0 ? unreadCount : item.badge}
                                highlight={currentFolder === item.id}
                                onClick={() => onFolderSelect?.(item.id)}
                            />
                        ))}
                    </div>

                    {/* 3. Tags Section */}
                    <div className="mt-6">
                        <h3 className="px-4 text-xs font-semibold text-muted-foreground/50 dark:text-white/40 uppercase tracking-wider mb-2">
                            Tags
                        </h3>
                        <div className="space-y-1">
                            {TAG_ITEMS.map((item) => (
                                <TagItem key={item.label} {...item} />
                            ))}
                        </div>
                    </div>
                </nav>

                {/* 4. Compose Button */}
                <div className="p-4 pb-9">
                    <button
                        onClick={onCompose}
                        className="w-full flex items-center justify-center gap-2 bg-primary text-white py-2.5 rounded-2xl shadow-lg shadow-primary/20 hover:bg-primary/90 transition-all font-medium text-sm"
                    >
                        <Pencil className="w-[18px] h-[18px]" />
                        Compose
                    </button>
                </div>
            </div>
        </aside>
    );
};

export default Sidebar;
