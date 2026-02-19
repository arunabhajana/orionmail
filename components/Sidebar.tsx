"use client";

import React, { memo, useState } from "react";
import {
    Inbox,
    Send,
    File,
    Trash2,
    Settings,
    LogOut,
    UserPlus
} from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link"; // Import Link for navigation

// --- Types ---

interface SidebarProps {
    className?: string;
}

interface NavItemConfig {
    icon: React.ElementType;
    label: string;
    badge?: number;
    highlight?: boolean;
}

interface TagConfig {
    label: string;
    colorClass: string; // Tailwind class for the dot color
}

import { CURRENT_USER } from "@/lib/data";

// --- Constants ---

const NAV_ITEMS: NavItemConfig[] = [
    { icon: Inbox, label: "Inbox", badge: 12, highlight: true },
    { icon: Send, label: "Sent" },
    { icon: File, label: "Drafts" },
    { icon: Trash2, label: "Trash" },
];

const TAG_ITEMS: TagConfig[] = [
    { label: "Work", colorClass: "bg-orange-400" },
    { label: "Personal", colorClass: "bg-green-400" },
];

// --- Sub-Components ---

const ProfileDropdown = ({ onClose }: { onClose: () => void }) => (
    <motion.div
        initial={{ opacity: 0, y: -10, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -10, scale: 0.95 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className="absolute top-full left-0 w-full mt-2 p-1.5 rounded-xl border border-white/20 bg-white/70 backdrop-blur-xl shadow-2xl z-50 origin-top"
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
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-red-600 hover:bg-red-500/10 transition-colors cursor-pointer">
                <LogOut className="w-4 h-4" />
                <span>Sign Out</span>
            </div>
        </div>
    </motion.div>
);

const UserProfile = memo(() => {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <div className="relative p-4">
            <AnimatePresence>
                {isOpen && <ProfileDropdown onClose={() => setIsOpen(false)} />}
            </AnimatePresence>

            <button
                onClick={() => setIsOpen(!isOpen)}
                className={cn(
                    "w-full p-2 flex items-center gap-3 rounded-xl transition-all duration-200 outline-none",
                    "hover:bg-white/40 border border-transparent hover:border-white/20",
                    isOpen && "bg-white/40 border-white/20"
                )}
            >
                <div
                    className="w-10 h-10 rounded-full bg-cover bg-center border border-white/40 shadow-sm"
                    style={{ backgroundImage: `url('${CURRENT_USER?.avatar || ""}')` }}
                    aria-label="User Avatar"
                />
                <div className="flex flex-col items-start overflow-hidden">
                    <span className="text-foreground font-semibold text-sm truncate">
                        {CURRENT_USER.name}
                    </span>
                    <span className="text-muted-foreground text-xs truncate">
                        {CURRENT_USER.email}
                    </span>
                </div>
            </button>
        </div>
    );
});
UserProfile.displayName = "UserProfile";

const NavItem = memo(({ icon: Icon, label, badge, highlight }: NavItemConfig) => (
    <button
        className={cn(
            "w-full flex items-center gap-3 pl-4 pr-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 outline-none items-center",
            highlight
                ? "bg-white/60 text-foreground shadow-sm ring-1 ring-black/5" // Active state
                : "text-muted-foreground hover:text-foreground hover:bg-white/40" // Inactive state
        )}
    >
        <Icon
            className={cn(
                "w-[18px] h-[18px] transition-colors",
                highlight ? "text-primary" : "text-muted-foreground"
            )}
        />
        <span className="flex-1 text-left truncate">{label}</span>
        {badge && (
            <span className={cn(
                "text-xs px-1.5 py-0.5 rounded-md font-semibold",
                highlight
                    ? "bg-white/50 text-foreground"
                    : "text-muted-foreground/70"
            )}>
                {badge}
            </span>
        )}
    </button>
));
NavItem.displayName = "NavItem";

const TagItem = memo(({ label, colorClass }: TagConfig) => (
    <button className="w-full flex items-center gap-3 pl-4 pr-3 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-white/40 transition-all duration-200">
        <span className={cn("w-2.5 h-2.5 rounded-full ring-1 ring-black/5", colorClass)} />
        <span className="truncate">{label}</span>
    </button>
));
TagItem.displayName = "TagItem";

// --- Main Component ---

const Sidebar: React.FC<SidebarProps> = ({ className }) => {
    return (
        <aside
            className={cn(
                // Glassmorphism Base
                "flex flex-col h-full border-r",
                "bg-white/40 backdrop-blur-3xl border-white/20",     // Light Mode
                className
            )}
        >
            {/* 1. Header / User Profile */}
            <UserProfile />

            {/* 2. Navigation Items */}
            <nav className="flex-1 px-3 py-2 space-y-1 overflow-y-auto custom-scrollbar">
                <div className="mb-6 space-y-1">
                    {NAV_ITEMS.map((item) => (
                        <NavItem key={item.label} {...item} />
                    ))}
                </div>

                {/* 3. Tags Section */}
                <div className="mt-6">
                    <h3 className="px-4 text-xs font-semibold text-muted-foreground/50 uppercase tracking-wider mb-2">
                        Tags
                    </h3>
                    <div className="space-y-1">
                        {TAG_ITEMS.map((item) => (
                            <TagItem key={item.label} {...item} />
                        ))}
                    </div>
                </div>
            </nav>
        </aside>
    );
};

export default Sidebar;
