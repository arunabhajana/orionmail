"use client";

import React, { memo } from "react";
import { cn } from "@/lib/utils";
import { NavItemConfig, TagConfig } from "@/lib/types";

export const NavItem = memo(({ icon: Icon, label, id, badge, highlight, onClick }: NavItemConfig & { onClick?: () => void }) => (
    <button
        onClick={onClick}
        className={cn(
            "w-full flex items-center gap-3 pl-4 pr-3 py-2 rounded-lg text-sm transition-all duration-200 outline-none items-center",
            highlight
                ? "bg-white/60 dark:bg-white/10 text-foreground dark:text-white/90 font-medium shadow-sm ring-1 ring-black/5 dark:ring-white/5" // Active state
                : "text-muted-foreground dark:text-white/60 font-medium hover:text-foreground dark:hover:text-white/90 hover:bg-white/40 dark:hover:bg-white/5" // Inactive state
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
                    ? "bg-white/50 dark:bg-white/20 text-foreground dark:text-white/90"
                    : "text-muted-foreground/70 dark:text-white/40"
            )}>
                {badge}
            </span>
        )}
    </button>
));
NavItem.displayName = "NavItem";

export const TagItem = memo(({ label, colorClass }: TagConfig) => (
    <button className="w-full flex items-center gap-3 pl-4 pr-3 py-2 rounded-lg text-sm font-medium text-muted-foreground dark:text-white/60 hover:text-foreground dark:hover:text-white/90 hover:bg-white/40 dark:hover:bg-white/5 transition-all duration-200">
        <span className={cn("w-2.5 h-2.5 rounded-full ring-1 ring-black/5", colorClass)} />
        <span className="truncate">{label}</span>
    </button>
));
TagItem.displayName = "TagItem";
