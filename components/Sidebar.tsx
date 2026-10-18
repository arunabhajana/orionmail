"use client";

import React, { useState } from "react";
import { Inbox, Send, File, Trash2, Star, Pencil, Plus, ChevronDown, Tags } from 'lucide-react';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { useAppPreferences } from './AppPreferencesContext';
import { UserProfile } from './sidebar/UserProfile';
import { NavItem, TagItem } from './sidebar/SidebarNavItem';
import { NavItemConfig, Tag } from '@/lib/types';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

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
                    isLast={index === nodes.length - 1} 
                />
            ))}
        </div>
    );
};

const TagTreeNode = ({ node, currentFolder, onFolderSelect, onEditTagClick, onDeleteTagClick, depth = 0, isLast = false }: { node: TagNode, currentFolder?: string, onFolderSelect?: (folder: string) => void, onEditTagClick?: (tag: Tag) => void, onDeleteTagClick?: (tag: Tag) => void, depth?: number, isLast?: boolean }) => {
    const [isCollapsed, setIsCollapsed] = useState(false);
    const hasChildren = node.children.length > 0;

    return (
        <div className="flex flex-col relative">
            {depth > 0 && <>
                <span aria-hidden="true" className="pointer-events-none absolute -left-3 top-0 border-l border-black/15 dark:border-white/15" style={{ bottom: isLast ? 'calc(100% - 17px)' : '-2px' }} />
                <span aria-hidden="true" className="pointer-events-none absolute -left-3 top-[17px] w-6 border-t border-black/15 dark:border-white/15" />
            </>}
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
                    <button type="button" aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${node.basename}`} aria-expanded={!isCollapsed}
                        className="flex items-center justify-center w-4 h-4 shrink-0 rounded hover:bg-black/10 dark:hover:bg-white/20 transition-colors mr-1 cursor-pointer" 
                        onClick={() => setIsCollapsed(!isCollapsed)}
                    >
                        <ChevronDown className={cn("w-3.5 h-3.5 transition-transform duration-200", isCollapsed && "-rotate-90")} />
                    </button>
                    <span className="w-2.5 h-2.5 rounded-full ring-1 ring-black/5 shrink-0 bg-transparent" />
                    <span className="truncate flex-1 text-left ml-2" title={node.fullPath}>{node.basename}</span>
                </div>
            )}
            
            {hasChildren && !isCollapsed && (
                <div className="relative ml-4 pl-3">
                    <span aria-hidden="true" className="pointer-events-none absolute left-0 -top-[13px] h-[13px] border-l border-black/15 dark:border-white/15" />
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
    const compactTags = React.useRef<HTMLDetailsElement>(null);
    React.useEffect(() => {
        const closeOutside = (event: PointerEvent) => { if (compactTags.current?.open && !compactTags.current.contains(event.target as Node)) compactTags.current.open = false; };
        const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && compactTags.current?.open) { compactTags.current.open = false; compactTags.current.querySelector('summary')?.focus(); } };
        document.addEventListener('pointerdown', closeOutside);
        document.addEventListener('keydown', escape);
        return () => { document.removeEventListener('pointerdown', closeOutside); document.removeEventListener('keydown', escape); };
    }, []);

    React.useEffect(() => {
        let active = true;
        let unlisten: (() => void) | undefined;
        const refresh = () => { void invoke<Tag[]>('get_all_tags').then(value => { if (active) setTags(value); }).catch(console.error); };
        refresh();
        void listen('mail:tags_updated', refresh).then(stop => { if (active) unlisten = stop; else stop(); }).catch(console.error);
        return () => { active = false; unlisten?.(); };
    }, []);
    return <aside aria-label="Mailbox navigation" className={cn('mail-sidebar flex h-full shrink-0 flex-col', className)}>
        <div className="mail-pane-topbar gap-2.5 !justify-start"><Image src="/logo.svg" alt="" width={28} height={28} unoptimized className="shrink-0" /><span className="mail-brand-label text-sm font-semibold tracking-tight">OrionMail</span></div>
        <div className="px-3 pb-5 pt-3"><button type="button" onClick={onCompose} aria-label="Compose a message" title="Compose a message (Ctrl+N)" className="mail-compose-button"><Pencil className="size-4 shrink-0" /><span className="mail-nav-label">Compose</span></button></div>
        <details ref={compactTags} className="mail-compact-tags"><summary aria-label="Browse tags" title="Browse tags"><Tags className="size-[18px]" /></summary><div className="mail-compact-tag-popover"><p className="mb-2 px-3 text-xs font-medium">Tags</p>{tags.some(tag => tag.tag_type === 'user') ? <TagTreeList nodes={buildTagTree(tags.filter(tag => tag.tag_type === 'user'))} currentFolder={currentFolder} onFolderSelect={folder => { if (compactTags.current) compactTags.current.open = false; onFolderSelect?.(folder); }} onEditTagClick={onEditTagClick} onDeleteTagClick={onDeleteTagClick} /> : <p className="px-3 py-2 text-xs text-muted-foreground">No tags yet.</p>}<button type="button" onClick={() => { if (compactTags.current) compactTags.current.open = false; onCreateTagClick?.(); }} className="mail-profile-action mt-2"><Plus className="size-4" />Create tag</button></div></details>
        <nav aria-label="Mail folders" className="mail-sidebar-scroll min-h-0 flex-1 overflow-y-auto px-3 custom-scrollbar">
            <p className="mail-nav-caption mb-2 px-3 text-[10px] font-medium text-muted-foreground">Mailboxes</p>
            <div className="space-y-1">{NAV_ITEMS.map(item => <NavItem key={item.id} {...item} badge={preferences.showUnreadCount ? unreadCounts?.[item.id] : undefined} highlight={currentFolder === item.id} onClick={() => onFolderSelect?.(item.id)} />)}</div>
            <div className="mail-tags-section mt-7"><div className="mb-2 flex items-center justify-between pl-3"><h2 className="text-[10px] font-medium text-muted-foreground">Tags</h2><button type="button" onClick={onCreateTagClick} disabled={!onCreateTagClick} className="mail-icon-button !size-6" aria-label="Create tag" title="Create tag"><Plus className="size-3.5" /></button></div>
                {tags.some(tag => tag.tag_type === 'user') ? <TagTreeList nodes={buildTagTree(tags.filter(tag => tag.tag_type === 'user'))} currentFolder={currentFolder} onFolderSelect={onFolderSelect} onEditTagClick={onEditTagClick} onDeleteTagClick={onDeleteTagClick} /> : <p className="px-3 py-2 text-[11px] text-muted-foreground/70">Your tags will appear here.</p>}
            </div>
        </nav>
        <footer className="mt-3 shrink-0 border-t border-black/[0.05] px-3 pb-3 pt-2 dark:border-white/[0.06]"><UserProfile /></footer>
    </aside>;
};
export default Sidebar;
