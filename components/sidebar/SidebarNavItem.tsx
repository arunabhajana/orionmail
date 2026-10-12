"use client";

import React, { memo } from "react";
import { cn } from "@/lib/utils";
import { NavItemConfig, Tag } from "@/lib/types";

export const NavItem = memo(({ icon: Icon, label, id, badge, highlight, onClick }: NavItemConfig & { onClick?: () => void }) => (
    <button
        data-context-menu={['inbox', 'sent', 'starred'].includes(id) ? 'folder' : undefined}
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

import { useState } from "react";
import { MoreHorizontal, ChevronDown, Edit2, Trash2 } from "lucide-react";

export const TagItem = memo(({ 
    tag, 
    basename, 
    highlight, 
    onClick, 
    onEdit,
    onDelete,
    hasChildren,
    isCollapsed,
    onToggleCollapse
}: { 
    tag: Tag, 
    basename?: string, 
    highlight?: boolean, 
    onClick?: () => void, 
    onEdit?: (tag: Tag) => void,
    onDelete?: (tag: Tag) => void,
    hasChildren?: boolean,
    isCollapsed?: boolean,
    onToggleCollapse?: () => void
}) => {
    const [isHovered, setIsHovered] = useState(false);

    return (
        <div 
            data-context-menu="tag"
            className="flex flex-col"
            onMouseEnter={() => setIsHovered(true)} 
            onMouseLeave={() => setIsHovered(false)}
        >
            <button 
                data-context-menu="tag"
                onClick={onClick} 
                className={cn("w-full flex items-center pr-2 py-1.5 pl-1.5 rounded-lg text-sm transition-all duration-200 outline-none group", 
                    highlight ? "bg-white/60 dark:bg-white/10 text-foreground dark:text-white/90 font-medium shadow-sm ring-1 ring-black/5 dark:ring-white/5" 
                              : "font-medium text-muted-foreground dark:text-white/60 hover:text-foreground dark:hover:text-white/90 hover:bg-white/40 dark:hover:bg-white/5")}
            >
                <div 
                    className="flex items-center justify-center w-4 h-4 shrink-0 rounded hover:bg-black/10 dark:hover:bg-white/20 transition-colors mr-1"
                    onClick={(e) => {
                        if (hasChildren) {
                            e.stopPropagation();
                            onToggleCollapse?.();
                        }
                    }}
                >
                    {hasChildren && (
                        <ChevronDown className={cn("w-3.5 h-3.5 text-muted-foreground transition-transform duration-200", isCollapsed && "-rotate-90")} />
                    )}
                </div>

                <span className="w-2.5 h-2.5 rounded-full ring-1 ring-black/5 shrink-0" style={{ backgroundColor: tag.bg_color || '#9ca3af' }} />
                
                <span className="truncate flex-1 text-left ml-2" title={tag.name}>{basename || tag.name}</span>
                
                {isHovered && (
                    <div className="flex items-center shrink-0 ml-1">
                        <div 
                            className="p-1 rounded-md hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                            onClick={(e) => {
                                e.stopPropagation();
                                if (onEdit) onEdit(tag);
                            }}
                            title="Edit tag"
                        >
                            <Edit2 className="w-4 h-4 text-muted-foreground" />
                        </div>
                        {onDelete && (
                            <div 
                                className="p-1 rounded-md hover:bg-red-500/10 transition-colors group/delete"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onDelete(tag);
                                }}
                                title="Delete tag"
                            >
                                <Trash2 className="w-4 h-4 text-muted-foreground group-hover/delete:text-red-500" />
                            </div>
                        )}
                    </div>
                )}
            </button>
        </div>
    );
});
TagItem.displayName = "TagItem";
