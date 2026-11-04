"use client";

import React, { useState } from "react";
import { Inbox, Send, File, Trash2, Clock, Star, Mail, RefreshCw, Pencil, Plus, ChevronDown, Tags, Settings,SendHorizontal } from 'lucide-react';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { useAppPreferences } from './AppPreferencesContext';
import {SidebarHint} from './sidebar/SidebarHint';
import {AccountList} from './accounts/AccountList';
import {useRouter} from 'next/navigation';
import {MAX_CONNECTED_ACCOUNTS,ACCOUNT_LIMIT_MESSAGE} from '@/lib/account-policy';
import { NavItem, TagItem } from './sidebar/SidebarNavItem';
import { NavItemConfig, Tag } from '@/lib/types';
import { useAccountInvoke } from '@/hooks/useAccountInvoke';
import { listen } from '@tauri-apps/api/event';
import {useMailboxView} from './MailboxViewContext';
import {toast} from 'sonner';
import { useAuth } from './AuthContext';
import {useSync} from './SyncContext';
import {useMailboxCommands} from './CommandPalette';
import type {FilterType} from './inbox/EmailListHeader';

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
                    <SidebarHint label={`${isCollapsed ? "Expand" : "Collapse"} ${node.basename}`}><button type="button" aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${node.basename}`} aria-expanded={!isCollapsed}
                        className="flex items-center justify-center w-4 h-4 shrink-0 rounded hover:bg-black/10 dark:hover:bg-white/20 transition-colors mr-1 cursor-pointer" 
                        onClick={() => setIsCollapsed(!isCollapsed)}
                    >
                        <ChevronDown className={cn("w-3.5 h-3.5 transition-transform duration-200", isCollapsed && "-rotate-90")} />
                    </button></SidebarHint>
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
    unifiedFilter?: FilterType;
    onUnifiedFilterSelect?: (filter: FilterType) => void;
}

// --- Constants ---

const NAV_ITEMS: NavItemConfig[] = [
    { icon: Inbox, label: "Inbox", id: "inbox" },
    { icon: Clock, label: "Snoozed", id: "snoozed" },
    { icon: Star, label: "Starred", id: "starred" },
    { icon: Send, label: "Sent", id: "sent" },
    { icon: File, label: "Drafts", id: "drafts" },
    { icon: SendHorizontal, label: "Outbox", id: "outbox" },
    { icon: Trash2, label: "Trash", id: "trash" },
];

const Sidebar: React.FC<SidebarProps> = ({ className, onCompose, onCreateTagClick, onEditTagClick, onDeleteTagClick, currentFolder, onFolderSelect, unreadCounts, unifiedFilter='all', onUnifiedFilterSelect }) => {

    const invoke = useAccountInvoke();
    const { user,accounts,accountBusy,switchAccount,addGoogleAccount } = useAuth(); const view=useMailboxView();    const { preferences } = useAppPreferences();
    const router=useRouter();
    const {isSyncing,triggerSync}=useSync();
    const openSettings=()=>{if(user)void switchAccount(user.id,true).then(()=>router.push('/settings')).catch(error=>toast.error('Could not open settings',{description:String(error)}));};
    const folderOpening=React.useRef(false);
    const openAccountFolder=async(owner:string,folder:string)=>{
        if(accountBusy||folderOpening.current)return;
        folderOpening.current=true;
        const token=view.requestNavigation(owner,folder);
        try{await switchAccount(owner,true);if(token)view.authorizeNavigation(token);view.setFolder('');view.setUnified(false);}
        catch(error){if(token)view.completeNavigation(token);toast.error('Could not open folder',{description:String(error)});}
        finally{folderOpening.current=false;}
    };
    const [tags, setTags] = useState<Tag[]>([]);
    useMailboxCommands(()=>!user||accountBusy?[]:tags.filter(tag=>tag.tag_type==='user').map(tag=>({id:`tag.${user.id}.${tag.id}`,label:'Go to tag '+tag.name,group:'Tags',keywords:'folder '+tag.name,icon:Tags,run:()=>onFolderSelect?.('tag:'+tag.id)})));
    const compactTags = React.useRef<HTMLDetailsElement>(null);
    React.useEffect(() => {
        const closeOutside = (event: PointerEvent) => { if (compactTags.current?.open && !compactTags.current.contains(event.target as Node)) compactTags.current.open = false; };
        const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && compactTags.current?.open) { compactTags.current.open = false; compactTags.current.querySelector('summary')?.focus(); } };
        document.addEventListener('pointerdown', closeOutside);
        document.addEventListener('keydown', escape);
        return () => { document.removeEventListener('pointerdown', closeOutside); document.removeEventListener('keydown', escape); };
    }, []);

    React.useEffect(() => {
        if(view.unified)return;
        let active = true;
        let unlisten: (() => void) | undefined;
        const refresh = () => { void invoke<Tag[]>('get_all_tags').then(value => { if (active) setTags(value); }).catch(console.error); };
        refresh();
        void listen<string>('mail:tags_updated', event => { if (event.payload === user?.id) refresh(); }).then(stop => { if (active) unlisten = stop; else stop(); }).catch(console.error);
        return () => { active = false; unlisten?.(); };
    }, [invoke, user?.id,view.unified]);
    return <aside aria-label="Mailbox navigation" className={cn('mail-sidebar flex h-full shrink-0 flex-col', className)}>
        <div className="mail-pane-topbar gap-3 !justify-center"><Image src="/logo-transparent.svg" alt="" width={36} height={36} unoptimized className="shrink-0 -translate-y-[4px]" /><span className="mail-brand-label text-lg font-semibold tracking-tight">OrionMail</span></div>
        <div className="px-3 pb-4 pt-3"><SidebarHint label="Compose a message (Ctrl+N)" className="w-full"><button type="button" onClick={onCompose} aria-label="Compose a message" className="mail-compose-button"><Pencil className="size-4 shrink-0" /><span className="mail-nav-label">Compose</span></button></SidebarHint></div>
        {!view.unified&&<SidebarHint label="Browse tags" className="w-full"><details ref={compactTags} className="mail-compact-tags min-w-0 flex-1"><summary aria-label="Browse tags"><Tags className="size-[18px]" /></summary><div className="mail-compact-tag-popover"><p className="mb-2 px-3 text-xs font-medium">Tags</p>{tags.some(tag => tag.tag_type === 'user') ? <TagTreeList nodes={buildTagTree(tags.filter(tag => tag.tag_type === 'user'))} currentFolder={currentFolder} onFolderSelect={folder => { if (compactTags.current) compactTags.current.open = false; onFolderSelect?.(folder); }} onEditTagClick={onEditTagClick} onDeleteTagClick={onDeleteTagClick} /> : <p className="px-3 py-2 text-xs text-muted-foreground">No tags yet.</p>}<SidebarHint label="Create tag" className="w-full"><button type="button" onClick={() => { if (compactTags.current) compactTags.current.open = false; onCreateTagClick?.(); }} className="mail-profile-action mt-2"><Plus className="size-4" />Create tag</button></SidebarHint></div></details></SidebarHint>}
        <div className="mail-sidebar-scroll min-h-0 flex-1 overflow-y-auto px-3 pb-3 custom-scrollbar">
            <section aria-label="Choose mailbox" className="mail-sidebar-accounts">
                <div className="mail-account-heading mb-1.5 flex items-center justify-between px-2"><h2 className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Accounts</h2><SidebarHint label={accounts.length>=MAX_CONNECTED_ACCOUNTS?ACCOUNT_LIMIT_MESSAGE:'Add Google account'}><button type="button" aria-label="Add Google account" disabled={accountBusy||accounts.length>=MAX_CONNECTED_ACCOUNTS} className="mail-icon-button" onClick={()=>{void addGoogleAccount().catch(error=>toast.error('Could not add account',{description:String(error)}));}}><Plus className="size-4"/></button></SidebarHint></div>
                <AccountList variant="sidebar"/>
            </section>
            {!view.unified ? <nav aria-label="Mail folders" className="mt-4"><h2 className="mail-nav-caption mb-2 px-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Folders</h2>
                <div className="space-y-1">{NAV_ITEMS.map(item=><NavItem key={item.id} {...item} hint={accounts.length>1?`${item.label} · ${user?.email}`:undefined} badge={preferences.showUnreadCount?unreadCounts?.[item.id]:undefined} highlight={currentFolder===item.id} onClick={()=>onFolderSelect?.(item.id)}/>)}</div>
                <div className="mail-tags-section mt-4"><div className="mb-2 flex items-center justify-between pl-3"><h2 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Tags</h2><SidebarHint label="Create tag"><button type="button" onClick={onCreateTagClick} disabled={!onCreateTagClick} className="mail-icon-button !size-6" aria-label="Create tag"><Plus className="size-3.5"/></button></SidebarHint></div>
                    {tags.some(tag=>tag.tag_type==='user')?<TagTreeList nodes={buildTagTree(tags.filter(tag=>tag.tag_type==='user'))} currentFolder={currentFolder} onFolderSelect={onFolderSelect} onEditTagClick={onEditTagClick} onDeleteTagClick={onDeleteTagClick}/>:<p className="px-3 py-2 text-[11px] text-muted-foreground/70">Your tags will appear here.</p>}
                </div>
            </nav> : <nav aria-label="Combined inbox views" className="mt-4">
                <h2 className="mail-nav-caption mb-2 px-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Inbox views</h2>
                <NavItem id="combined-all" icon={Inbox} label="All mail" highlight={unifiedFilter==='all'} onClick={()=>onUnifiedFilterSelect?.('all')}/>
                <NavItem id="combined-unread" icon={Mail} label="Unread" highlight={unifiedFilter==='unread'} onClick={()=>onUnifiedFilterSelect?.('unread')}/>
                <NavItem id="combined-starred" icon={Star} label="Starred" highlight={unifiedFilter==='flagged'} onClick={()=>onUnifiedFilterSelect?.('flagged')}/>
                <section aria-label="Account folders" className="mail-tags-section mt-2 border-t border-border/50 pt-2">
                    <h2 className="mb-2 px-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Account folders</h2>
                    <div className="space-y-2">{accounts.map(account=><details key={account.id} className="group/account rounded-xl bg-foreground/[0.025] p-2"><summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-2 py-1.5 outline-none hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-primary [&::-webkit-details-marker]:hidden"><span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium" title={account.email}>{account.name||account.email}</span>
                        <span className="mt-0.5 block truncate text-[10px] text-muted-foreground" title={account.email}>{account.email}</span></span><ChevronDown aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open/account:rotate-180 motion-reduce:transition-none"/></summary><div className="mt-1 space-y-0.5">{NAV_ITEMS.filter(item=>['sent','drafts','outbox','snoozed'].includes(item.id)).map(item=><NavItem key={item.id} {...item} hint={item.label+' · '+account.email} onClick={()=>{void openAccountFolder(account.id,item.id);}}/>)}</div>
                    </details>)}</div>
                </section>
            </nav>}

        </div>
        <footer aria-label="Quick access" className="mail-sidebar-footer shrink-0 border-t border-black/[0.05] px-3 py-2.5 dark:border-white/[0.06]">
            <SidebarHint label="Settings and accounts" className="min-w-0 flex-1"><button type="button" onClick={openSettings} disabled={accountBusy} className="mail-footer-settings mail-nav-item" aria-label="Settings"><Settings className="size-4 shrink-0"/><span className="mail-nav-label">Settings</span></button></SidebarHint>
            <SidebarHint label={isSyncing?'Syncing mail…':view.unified?'Sync all inboxes':'Sync this account'}><button type="button" aria-label={view.unified?'Sync all inboxes':'Sync this account'} disabled={accountBusy||isSyncing} onClick={triggerSync} className="mail-icon-button"><RefreshCw className={cn('size-4',isSyncing&&'animate-spin motion-reduce:animate-none')}/></button></SidebarHint>

        </footer>
    </aside>;
};
export default Sidebar;
