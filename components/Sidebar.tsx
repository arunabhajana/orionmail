"use client";

import React, { memo } from "react";
import {
    Inbox,
    Send,
    File,
    Trash2,
    Pencil,
    LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

// --- Types ---

interface SidebarProps {
    className?: string;
}

interface NavItemConfig {
    icon: LucideIcon;
    label: string;
    badge?: number;
    highlight?: boolean; // If true, adds primary background style
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

const UserProfile = memo(() => (
    <div className="p-6 flex items-center gap-3">
        <div
            className="w-10 h-10 rounded-full bg-cover bg-center border border-white/40"
            style={{ backgroundImage: `url('${CURRENT_USER?.avatar || ""}')` }}
            aria-label="User Avatar"
        />
        <div className="flex flex-col overflow-hidden">
            <span className="text-foreground font-semibold text-sm truncate">
                {CURRENT_USER.name}
            </span>
            <span className="text-muted-foreground text-xs truncate">
                {CURRENT_USER.email}
            </span>
        </div>
    </div>
));
UserProfile.displayName = "UserProfile";

const NavItem = memo(({ item }: { item: NavItemConfig }) => {
    const Icon = item.icon;

    return (
        <div
            className={cn(
                "group flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-all duration-200",
                // Default state
                "text-muted-foreground hover:bg-white/30 hover:text-foreground",
                // Simple scale effect on hover
                "hover:scale-[1.02]",
                // Highlight logic (Inbox style)
                item.highlight && "bg-primary/10 text-primary hover:bg-primary/15"
            )}
        >
            <Icon className="w-5 h-5" strokeWidth={2} />
            <span className="text-sm font-medium">{item.label}</span>

            {item.badge && (
                <span
                    className={cn(
                        "ml-auto text-xs font-semibold px-2 py-0.5 rounded-full",
                        item.highlight
                            ? "bg-primary/20 text-primary"
                            : "bg-muted text-muted-foreground"
                    )}
                >
                    {item.badge}
                </span>
            )}
        </div>
    );
});
NavItem.displayName = "NavItem";

const TagItem = memo(({ tag }: { tag: TagConfig }) => (
    <div className="flex items-center gap-3 px-3 py-2 rounded-lg text-muted-foreground hover:bg-white/30 hover:text-foreground transition-all duration-200 cursor-pointer hover:scale-[1.02]">
        <span className={cn("w-2 h-2 rounded-full", tag.colorClass)} />
        <span className="text-sm font-medium">{tag.label}</span>
    </div>
));
TagItem.displayName = "TagItem";

const ComposeButton = memo(() => (
    <div className="p-4 mt-auto">
        <button
            className={cn(
                "w-full flex items-center justify-center gap-2",
                "bg-primary text-primary-foreground", // Use semantic primary color
                "py-2.5 rounded-2xl shadow-lg shadow-primary/20", // Rounded-2xl as requested
                "hover:bg-primary/90 hover:shadow-primary/30 active:scale-[0.98]",
                "transition-all duration-200 font-medium text-sm"
            )}
        >
            <Pencil className="w-[18px] h-[18px]" strokeWidth={2.5} />
            Compose
        </button>
    </div>
));
ComposeButton.displayName = "ComposeButton";

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
            {/* 1. User Profile */}
            <UserProfile />

            {/* 2. Navigation List */}
            <nav className="flex-1 px-3 space-y-1 overflow-y-auto custom-scrollbar">
                {NAV_ITEMS.map((item) => (
                    <NavItem key={item.label} item={item} />
                ))}

                {/* 3. Tags Section */}
                <div className="mt-8 px-3">
                    <h3 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-3">
                        Tags
                    </h3>
                    <div className="space-y-1">
                        {TAG_ITEMS.map((tag) => (
                            <TagItem key={tag.label} tag={tag} />
                        ))}
                    </div>
                </div>
            </nav>

            {/* 4. Compose Action */}
            <ComposeButton />
        </aside>
    );
};

export default Sidebar;
