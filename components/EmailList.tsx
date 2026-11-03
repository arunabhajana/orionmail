"use client";

import React from 'react';
import { Search, RefreshCw, Mailbox, CheckCircle2, Flag } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Email } from '@/lib/types';
import { motion } from 'framer-motion';
import { SearchBar, FilterTabs, FilterType, SearchProgressData } from './inbox/EmailListHeader';
import { EmailListItem } from './inbox/EmailListItem';
import { useVirtualEmailList } from '@/hooks/useVirtualEmailList';
import OrbitLoader from './inbox/OrbitLoader';
import { useAccountInvoke } from '@/hooks/useAccountInvoke';
import { PendingSentMessage } from '@/hooks/usePendingSentMessages';
import { PendingEmailListItem } from './inbox/PendingEmailListItem';
import { EmailContextMenu, EmailContextMenuState } from './inbox/EmailContextMenu';
import { MessageTagPicker } from './inbox/MessageTagPicker';
import { Tag } from '@/lib/types';
import { useAppPreferences } from './AppPreferencesContext';
import { listen } from '@tauri-apps/api/event';
import {useVisibleMailLabels} from '@/hooks/useVisibleMailLabels';
import {useAccountIdentities} from './accounts/AccountIdentityControls';
import {useAuth} from './AuthContext';
import {pinnedFirst} from '@/lib/mail-pins';
import {groupConversations} from '@/lib/conversations';

// Global cache states removed as predictive prefetch happens in Rust backend now

// --- Types ---

interface EmailListProps {
    unified?:boolean;
    filter?:FilterType;
    onFilterChange?:(filter:FilterType)=>void;
    tagsByAccount?:Record<string,Record<string,Tag>>;
    onManageTags?:(id:string)=>void;
    statusBanner?: React.ReactNode;
    className?: string;
    emails: Email[];
    selectedEmailId: string | null;
    onSelectEmail: (id: string) => void;
    onReply?: (id:string)=>void;
    onTogglePin?:(id:string)=>void;
    onNewToSender?:(id:string)=>void;
    onSnooze?:(id:string)=>void;
    onUnsnooze?:(id:string)=>void;
    onReplyAll?: (id:string)=>void;
    onForward?: (id:string)=>void;
    onToggleStar?: (emailId: string) => void;
    onToggleRead?: (emailId: string) => void;
    onDeleteMessage?: (emailId: string) => void;
    onRestoreMessage?: (emailId: string) => void;
    onSync?: () => void;
    isSyncing?: boolean;
    isLoading?: boolean;
    onLoadMore?: () => void;
    hasMore?: boolean;
    isLoadingMore?: boolean;
    listRef?: React.Ref<HTMLDivElement>;
    currentFolder?: string;
    pendingMessages?: PendingSentMessage[];
    searchQuery?: string;
    onSearchQueryChange?: (query: string) => void;
    onSearchClear?: () => void;
    searchProgress?: SearchProgressData | null;
    onSearchLoadMore?: () => void;
    onAddTags?: (email: Email, addIds: string[], removeIds: string[]) => void;
}

// --- Constants ---

// --- Main Component ---

const EmailList: React.FC<EmailListProps> = ({
    unified=false,filter:externalFilter,onFilterChange,tagsByAccount,onManageTags,
    statusBanner,
    className,
    emails,
    selectedEmailId,
    onSelectEmail,
    onReply,
    onTogglePin,
    onNewToSender,
    onSnooze,
    onUnsnooze,
    onReplyAll,
    onForward,
    onToggleStar,
    onToggleRead,
    onDeleteMessage,
    onRestoreMessage,
    onSync,
    isSyncing,
    isLoading = false,
    onLoadMore,
    hasMore,
    isLoadingMore,
    listRef,
    currentFolder,
    pendingMessages = [],
    searchQuery = '',
    onSearchQueryChange,
    onSearchClear,
    searchProgress,
    onSearchLoadMore,
    onAddTags
}) => {

    const identities=useAccountIdentities();
    const invoke = useAccountInvoke();
    const {user,accounts}=useAuth();
    const { preferences:accountPreferences,devicePreferences,overrides } = useAppPreferences();
    const preferences=unified ? devicePreferences||accountPreferences : accountPreferences;
    const [localFilter,setLocalFilter]=React.useState<FilterType>('all');
    const currentFilter=externalFilter??localFilter;
    const setCurrentFilter=(value:FilterType)=>{setLocalFilter(value);onFilterChange?.(value);};
    const [allTags, setAllTags] = React.useState<Record<string, import('@/lib/types').Tag>>({});
    const [contextMenuState, setContextMenuState] = React.useState<EmailContextMenuState | null>(null);
    const [tagPickerEmail, setTagPickerEmail] = React.useState<Email | null>(null);

    const latestHandlers = React.useRef({ onSelectEmail, onToggleStar, emails });
    React.useLayoutEffect(() => { latestHandlers.current = { onSelectEmail, onToggleStar, emails }; });
    const selectItem = React.useCallback((id: string) => latestHandlers.current.onSelectEmail(id), []);
    const starItem = React.useCallback((id: string) => latestHandlers.current.onToggleStar?.(id), []);
    const itemContextMenu = React.useCallback((event: React.MouseEvent, id: string) => {
        event.preventDefault(); event.stopPropagation();
        const email = latestHandlers.current.emails.find(email => email.id === id);
        if (email) setContextMenuState({ x: event.clientX, y: event.clientY, emailId: id, unread: Boolean(email.unread) });
    }, []);


    React.useEffect(() => {
        if(unified)return;
        let active = true;
        let stop: (() => void) | undefined;
        const refresh = () => { void invoke<Tag[]>('get_all_tags').then(tags => { if (active) setAllTags(Object.fromEntries(tags.map(tag => [tag.id, tag]))); }).catch(console.error); };
        refresh();
        void listen<string>('mail:tags_updated', event => { if (event.payload === user?.id) refresh(); }).then(unlisten => { if (active) stop = unlisten; else unlisten(); }).catch(console.error);
        return () => { active = false; stop?.(); };
    }, [invoke, user?.id, unified]);

    const displayedEmails = React.useMemo(() => {
        const rows=unified ? [...new Set(emails.map(email=>email.accountId))].flatMap(owner=>{const owned=emails.filter(email=>email.accountId===owner);return (owner ? overrides?.[owner]?.conversationView : undefined)??devicePreferences?.conversationView??true ? groupConversations(owned) : owned;}) : preferences.conversationView ? groupConversations(emails) : emails;
        const grouped=currentFolder==='snoozed'?[...rows].sort((a,b)=>(a.snoozedUntil||Infinity)-(b.snoozedUntil||Infinity)):pinnedFirst(rows);
        const unread = new Set(emails.filter(item=>item.unread).map(item=>item.id));
        const starred = new Set(emails.filter(item=>item.starred).map(item=>item.id));
        switch (currentFilter) {
            case 'unread': return grouped.filter(e => (e.conversationIds || [e.id]).some(id=>unread.has(id)));
            case 'flagged': return grouped.filter(e => (e.conversationIds || [e.id]).some(id=>starred.has(id)));
            default: return grouped;
        }
    }, [emails, currentFilter, preferences.conversationView, currentFolder, unified,overrides,devicePreferences?.conversationView]);

    const getItemKey = React.useCallback((index: number) => displayedEmails[index]?.id || index, [displayedEmails]);
    const { parentRef, rowVirtualizer, virtualItems } = useVirtualEmailList({
        itemCount: displayedEmails.length,
        hasMore,
        isLoadingMore,
        onLoadMore: searchQuery ? (onSearchLoadMore || onLoadMore) : onLoadMore,
        listRef,
        getItemKey,
    });

    const viewportStart = rowVirtualizer.scrollOffset ?? 0;
    const viewportEnd = viewportStart + (rowVirtualizer.scrollRect?.height ?? 600);
    const visibleRows = virtualItems.filter(item => item.end >= viewportStart && item.start <= viewportEnd);
    const visibleEmails=visibleRows.map(item=>displayedEmails[item.index]).filter((email):email is Email=>Boolean(email));
    useVisibleMailLabels(user?.id,visibleEmails.filter(email=>!email.accountId||email.accountId===user?.id),!accountPreferences.syncPaused);

    React.useEffect(() => { rowVirtualizer.measure(); }, [preferences.density, preferences.previewLines, preferences.showAvatars, rowVirtualizer]);

    const folderDisplayName = unified ? 'All inboxes' : currentFolder?.startsWith('tag:')
        ? allTags[currentFolder.slice(4)]?.name || 'Tag'
        : currentFolder ? currentFolder.charAt(0).toUpperCase() + currentFolder.slice(1) : 'Mailbox';

    const prefetchRequests = visibleRows
        .map(item => displayedEmails[item.index]).filter(email=>Boolean(email)&&(!email.accountId||email.accountId===user?.id)).slice(0,12)
        .map(email => ({ account_id: user?.id, folder: email.folder, uid: email.uid, uid_validity: email.uidValidity }));
    const prefetchSignature = JSON.stringify(prefetchRequests);
    const lastPrefetch = React.useRef('');
    React.useEffect(() => {
        if (!accountPreferences.prefetchBodies || accountPreferences.syncPaused || !user?.id || prefetchSignature === '[]') return;
        const key = `${user.id}:${prefetchSignature}`;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const schedule = () => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
                if (document.visibilityState !== 'visible' || !document.hasFocus() || !navigator.onLine || key === lastPrefetch.current) return;
                lastPrefetch.current = key;
                void invoke('prefetch_messages', { requests: JSON.parse(prefetchSignature) }).catch(error => {
                    if (lastPrefetch.current === key) lastPrefetch.current = '';
                    console.error(error);
                });
            }, 600);
        };
        const online = () => { lastPrefetch.current = ''; schedule(); };
        const pause = () => {
            if (timer) clearTimeout(timer);
            // Native minimization drops speculative jobs. Revisit the current
            // viewport on return even if its message IDs have not changed.
            lastPrefetch.current = '';
        };
        const visibility = () => document.visibilityState === 'visible' ? schedule() : pause();
        schedule();
        window.addEventListener('focus', schedule);
        window.addEventListener('blur', pause);
        document.addEventListener('visibilitychange', visibility);
        window.addEventListener('online', online);
        return () => {
            if (timer) clearTimeout(timer);
            window.removeEventListener('focus', schedule);
            window.removeEventListener('blur', pause);
            document.removeEventListener('visibilitychange', visibility);
            window.removeEventListener('online', online);
        };
    }, [prefetchSignature, user?.id, accountPreferences.prefetchBodies, accountPreferences.syncPaused, invoke]);

    const pullDistance = React.useRef(0);
    const touchStart = React.useRef(0);

    const handleWheel = (e: React.WheelEvent) => {
        if (parentRef.current && parentRef.current.scrollTop <= 0 && e.deltaY < 0) {
            pullDistance.current -= e.deltaY;
            if (pullDistance.current > 150 && !isSyncing) {
                pullDistance.current = 0;
                onSync?.();
            }
        } else {
            pullDistance.current = 0;
        }
    };

    const handleTouchStart = (e: React.TouchEvent) => {
        if (parentRef.current && parentRef.current.scrollTop <= 0) {
            touchStart.current = e.touches[0].clientY;
        } else {
            touchStart.current = 0;
        }
    };

    const handleTouchMove = (e: React.TouchEvent) => {
        if (touchStart.current > 0 && parentRef.current && parentRef.current.scrollTop <= 0) {
            const delta = e.touches[0].clientY - touchStart.current;
            if (delta > 100 && !isSyncing) {
                touchStart.current = 0;
                onSync?.();
            }
        }
    };

    const handleTouchEnd = () => {
        touchStart.current = 0;
    };

    return (
        <main
            className={cn(
                "mail-list-surface flex min-h-0 flex-col h-full",
                className
            )}
        >
            <div className="shrink-0">
                <div className="mail-pane-topbar"><div className="min-w-0"><h1 className="truncate text-sm font-semibold" title={folderDisplayName}>{folderDisplayName || 'Mailbox'}</h1></div><div className="flex shrink-0 items-center gap-2"><span aria-live="polite" className="text-[10px] tabular-nums text-muted-foreground">{searchQuery ? `${emails.length} found` : `${emails.length} loaded`}</span><button type="button" onClick={() => onSync?.()} disabled={isSyncing || !onSync} aria-label={isSyncing ? 'Syncing mail' : 'Sync mailbox'} title={isSyncing ? 'Syncing mail' : 'Sync mailbox'} className="mail-icon-button"><RefreshCw className={cn('size-4', isSyncing && 'animate-spin text-primary')} /></button></div></div>
                <div className="space-y-3 px-3 pb-3 pt-3"><SearchBar placeholder={unified?'Search downloaded inbox mail…':undefined} value={searchQuery} onChange={onSearchQueryChange} onClear={onSearchClear} searchProgress={searchProgress} /><FilterTabs currentFilter={currentFilter} onFilterChange={setCurrentFilter} /></div>
            </div>
            {statusBanner}
            {pendingMessages.length > 0 && currentFilter === 'all' && !searchQuery && <div role="status" aria-label="Outgoing messages" className="max-h-40 shrink-0 overflow-y-auto border-y border-black/[0.04] px-2 py-1 custom-scrollbar dark:border-white/[0.05]">{pendingMessages.map(message => <PendingEmailListItem key={message.id} pending={message} />)}</div>}

            {/* 2. Scrollable List or Placeholder */}
            {currentFolder === "drafts" ? (
                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.4 }} className="flex-1 flex flex-col items-center justify-center text-center px-4">
                    <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mb-6">
                        <Mailbox className="w-10 h-10 text-primary opacity-80" />
                    </div>
                    <h3 className="text-xl font-semibold text-foreground mb-2">Folder in progress</h3>
                    <p className="text-sm text-muted-foreground max-w-[250px]">
                        This folder will be implemented soon!
                    </p>
                </motion.div>
            ) : searchQuery.trim().length > 0 && emails.length === 0 && (!searchProgress || (searchProgress.state !== 'Completed' && searchProgress.state !== 'Cancelled' && searchProgress.state !== 'OfflineLocalOnly' && searchProgress.state !== 'Failed')) ? (
                // Option 1: Shimmering Search Skeleton shown while searching local/remote or during debounce
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.3 }}
                    className="flex-1 flex flex-col px-3 pt-2 gap-2"
                >
                    <div className="px-3 py-1 text-xs font-medium text-muted-foreground flex items-center gap-2 animate-pulse">
                        <Search className="w-3.5 h-3.5 text-primary" />
                        <span>Scanning mailbox history...</span>
                    </div>
                    {[...Array(6)].map((_, i) => (
                        <div
                            key={i}
                            className="flex items-start gap-3 p-3 rounded-xl bg-white/30 dark:bg-white/5 animate-pulse"
                            style={{ animationDelay: `${i * 80}ms` }}
                        >
                            <div className="w-9 h-9 rounded-full bg-primary/10 dark:bg-primary/20 flex items-center justify-center shrink-0">
                                <Search className="w-4 h-4 text-primary/60" />
                            </div>
                            <div className="flex-1 space-y-2 min-w-0">
                                <div className="flex items-center justify-between gap-2">
                                    <div className="h-3 bg-gray-200/70 dark:bg-white/10 rounded-full w-28" />
                                    <div className="h-2.5 bg-gray-200/50 dark:bg-white/5 rounded-full w-12" />
                                </div>
                                <div className="h-2.5 bg-gray-200/60 dark:bg-white/8 rounded-full w-3/4" />
                                <div className="h-2 bg-gray-200/40 dark:bg-white/5 rounded-full w-1/2" />
                            </div>
                        </div>
                    ))}
                </motion.div>
            ) : searchQuery.trim().length > 0 && emails.length === 0 ? (
                // Option 4: Zero results empty state for Search
                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.4 }} className="flex-1 flex flex-col items-center justify-center text-center px-4">
                    <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mb-6">
                        <Search className="w-10 h-10 text-primary opacity-80" />
                    </div>
                    <h3 className="text-xl font-semibold text-foreground mb-2">{searchProgress?.state === 'Failed' ? 'Search unavailable' : 'No matching messages'}</h3>
                    <p className="text-sm text-muted-foreground max-w-[250px] mb-6">
                        {searchProgress?.state === 'Failed' ? 'Search could not finish. Clear the search and try again.' : <>We couldn&apos;t find anything matching &ldquo;{searchQuery}&rdquo; in {folderDisplayName}.</>}
                    </p>
                    <button
                        onClick={onSearchClear}
                        className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg shadow hover:bg-primary/90 transition-colors"
                    >
                        Clear Search
                    </button>
                </motion.div>
            ) : emails.length === 0 && isLoading ? (
                // Only the initial local read owns the blocking skeleton.
                // Background provider sync must not trap an empty folder here.
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.3 }}
                    className="flex-1 flex flex-col px-3 pt-2 gap-2"
                >
                    {[...Array(7)].map((_, i) => (
                        <div
                            key={i}
                            className="flex items-start gap-3 p-3 rounded-xl bg-white/30 dark:bg-white/5 animate-pulse"
                            style={{ animationDelay: `${i * 80}ms` }}
                        >
                            <div className="w-9 h-9 rounded-full bg-gray-200/70 dark:bg-white/10 shrink-0" />
                            <div className="flex-1 space-y-2 min-w-0">
                                <div className="flex items-center justify-between gap-2">
                                    <div className="h-3 bg-gray-200/70 dark:bg-white/10 rounded-full w-28" />
                                    <div className="h-2.5 bg-gray-200/50 dark:bg-white/5 rounded-full w-12" />
                                </div>
                                <div className="h-2.5 bg-gray-200/60 dark:bg-white/8 rounded-full w-3/4" />
                                <div className="h-2 bg-gray-200/40 dark:bg-white/5 rounded-full w-1/2" />
                            </div>
                        </div>
                    ))}
                </motion.div>
            ) : emails.length === 0 ? (
                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.4 }} className="flex-1 flex flex-col items-center justify-center text-center px-4">
                    <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mb-6">
                        <Mailbox className="w-10 h-10 text-primary opacity-80" />
                    </div>
                    <h3 className="text-xl font-semibold text-foreground mb-2">{pendingMessages.length ? "Waiting for mailbox sync" : isSyncing ? "Checking mailbox…" : currentFolder === 'trash' ? "Trash is empty" : "No messages here"}</h3>
                    <p className="text-sm text-muted-foreground max-w-[250px]">
                        {pendingMessages.length ? "Your outgoing mail is shown above and will appear here after sync." : isSyncing ? "Messages will appear here as they load. You can keep using the app." : `Your ${folderDisplayName} folder is empty.`}
                    </p>
                </motion.div>
            ) : displayedEmails.length === 0 ? (
                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.4 }} className="flex-1 flex flex-col items-center justify-center text-center px-4">
                    <div className={cn(
                        "w-20 h-20 rounded-full flex items-center justify-center mb-6",
                        currentFilter === 'unread' ? "bg-green-500/10" : "bg-amber-500/10"
                    )}>
                        {currentFilter === 'unread' ? (
                            <CheckCircle2 className="w-10 h-10 text-green-500 opacity-80" />
                        ) : (
                            <Flag className="w-10 h-10 text-amber-500 opacity-80" />
                        )}
                    </div>
                    <h3 className="text-xl font-semibold text-foreground mb-2">
                        {currentFilter === 'unread' ? "All caught up!" : "No starred messages"}
                    </h3>
                    <p className="text-sm text-muted-foreground max-w-[250px]">
                        {currentFilter === 'unread' 
                            ? "You've read all the messages in this view." 
                            : "Star some messages to see them here for quick access."}
                    </p>
                </motion.div>
            ) : (
                <div 
                    ref={parentRef} 
                    className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar relative"
                    aria-label="Messages"
                    onWheel={handleWheel}
                    onTouchStart={handleTouchStart}
                    onTouchMove={handleTouchMove}
                    onTouchEnd={handleTouchEnd}
                >
                <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
                        {virtualItems.map((virtualRow) => {
                            const email = displayedEmails[virtualRow.index];
                            return (
                                <div
                                    key={virtualRow.key}
                                    data-index={virtualRow.index}
                                    ref={rowVirtualizer.measureElement}
                                    style={{
                                        position: 'absolute',
                                        top: 0,
                                        left: 0,
                                        width: '100%',
                                        transform: `translateY(${virtualRow.start}px)`,
                                    }}
                                >
                                    <EmailListItem
                                        email={email}
                                        isSelected={selectedEmailId === email.id || Boolean(selectedEmailId && email.conversationIds?.includes(selectedEmailId))}
                                        onSelect={selectItem}
                                        onToggleStar={starItem}
                                        onContextMenu={itemContextMenu}
                                        allTags={unified ? tagsByAccount?.[email.accountId||'']||{} : allTags}
                                        listPreferences={unified?preferences:undefined}
                                        accountLabel={unified ? accounts.find(account=>account.id===email.accountId)?.email : undefined}
                                        accountColor={unified ? identities.accounts?.[email.accountId||'']?.color : undefined}
                                    />
                                </div>
                            );
                        })}
                </div>
                {/* Loader showing below the items if loading more */}
                {searchQuery.trim().length > 0 && searchProgress && searchProgress.state !== 'Completed' && searchProgress.state !== 'Cancelled' && searchProgress.state !== 'OfflineLocalOnly' && !searchProgress.progress_text.includes('Complete') && !searchProgress.progress_text.includes('Offline') ? (
                    <div className="pt-4 pb-16 w-full flex justify-center items-center shrink-0">
                        <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-white/40 dark:bg-white/5 backdrop-blur-md border border-black/5 dark:border-white/10 shadow-sm">
                            <div className="w-4 h-4 rounded-full border-2 border-primary/20 border-t-primary animate-spin shrink-0" />
                            <span className="text-xs font-medium text-muted-foreground">Checking older server history...</span>
                        </div>
                    </div>
                ) : hasMore && isLoadingMore ? (
                    <div className="py-6 w-full flex justify-center items-center shrink-0">
                        <OrbitLoader size="sm" message="" />
                    </div>
                ) : <div className="h-16 w-full shrink-0" />}
            </div>
            )}
            <EmailContextMenu 
                contextMenu={contextMenuState && emails.some(email => email.id === contextMenuState.emailId)
                    ? { ...contextMenuState, snoozedUntil:emails.find(email=>email.id===contextMenuState.emailId)?.snoozedUntil, canSnooze:emails.find(email=>email.id===contextMenuState.emailId)?.folder==='inbox', pinned:Boolean(displayedEmails.find(email=>email.id===contextMenuState.emailId)?.pinned), unread: Boolean(emails.find(email => email.id === contextMenuState.emailId)?.unread) }
                    : null}
                onClose={() => setContextMenuState(null)} 
                onSnooze={onSnooze}
                onUnsnooze={onUnsnooze}
                onTogglePin={onTogglePin}
                onNewToSender={onNewToSender}
                onReplyAll={onReplyAll}
                onForward={onForward}
                onReply={onReply}
                onToggleRead={onToggleRead} 
                isTrash={currentFolder === 'trash'}
                onDelete={onDeleteMessage}
                onRestore={onRestoreMessage}
                onAddTags={currentFolder !== 'trash' && (onManageTags||onAddTags) && !emails.find(email => email.id === contextMenuState?.emailId)?.tagsPending ? id => onManageTags ? onManageTags(id) : setTagPickerEmail(emails.find(email => email.id === id) || null) : undefined}
            />
            {tagPickerEmail && onAddTags && <MessageTagPicker email={tagPickerEmail} tags={Object.values(allTags)} onApply={onAddTags} onClose={() => setTagPickerEmail(null)} />}
        </main>
    );
};

export default EmailList;
