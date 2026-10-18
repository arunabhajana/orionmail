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
import { useAppPreferences } from "./AppPreferencesContext";
import Link from "next/link"; // Import Link for navigation

import { UserProfile } from "./sidebar/UserProfile";
import { NavItem, TagItem } from "./sidebar/SidebarNavItem";
import { NavItemConfig, Tag } from "@/lib/types";
import { invoke } from "@tauri-apps/api/core";
import { Plus, ChevronDown } from "lucide-react";

// --- Types ---

export interface TagNode {
    basename: string;
    fullPath: string;
    tag?: Tag;
    children: TagNode[];
}

function buildTagTree(tags: Tag[]): TagNode[] {
    const rootNodes: TagNode[] = [];
    const nodeMap = new Map<string, TagNode>();

    const sortedTags = [...tags].sort((a, b) => a.name.localeCompare(b.name));

    for (const tag of sortedTags) {
        const parts = tag.name.split('/');
        let currentPath = '';
        let parentNode: TagNode | null = null;

        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            const isLast = i === parts.length - 1;
            currentPath = currentPath ? `${currentPath}/${part}` : part;

            if (!nodeMap.has(currentPath)) {
                const newNode: TagNode = {
                    basename: part,
                    fullPath: currentPath,
                    tag: isLast ? tag : undefined,
                    children: [],
                };
                nodeMap.set(currentPath, newNode);

                if (parentNode) {
                    parentNode.children.push(newNode);
                } else {
                    rootNodes.push(newNode);
                }
            }
            parentNode = nodeMap.get(currentPath)!;
            
            if (isLast && !parentNode.tag) {
                parentNode.tag = tag;
            }
        }
    }
    
    return rootNodes;
}

const TagTreeList = ({ nodes, currentFolder, onFolderSelect, onEditTagClick, onDeleteTagClick, depth = 0 }: { nodes: TagNode[], currentFolder?: string, onFolderSelect?: (folder: string) => void, onEditTagClick?: (tag: Tag) => void, onDeleteTagClick?: (tag: Tag) => void, depth?: number }) => {
    return (
        <div className="space-y-0.5">
            {nodes.map((node, index) => (
                <TagTreeNode 
                    key={node.fullPath} 
                    node={node} 
                    currentFolder={currentFolder} 
                    onFolderSelect={onFolderSelect} 
                    onEditTagClick={onEditTagClick} 
                    onDeleteTagClick={onDeleteTagClick}
                    depth={depth} 
                    isFirst={index === 0} 
                    isLast={index === nodes.length - 1} 
                />
            ))}
        </div>
    );
};

const TagTreeNode = ({ node, currentFolder, onFolderSelect, onEditTagClick, onDeleteTagClick, depth = 0, isFirst = false, isLast = false }: { node: TagNode, currentFolder?: string, onFolderSelect?: (folder: string) => void, onEditTagClick?: (tag: Tag) => void, onDeleteTagClick?: (tag: Tag) => void, depth?: number, isFirst?: boolean, isLast?: boolean }) => {
    const [isCollapsed, setIsCollapsed] = useState(false);
    const hasChildren = node.children.length > 0;

    return (
        <div className="flex flex-col relative">
            {depth > 0 && (
                <>
                    <div className="absolute border-l border-black/10 dark:border-white/10 pointer-events-none z-0" 
                         style={{ 
                             left: '11px', 
                             top: isFirst ? '-18px' : '-2px',
                             bottom: isLast ? 'calc(100% - 16px)' : '-2px' 
                         }} 
                    />
                    <div className="absolute border-t border-black/10 dark:border-white/10 pointer-events-none z-0"
                         style={{
                             left: '11px',
                             top: '16px',
                             width: '15px'
                         }}
                    />
                </>
            )}
            {node.tag ? (
                <TagItem 
                    tag={node.tag}
                    basename={node.basename}
                    highlight={currentFolder === `tag:${node.tag.id}`}
                    onClick={() => onFolderSelect?.(`tag:${node.tag!.id}`)}
                    onEdit={onEditTagClick}
                    onDelete={onDeleteTagClick}
                    hasChildren={hasChildren}
                    isCollapsed={isCollapsed}
                    onToggleCollapse={() => setIsCollapsed(!isCollapsed)}
                />
            ) : (
                // Virtual parent
                <div className="w-full flex items-center pr-2 py-1.5 pl-1.5 rounded-lg text-sm font-medium text-muted-foreground dark:text-white/60">
                    <div 
                        className="flex items-center justify-center w-4 h-4 shrink-0 rounded hover:bg-black/10 dark:hover:bg-white/20 transition-colors mr-1 cursor-pointer" 
                        onClick={() => setIsCollapsed(!isCollapsed)}
                    >
                        <ChevronDown className={cn("w-3.5 h-3.5 transition-transform duration-200", isCollapsed && "-rotate-90")} />
                    </div>
                    <span className="w-2.5 h-2.5 rounded-full ring-1 ring-black/5 shrink-0 bg-transparent" />
                    <span className="truncate flex-1 text-left ml-2" title={node.fullPath}>{node.basename}</span>
                </div>
            )}
            
            {hasChildren && !isCollapsed && (
                <div className="ml-5 mt-0.5">
                    <TagTreeList nodes={node.children} currentFolder={currentFolder} onFolderSelect={onFolderSelect} onEditTagClick={onEditTagClick} onDeleteTagClick={onDeleteTagClick} depth={depth + 1} />
                </div>
            )}
        </div>
    );
};

interface SidebarProps {
    className?: string;
    onCompose: () => void;
    onCreateTagClick?: () => void;
    onEditTagClick?: (tag: Tag) => void;
    onDeleteTagClick?: (tag: Tag) => void;
    currentFolder?: string;
    onFolderSelect?: (folder: string) => void;
    unreadCounts?: Record<string, number>;
}

// --- Constants ---

const NAV_ITEMS: NavItemConfig[] = [
    { icon: Inbox, label: "Inbox", id: "inbox" },
    { icon: Star, label: "Starred", id: "starred" },
    { icon: Send, label: "Sent", id: "sent" },
    { icon: File, label: "Drafts", id: "drafts" },
    { icon: Trash2, label: "Trash", id: "trash" },
];

const Sidebar: React.FC<SidebarProps> = ({ className, onCompose, onCreateTagClick, onEditTagClick, onDeleteTagClick, currentFolder, onFolderSelect, unreadCounts }) => {
    const { preferences } = useAppPreferences();
    const [tags, setTags] = useState<Tag[]>([]);

    React.useEffect(() => {
        const fetchTags = () => invoke<Tag[]>("get_all_tags").then(setTags).catch(console.error);
        fetchTags();
        
        import("@tauri-apps/api/event").then(({ listen }) => {
            const unlisten = listen("mail:tags_updated", fetchTags);
            return () => unlisten.then(f => f());
        }).catch(console.error);
    }, []);
    return (
        <aside
            className={cn(
                // Glassmorphism Base
                "flex flex-col h-full border-r",
                "bg-white/40 dark:bg-[#1C1C21]/45 backdrop-blur-3xl border-white/20 dark:border-white/5 transition-colors relative overflow-hidden",     // Light & Dark Mode
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
                                badge={preferences.showUnreadCount ? (unreadCounts?.[item.id] && unreadCounts[item.id] > 0 ? unreadCounts[item.id] : item.badge) : undefined}
                                highlight={currentFolder === item.id}
                                onClick={() => onFolderSelect?.(item.id)}
                            />
                        ))}
                    </div>

                    {/* 3. Tags Section */}
                    <div className="mt-6">
                        <div className="flex items-center justify-between pl-4 pr-0 mb-2 group">
                            <h3 className="text-xs font-semibold text-muted-foreground/50 dark:text-white/40 uppercase tracking-wider">
                                Tags
                            </h3>
                            <button
                                onClick={onCreateTagClick}
                                className="p-1 text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-white rounded hover:bg-black/5 dark:hover:bg-white/10 opacity-0 group-hover:opacity-100 transition-all"
                                title="Create new tag"
                            >
                                <Plus className="w-4 h-4" />
                            </button>
                        </div>
                        <div className="space-y-1">
                            <TagTreeList 
                                nodes={buildTagTree(tags.filter(t => t.tag_type === 'user'))}
                                currentFolder={currentFolder}
                                onFolderSelect={onFolderSelect}
                                onEditTagClick={onEditTagClick}
                                onDeleteTagClick={onDeleteTagClick}
                            />
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
