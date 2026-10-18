"use client";

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Email } from '@/lib/types';
import { dedupeMail, sameMail,mailIdentity } from '@/lib/mail-identity';
import { formatEmailTime } from '@/lib/utils';
import { AlertCircle } from 'lucide-react';

import { motion, AnimatePresence } from 'framer-motion';
import ComposeModal, { type ComposeHandle } from '@/components/ComposeModal';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { isPermissionGranted, requestPermission, onAction, registerActionTypes, sendNotification } from '@tauri-apps/plugin-notification';
import { useSync } from '@/components/SyncContext';
import { useAuth } from '@/components/AuthContext';
import LogoSpinner from '@/components/LogoSpinner';
import Sidebar from '@/components/Sidebar';
import EmailList from '@/components/EmailList';
import EmailDetail from '@/components/EmailDetail';
import { usePendingSentMessages } from '@/hooks/usePendingSentMessages';
import { SearchProgressData } from '@/components/inbox/EmailListHeader';
import { CreateTagModal } from '@/components/tags/CreateTagModal';
import { EditTagModal } from '@/components/tags/EditTagModal';
import { DeleteTagModal } from '@/components/tags/DeleteTagModal';
import { Tag } from '@/lib/types';
import { toast } from 'sonner';
import { useAppPreferences } from './AppPreferencesContext';
interface FolderSearchState {
    searchQuery: string;
    activeSearchId: string | null;
    searchProgress: SearchProgressData | null;
    searchResults: Email[];
    hasMoreSearch: boolean;
    isLoadingMoreSearch: boolean;
}

export default function MainLayout() {
    const { user } = useAuth();
    const { preferences, updatePreferences } = useAppPreferences();
    const preferencesRef = useRef(preferences);
    preferencesRef.current = preferences;
    const activeAccountRef = useRef(user?.id);
    useEffect(() => { activeAccountRef.current = user?.id; }, [user?.id]);
    const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
    const [isComposeOpen, setIsComposeOpen] = useState(false);
    const composeWindowRef = useRef<ComposeHandle>(null);
    const [isCreateTagOpen, setIsCreateTagOpen] = useState(false);
    const [editingTag, setEditingTag] = useState<Tag | null>(null);
    const [deletingTag, setDeletingTag] = useState<Tag | null>(null);

    // --- New State for Folders & Stars ---
    const [currentFolder, setCurrentFolder] = useState<string>(preferences.defaultFolder);
    const currentFolderRef = useRef<string>(preferences.defaultFolder); // Live reference to avoid stale closures in event listeners
    const [emails, setEmails] = useState<Email[]>([]);
    const [pendingTagAdds, setPendingTagAdds] = useState<Record<string, { accountId: string; email: Email; tags: string[]; removed: string[] }>>({});
    const tagRequests = useRef(new Set<string>());
    const [pendingFlags,setPendingFlags]=useState<Record<string,{accountId:string;email:Email;patch:Partial<Email>}>>({});
    const flagVersions=useRef(new Map<string,number>());
    const [pendingDeletes,setPendingDeletes]=useState<Record<string,{accountId:string;email:Email}>>({});
    const deleteRequests=useRef(new Set<string>());
    const { isSyncing, setIsSyncing, setSyncMessage, unreadCounts, setUnreadCounts, syncTriggerCount, triggerSync } = useSync();
    const [isBootstrapping, setIsBootstrapping] = useState(true);
    const [isLoadingFolder, setIsLoadingFolder] = useState(false); // Loading skeleton when switching folders
    const [syncError, setSyncError] = useState<string | null>(null);
    const [syncErrors, setSyncErrors] = useState<Record<string, string>>({});
    const syncFailure = Object.entries(syncErrors)[0] ?? null;

    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(true);
    const emailListContainerRef = useRef<HTMLDivElement>(null);
    const emailsRef = useRef<Email[]>([]);
    const cacheRevisionRef = useRef(0);

    const [folderSearchContexts, setFolderSearchContexts] = useState<Record<string, FolderSearchState>>({});
    const folderSearchRef=useRef(folderSearchContexts);
    folderSearchRef.current=folderSearchContexts;

    const activeSearchState = folderSearchContexts[currentFolder] || {
        searchQuery: '',
        activeSearchId: null,
        searchProgress: null,
        searchResults: [],
        hasMoreSearch: false,
        isLoadingMoreSearch: false,
    };

    const activeSearchIdRef = useRef<string | null>(null);
    useEffect(() => {
        activeSearchIdRef.current = activeSearchState.activeSearchId;
    }, [activeSearchState.activeSearchId]);

    useEffect(() => {
        emailsRef.current = emails;
    }, [emails]);

    // Keep currentFolderRef in sync so event listeners always read the latest folder
    useEffect(() => {
        currentFolderRef.current = currentFolder;
    }, [currentFolder]);

    const hasSyncedRef = useRef(false);

    const {
        pendingMessages,
        addPendingMessage,
        updatePendingToSyncing,
        reconcileWithDb
    } = usePendingSentMessages();

    // --- Derived State ---

    const pendingTags = Object.values(pendingTagAdds).filter(item => item.accountId === user?.id);
    const overlayTags = (email: Email): Email => {
        const flagEdits=Object.values(pendingFlags).filter(edit=>edit.accountId===user?.id&&sameMail(edit.email,email));
        email=Object.assign({},email,...flagEdits.map(edit=>edit.patch));
        const pending = pendingTags.find(item => sameMail(item.email,email));
        return pending ? { ...email, tags: [...new Set([...email.tags, ...pending.tags])].filter(id => !pending.removed.includes(id)), tagsPending: true } : email;
    };
    const visibleCandidates = emails.map(overlayTags);
    if (currentFolder.startsWith('tag:')) {
        for (const pending of pendingTags) {
            if (pending.tags.includes(currentFolder.slice(4)) && !visibleCandidates.some(item => sameMail(item,pending.email))) {
                visibleCandidates.unshift(overlayTags(pending.email));
            }
        }
    }
    const filteredEmails = activeSearchState.searchQuery ? activeSearchState.searchResults.map(overlayTags) : visibleCandidates.filter(email => {
        if (currentFolder === 'starred') {
            return email.starred;
        }
        if (currentFolder.startsWith('tag:')) return email.tags.includes(currentFolder.slice(4));
        return email.folder === currentFolder;
    });
    const visibleEmails=filteredEmails.filter(email=>!Object.values(pendingDeletes).some(edit=>edit.accountId===user?.id&&sameMail(edit.email,email)));

    const selectedEmail = visibleEmails.find(e => e.id === selectedEmailId);


    const fetchUnreadCounts = async () => {
        try {
            const counts = await invoke<Record<string, number>>('get_unread_counts');
            setUnreadCounts(counts);
        } catch (error) {
            console.error("Failed to fetch unread counts", error);
        }
    };

    const updateUnreadCount = (email: Email, delta: number) => {
        setUnreadCounts(prev => {
            const newCounts = { ...prev };
            const folderId = email.folder.toLowerCase();
            newCounts[folderId] = Math.max(0, (newCounts[folderId] || 0) + delta);
            if (email.starred) {
                newCounts['starred'] = Math.max(0, (newCounts['starred'] || 0) + delta);
            }
            return newCounts;
        });
    };

    // --- Global State Sync ---
    useEffect(() => {
        fetchUnreadCounts();
    }, []);

    // --- Handlers ---
    const patchMessage=(target:Email,patch:Partial<Email>)=>{
        const update=(items:Email[])=>items.map(email=>sameMail(email,target)?{...email,...patch}:email);
        setEmails(update);
        setFolderSearchContexts(prev=>Object.fromEntries(Object.entries(prev).map(([folder,state])=>[folder,{...state,searchResults:update(state.searchResults)}])));
    };
    const beginFlagEdit=(email:Email,field:'unread'|'starred',value:boolean)=>{
        const accountId=user?.id??'';const key=JSON.stringify([accountId,mailIdentity(email),field]);
        const version=(flagVersions.current.get(key)??0)+1;flagVersions.current.set(key,version);
        setPendingFlags(prev=>({...prev,[key]:{accountId,email,patch:{[field]:value}}}));
        return{
            current:()=>activeAccountRef.current===accountId&&flagVersions.current.get(key)===version,
            finish:()=>{if(flagVersions.current.get(key)===version)setPendingFlags(prev=>{const next={...prev};delete next[key];return next;});}
        };
    };

    const toggleStar = async (emailId: string) => {
        const target = filteredEmails.find(e => e.id === emailId);
        if (!target) return;

        const newStarredState = !target.starred;
        const edit=beginFlagEdit(target,'starred',newStarredState);

        // Optimistic Update
        setEmails(prev => prev.map(email =>
            email.id === emailId ? { ...email, starred: newStarredState } : email
        ));

        if (target.unread) {
            setUnreadCounts(prev => ({
                ...prev,
                starred: Math.max(0, (prev['starred'] || 0) + (newStarredState ? 1 : -1))
            }));
        }

        try {
            const folderName = target.folder || "inbox";
            await invoke('toggle_star', { accountId:user?.id, expectedUidValidity:target.uidValidity??0, uid: target.uid, shouldStar: newStarredState, folder: folderName });
            if(edit.current())patchMessage(target,{starred:newStarredState});
            fetchUnreadCounts();
        } catch (err) {
            if(!edit.current())return;
            console.error("Failed to toggle star", err);
            if (String(err).match(/No active account|NEEDS_REAUTH|TOKEN_REFRESH_FAILED/)) {
                localStorage.removeItem("orion_user");
                window.location.href = "/";
                return;
            }
            toast.error("Couldn't update star", { description: String(err) });
            // Rollback
            patchMessage(target,{starred:target.starred});
        }finally{edit.finish();}
    };

    const toggleRead = async (emailId: string) => {
        const target = filteredEmails.find(e => e.id === emailId);
        if (!target) return;

        const newReadState = Boolean(target.unread);
        const edit=beginFlagEdit(target,'unread',!newReadState);

        // Optimistic Update
        setEmails(prev => prev.map(email =>
            email.id === emailId ? { ...email, unread: !newReadState } : email
        ));

        updateUnreadCount(target, newReadState ? -1 : 1);

        try {
            const folderName = target.folder || "inbox";
            await invoke('toggle_read', { accountId:user?.id,expectedUidValidity:target.uidValidity??0,uid: target.uid, shouldRead: newReadState, folder: folderName });
            if(edit.current())patchMessage(target,{unread:!newReadState});
            fetchUnreadCounts();
        } catch (err) {
            if(!edit.current())return;
            console.error("Failed to toggle read", err);
            if (String(err).match(/No active account|NEEDS_REAUTH|TOKEN_REFRESH_FAILED/)) {
                localStorage.removeItem("orion_user");
                window.location.href = "/";
                return;
            }
            toast.error("Couldn't update read status", { description: String(err) });
            // Rollback
            patchMessage(target,{unread:target.unread});
            fetchUnreadCounts();
        }finally{edit.finish();}
    };

    const markAsRead = async (emailId: string) => {
        const target = filteredEmails.find(e => e.id === emailId);
        if (!target || !target.unread) return;
        const edit=beginFlagEdit(target,'unread',false);

        // Optimistic Update
        setEmails(prev => prev.map(email =>
            email.id === emailId ? { ...email, unread: false } : email
        ));

        updateUnreadCount(target, -1);

        try {
            const folderName = target.folder || "inbox";
            await invoke('mark_as_read', { accountId:user?.id,expectedUidValidity:target.uidValidity??0,uid: target.uid, folder: folderName });
            if(edit.current())patchMessage(target,{unread:false});
            fetchUnreadCounts();
        } catch (err) {
            if(!edit.current())return;
            console.error("Failed to mark as read", err);
            if (String(err).match(/No active account|NEEDS_REAUTH|TOKEN_REFRESH_FAILED/)) {
                localStorage.removeItem("orion_user");
                window.location.href = "/";
                return;
            }
            toast.error("Couldn't mark message as read", { description: String(err) });
            // Rollback
            patchMessage(target,{unread:target.unread});
        }finally{edit.finish();}
    };

    const deleteMessage = async (emailId: string) => {
        const target = filteredEmails.find(e => e.id === emailId);
        if (!target) return;
        const deleteKey=JSON.stringify([user?.id,mailIdentity(target)]);
        if(deleteRequests.current.has(deleteKey))return;
        deleteRequests.current.add(deleteKey);
        setPendingDeletes(prev=>({...prev,[deleteKey]:{accountId:user?.id??'',email:target}}));
        const removeFromViews=()=>{
            setEmails(prev=>prev.filter(email=>!sameMail(email,target)));
            setFolderSearchContexts(prev=>Object.fromEntries(Object.entries(prev).map(([folder,state])=>[folder,{...state,searchResults:state.searchResults.filter(email=>!sameMail(email,target))}])));
        };
        const deletedSelected = selectedEmailId === emailId;
        const targetIndex = filteredEmails.findIndex(e => e.id === emailId);
        const nextId = filteredEmails[targetIndex + 1]?.id || filteredEmails[targetIndex - 1]?.id || null;
        // Optimistic Update
        removeFromViews();
        if (selectedEmailId === emailId) {
            setSelectedEmailId(null);
        }

        if (target.unread) {
            updateUnreadCount(target, -1);
        }

        try {
            const folderName = target.folder || "inbox";
            await invoke('delete_message', { accountId:user?.id,expectedUidValidity:target.uidValidity??0,uid: target.uid, folder: folderName });
            if(activeAccountRef.current===user?.id)removeFromViews();
            if (deletedSelected && preferences.autoSelectNext && currentFolderRef.current === currentFolder && activeAccountRef.current === user?.id) setSelectedEmailId(current => current === null ? nextId : current);
            fetchUnreadCounts();
        } catch (err) {
            if(activeAccountRef.current!==user?.id)return;
            console.error("Failed to delete message", err);
            if (String(err).match(/No active account|NEEDS_REAUTH|TOKEN_REFRESH_FAILED/)) {
                localStorage.removeItem("orion_user");
                window.location.href = "/";
                return;
            }
            toast.error("Couldn't delete message", { description: String(err) });
            // Rollback via DB fetch since array splicing is tricky to reverse
            await fetchCache(currentFolder);
        }finally{
            deleteRequests.current.delete(deleteKey);
            setPendingDeletes(prev=>{const next={...prev};delete next[deleteKey];return next;});
        }
    };

    const dedupeEmails = dedupeMail;

    const formatEmailFromMessage = (msg: any): Email => {
        let folder = msg.folder;
        if (!folder) folder = "inbox";
        else if (folder.toLowerCase() === "sent") folder = "sent";
        // Preserve case for tags, standardize others
        else if (!folder.toLowerCase().startsWith("tag:")) folder = folder.toLowerCase();
        let senderName = msg.from.split('<')[0].trim();
        if (!senderName) {
            const emailMatch = msg.from.match(/<([^>]+)>/);
            senderName = emailMatch ? emailMatch[1].split('@')[0] : msg.from;
        }

        return {
            id: `${folder}-${msg.uid}`,
            uid: msg.uid,
            uidValidity:msg.uid_validity,
            messageId: msg.message_id,
            sender: senderName,
            senderEmail: msg.from,
            to: msg.to || undefined,
            subject: msg.subject || '(No Subject)',
            preview: msg.snippet?.trim() || msg.subject?.substring(0, 100) || 'No preview available',
            time: formatEmailTime(msg.date * 1000),
            date: new Date(msg.date * 1000).toLocaleString(),
            timestamp: msg.date * 1000,
            unread: !msg.seen,
            folder: folder,
            tags: msg.tags || [],
            starred: msg.flagged,
            body: msg.snippet || '<p>Message body not fetched in this milestone.</p>',
            attachments: [],
        };
    };

    const fetchCache = async (folderToFetch = currentFolderRef.current) => {
        const revision = cacheRevisionRef.current;
        if (folderToFetch === "drafts" || folderToFetch === "trash") {
            setEmails([]);
            setHasMore(false);
            return false;
        }

        try {
            const cached: any[] = await invoke('get_folder_messages', { folder: folderToFetch, beforeUid: null, limit: 50 });
            if (revision !== cacheRevisionRef.current || folderToFetch !== currentFolderRef.current) return false;
            if (cached && cached.length > 0) {
                const formattedEmails = cached.map(formatEmailFromMessage);
                const deduped = dedupeEmails(formattedEmails);
                setEmails(deduped);
                reconcileWithDb(deduped);
                setHasMore(cached.length === 50);
                fetchUnreadCounts();
                return true;
            }
            setEmails([]);
            setHasMore(false);
            fetchUnreadCounts();
            return false;
        } catch (error) {
            console.error("Failed to load cache", error);
            if (String(error).match(/No active account|NEEDS_REAUTH|TOKEN_REFRESH_FAILED/)) {
                localStorage.removeItem("orion_user");
                window.location.href = "/";
            }
            return false;
        }
    };

    useEffect(()=>{
        let disposed=false;let stop:(()=>void)|undefined;let timer:ReturnType<typeof setTimeout>|undefined;
        const refresh=async(accountId:string)=>{
            if(disposed||accountId!==activeAccountRef.current)return;
            const folder=currentFolderRef.current;const revision=++cacheRevisionRef.current;
            const loaded=emailsRef.current.slice(0,1000);
            const requested=[...new Map([...loaded,...Object.values(folderSearchRef.current).flatMap(state=>state.searchResults)].map(email=>[email.id,email])).values()].slice(0,1000);
            try{
                const [existing,head]=await Promise.all([
                    invoke<Parameters<typeof formatEmailFromMessage>[0][]>('get_cached_message_headers',{requests:requested.map(email=>({folder:email.folder,uid:email.uid}))}),
                    invoke<Parameters<typeof formatEmailFromMessage>[0][]>('get_folder_messages',{folder,beforeUid:null,limit:50})
                ]);
                if(disposed||accountId!==activeAccountRef.current||folder!==currentFolderRef.current||revision!==cacheRevisionRef.current)return;
                const matchesView=(email:Email)=>folder==='starred'?email.starred:folder.startsWith('tag:')?email.tags.includes(folder.slice(4)):email.folder===folder;
                const loadedIds=new Set(loaded.map(email=>email.id));
                const next=dedupeEmails([...head.map(formatEmailFromMessage),...existing.map(formatEmailFromMessage).filter(email=>loadedIds.has(email.id))].filter(matchesView));
                setEmails(next);
                setSelectedEmailId(previous=>{
                    if(next.some(email=>email.id===previous))return previous;
                    const selected=loaded.find(email=>email.id===previous);
                    return selected?next.find(email=>sameMail(email,selected))?.id??null:previous;
                });
                setFolderSearchContexts(prev=>Object.fromEntries(Object.entries(prev).map(([key,state])=>{
                    const map=new Map(existing.map(formatEmailFromMessage).map(email=>[email.id,email]));
                    const queried=new Set(requested.map(email=>email.id));
                    return[key,{...state,searchResults:dedupeEmails(state.searchResults.flatMap(email=>map.has(email.id)?[map.get(email.id)!]:queried.has(email.id)?[]:[email])).filter(email=>key==='starred'?email.starred:key.startsWith('tag:')?email.tags.includes(key.slice(4)):email.folder===key)}];
                })));
                void fetchUnreadCounts();
            }catch(error){console.error('Could not refresh cached label changes',error);}
        };
        void listen<string>('mail:labels_changed',event=>{
            if(timer)clearTimeout(timer);
            timer=setTimeout(()=>{void refresh(event.payload);},80);
        }).then(unlisten=>{if(disposed)unlisten();else stop=unlisten;}).catch(console.error);
        return()=>{disposed=true;if(timer)clearTimeout(timer);stop?.();};
    },[]);

    const refreshNewEmails = async (folderToFetch = currentFolderRef.current) => {
        const revision = cacheRevisionRef.current;
        if (folderToFetch === "drafts" || folderToFetch === "trash") return;

        try {
            const cached: any[] = await invoke('get_folder_messages', { folder: folderToFetch, beforeUid: null, limit: 50 });
            if (revision !== cacheRevisionRef.current || folderToFetch !== currentFolderRef.current) return;
            if (!cached || cached.length === 0) {
                setEmails([]);
                setSelectedEmailId(null);
                fetchUnreadCounts();
                return;
            }

            const existingEmails = emailsRef.current;
            if (existingEmails.length === 0) {
                await fetchCache(folderToFetch);
                return;
            }

            const formattedEmails = cached.map(formatEmailFromMessage);

            setEmails(prev => {
                // Only merge if the current folder matches what we fetched
                // (guards against race conditions when switching folders)
                if (currentFolderRef.current !== folderToFetch || revision !== cacheRevisionRef.current) {
                    return prev;
                }
                const merged = [...formattedEmails, ...prev];
                const deduped = dedupeEmails(merged);
                reconcileWithDb(deduped);
                return deduped;
            });

            fetchUnreadCounts();
        } catch (error) {
            console.error("Failed to refresh new emails", error);
            if (String(error).match(/No active account|NEEDS_REAUTH|TOKEN_REFRESH_FAILED/)) {
                localStorage.removeItem("orion_user");
                window.location.href = "/";
            }
        }
    };

    const loadMoreEmails = async () => {
        const revision = cacheRevisionRef.current;
        const currentEmails = emailsRef.current;
        if (isLoadingMore || !hasMore || currentEmails.length === 0 || currentFolder === "drafts" || currentFolder === "trash") return;
        setIsLoadingMore(true);
        try {
            const lastEmail = currentEmails[currentEmails.length - 1];
            const beforeUid = lastEmail.uid;

            const nextBatch: any[] = await invoke('get_folder_messages', { folder: currentFolder, beforeUid, beforeFolder: lastEmail.folder, limit: 50 });
            if (revision !== cacheRevisionRef.current || currentFolderRef.current !== currentFolder) return;
            if (nextBatch.length === 0) {
                setHasMore(false);
            } else {
                const formattedEmails = nextBatch.map(formatEmailFromMessage);
                setEmails(prev => {
                    if (revision !== cacheRevisionRef.current || currentFolderRef.current !== currentFolder) return prev;
                    const merged = [...prev, ...formattedEmails];
                    return dedupeEmails(merged);
                });
                if (nextBatch.length < 50) {
                    setHasMore(false);
                }
            }
        } catch (err) {
            console.error("Failed to load more emails", err);
            if (String(err).match(/No active account|NEEDS_REAUTH|TOKEN_REFRESH_FAILED/)) {
                window.location.href = "/";
            }
        } finally {
            setIsLoadingMore(false);
        }
    };

    const handleAddTags = async (email: Email, tags: string[], removed: string[]) => {
        const accountId = activeAccountRef.current;
        if (!accountId) return;
        const key = `${accountId}:${email.id}`;
        if (tagRequests.current.has(key)) return;
        tagRequests.current.add(key);
        setPendingTagAdds(prev => ({ ...prev, [key]: { accountId, email, tags, removed } }));
        try {
            const assigned = await invoke<string[]>('update_message_tags', { accountId,expectedUidValidity:email.uidValidity??0,folder: email.folder, uid: email.uid, addIds: tags, removeIds: removed });
            if (activeAccountRef.current !== accountId) return;
            cacheRevisionRef.current += 1;
            const matches = (item: Email) => sameMail(item,email);
            const update = (items: Email[]) => items.filter(item => !matches(item) || !removed.some(id => item.folder === `tag:${id}`)).map(item => matches(item) ? { ...item, tags: assigned } : item);
            setEmails(prev => {
                const updated = update(prev);
                if (currentFolderRef.current.startsWith('tag:') && assigned.includes(currentFolderRef.current.slice(4)) && !updated.some(item => sameMail(item,email))) {
                    if (!removed.some(id => email.folder === `tag:${id}`)) return dedupeEmails([{ ...email, tags: assigned }, ...updated]);
                }
                return updated;
            });
            setFolderSearchContexts(prev => Object.fromEntries(Object.entries(prev).map(([folder, state]) => [folder, { ...state, searchResults: update(state.searchResults) }])));
        } catch (error) {
            if (activeAccountRef.current === accountId) {
                toast.error(String(error).includes('Saved on this device') ? 'Tag update queued for retry' : 'Could not save tags', { description: String(error), action: { label: 'Retry', onClick: () => { void handleAddTags(email, tags, removed); } } });
            }
        } finally {
            tagRequests.current.delete(key);
            setPendingTagAdds(prev => { const next = { ...prev }; delete next[key]; return next; });
        }
    };

    const handleSync = (isBackground = false, requestedFolder?: string) => {
        if (isBackground && preferencesRef.current.syncPaused) return Promise.resolve();
        // Read currentFolder from ref to avoid stale closure issues
        const folderAtSyncTime = currentFolderRef.current;
        if ((!requestedFolder && isSyncing) || (!requestedFolder && (folderAtSyncTime === "drafts" || folderAtSyncTime === "trash"))) return Promise.resolve();
        setIsSyncing(true);
        setSyncError(null);

        // For Starred, we just need to ensure Inbox/Sent are relatively up-to-date.
        // Tags are now directly synchronized from their respective IMAP mailboxes.
        const syncTarget = requestedFolder ?? (folderAtSyncTime === "starred" ? "inbox" : folderAtSyncTime);

        // NOTE: sync_mail_folder is fire-and-forget on the backend (enqueues async sync,
        // returns 0 immediately). The real results arrive via the 'mail:updated' event.
        // We still call fetchCache after a brief delay as a safety net for cases where
        // the sync completes very quickly or the event is missed.
        return invoke('sync_mail_folder', { folder: syncTarget, automatic: isBackground })
            .then(async () => {
                console.log(`Sync enqueued for: ${syncTarget}`);

                if (!isBackground) {
                    setSyncMessage("Syncing...");
                    // Clear syncing message after reasonable wait
                    setTimeout(() => setSyncMessage(null), 4000);
                }

                // Always re-fetch from the DB after enqueuing sync.
                // This catches any messages the backend may have already written.
                await fetchCache(folderAtSyncTime);
            })
            .catch((e) => {
                console.error("Failed to sync messages:", e);
                if (String(e).match(/No active account|NEEDS_REAUTH|TOKEN_REFRESH_FAILED/)) {
                    localStorage.removeItem("orion_user");
                    window.location.href = "/";
                    return;
                }
                if (!isBackground) {
                    setSyncError("Failed to sync messages. Please try again.");
                    setTimeout(() => setSyncError(null), 3000);
                }
            })
            .finally(() => {
                setIsSyncing(false);
            });
    };
    
    const handleForceSync = () => {
        triggerSync();
    };

    useEffect(() => {
        if (syncTriggerCount > 0) {
            handleSync(false);
        }
    }, [syncTriggerCount]);

    // Calculate total unreads and update tray
    useEffect(() => {
        const total = Object.entries(unreadCounts).reduce((acc, [key, val]) => {
            if (key === 'starred') return acc; // starred is a duplicate of unread state
            return acc + (val || 0);
        }, 0);
    }, [unreadCounts]);

    useEffect(() => {
        const interval = setInterval(() => {
            if(preferencesRef.current.syncPaused)return;
            invoke('sync_mail_folder', { folder: 'inbox', automatic:true }).catch(console.error);
            fetchUnreadCounts();
        }, 60000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        let unlistenSync: (() => void) | undefined;
        let unlistenCompose: (() => void) | undefined;
        let unlistenHidden: (() => void) | undefined;

        const setupTrayListeners = async () => {
            unlistenSync = await listen('tray:sync_now', () => {
                console.log("tray:sync_now event received");
                triggerSync(); // Use context trigger to avoid stale state in handleSync
            });
            
            unlistenCompose = await listen('tray:compose', () => {
                console.log("tray:compose event received");
                setIsComposeOpen(true);
            });
            
            unlistenHidden = await listen('window:hidden', async () => {
                const hintShown = localStorage.getItem("orion_tray_hint");
                if (!hintShown) {
                    try {
                        sendNotification({
                            title: 'Orion Mail is still running',
                            body: "You'll continue receiving notifications and syncing email in the background."
                        });
                        localStorage.setItem("orion_tray_hint", "true");
                    } catch (e) {
                        console.error("Failed to send tray hint notification", e);
                    }
                }
            });
        };

        setupTrayListeners();

        return () => {
            if (unlistenSync) unlistenSync();
            if (unlistenCompose) unlistenCompose();
            if (unlistenHidden) unlistenHidden();
        };
    }, []);

    const blockForInitialSync = async () => {
        // Since AuthContext (or another component) might have already triggered `sync_inbox`,
        // the Rust mutex might be locked. If the database is completely empty, 
        // we must literally wait and poll the cache until the background sync thread finishes 
        // pumping the first batch of SQLite messages to disk.
        return new Promise<void>((resolve) => {
            const pollInterval = setInterval(async () => {
                try {
                    const hasMessages = await fetchCache();
                    if (hasMessages) {
                        clearInterval(pollInterval);
                        resolve();
                    }
                } catch (err) {
                    // Ignore transient load errors
                }
            }, 500);

            // Safety timeout
            setTimeout(() => {
                clearInterval(pollInterval);
                resolve();
            }, 120000); // 2 min max wait
        });
    };

    useEffect(() => {
        const loadCache = async () => {
            const hasCache = await fetchCache();
            const wasMinimized = await invoke<boolean>('was_launched_minimized').catch(() => false);

            if (!wasMinimized) {
                setSyncMessage("✓ Background sync active");
                setTimeout(() => setSyncMessage(null), 2500);
            }

            if (!hasCache && !preferencesRef.current.syncPaused) {
                // DB is empty, sync is likely already running in the background. Block and poll.
                // If this is a fresh launch (not after login), we trigger sync ourselves.
                handleSync(false);
                await blockForInitialSync();
            }

            // Drop bootstrap loader only after emails are available
            setIsBootstrapping(false);

            if (!hasSyncedRef.current) {
                hasSyncedRef.current = true;

                // If we already had a cache, we just spun up instantly. 
                // Delay a background sync to grab new items to prevent layout jank.
                // If launched via autostart, delay 10s to let VPN/WiFi connect.
                if (hasCache) {
                    let delay = wasMinimized ? 10000 : 500;
                    setTimeout(() => {
                        handleSync(true);
                    }, delay);
                }
            }
        };

        loadCache();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (isBootstrapping) return;
        let cancelled = false;
        let syncTimer: ReturnType<typeof setTimeout> | undefined;
        const folder = currentFolder;
        setSelectedEmailId(null);
        setIsLoadingFolder(true);
        setEmails([]);
        setHasMore(false);
        setIsLoadingMore(false);
        void fetchCache(folder).then(hasCache => {
            if (cancelled) return;
            setIsLoadingFolder(false);
            if (!preferencesRef.current.syncPaused) {
                syncTimer = setTimeout(() => {
                    if (!cancelled) void handleSync(true, folder);
                }, hasCache ? 300 : 0);
            }
        }).catch(() => {
            if (!cancelled) setIsLoadingFolder(false);
        });
        return () => {
            cancelled = true;
            if (syncTimer) clearTimeout(syncTimer);
        };
    }, [currentFolder, isBootstrapping]);

    const [syncingFolders, setSyncingFolders] = useState<Set<string>>(new Set());

    useEffect(() => {
        let unlistenUpdated: (() => void) | undefined;
        let unlistenStarted: (() => void) | undefined;
        let unlistenFinished: (() => void) | undefined;
        let unlistenError: (() => void) | undefined;
        let unlistenReconciled: (() => void) | undefined;
        let unlistenConflict: (() => void) | undefined;

        const setupListener = async () => {
            unlistenReconciled = await listen<{ account_id: string; folder: string; updated_flags: { uid: number; seen: boolean; flagged: boolean }[]; removed_uids: number[] }>('mail:reconciled', event => {
                if (event.payload.account_id !== activeAccountRef.current) return;
                cacheRevisionRef.current += 1;
                const { folder, updated_flags, removed_uids } = event.payload;
                const removed = new Set(removed_uids);
                const flags = new Map(updated_flags.map(item => [item.uid, item]));
                const reconcile = (items: Email[]) => items
                    .filter(item => item.folder !== folder || !removed.has(item.uid))
                    .map(item => {
                        const next = item.folder === folder ? flags.get(item.uid) : undefined;
                        return next ? { ...item, unread: !next.seen, starred: next.flagged } : item;
                    });
                setEmails(reconcile);
                setFolderSearchContexts(prev => Object.fromEntries(Object.entries(prev).map(([key, context]) => [key, { ...context, searchResults: reconcile(context.searchResults) }])));
                setSelectedEmailId(previous => emailsRef.current.some(item => item.id === previous && item.folder === folder && removed.has(item.uid)) ? null : previous);
                fetchUnreadCounts();
            });
            unlistenConflict = await listen<{ account_id: string; error: string }>('mail:action_conflict', event => {
                if (event.payload.account_id !== activeAccountRef.current) return;
                toast.error('A queued message action needs attention', { description: event.payload.error });
            });
            unlistenUpdated = await listen<string>('mail:updated', async (event) => {
                const syncedFolder = event.payload;
                const activeFolder = currentFolderRef.current;

                const isRelevant = 
                    activeFolder === syncedFolder ||
                    (activeFolder === 'starred' && syncedFolder !== 'starred');

                if (!isRelevant) return;

                if (emailsRef.current.length === 0) {
                    await fetchCache(activeFolder);
                } else {
                    await refreshNewEmails(activeFolder);
                }
            });

            unlistenStarted = await listen<string>('mail:sync_started', (event) => {
                const folder = event.payload;
                setSyncingFolders(prev => new Set(prev).add(folder));
                setSyncErrors(prev => {
                    const next = { ...prev };
                    delete next[folder];
                    return next;
                });
            });

            unlistenFinished = await listen<string>('mail:sync_finished', async (event) => {
                setSyncingFolders(prev => {
                    const next = new Set(prev);
                    next.delete(event.payload);
                    return next;
                });
                
                if (event.payload === currentFolderRef.current) {
                    await fetchCache(event.payload);
                }
            });
            
            unlistenError = await listen<{ folder: string; error: string }>('mail:sync_error', (event) => {
                console.error(`Sync failed for ${event.payload.folder}:`, event.payload.error);
                setSyncErrors(prev => ({
                    ...prev,
                    [event.payload.folder]: event.payload.error
                }));
            });
        };

        setupListener();

        return () => {
            if (unlistenUpdated) unlistenUpdated();
            if (unlistenStarted) unlistenStarted();
            if (unlistenFinished) unlistenFinished();
            if (unlistenError) unlistenError();
            if (unlistenReconciled) unlistenReconciled();
            if (unlistenConflict) unlistenConflict();
        };
    }, []);

    // --- Notification Permissions & Logic ---
    useEffect(() => {
        const setupNotifications = async () => {
            try {
                let permissionGranted = await isPermissionGranted();
                if (!permissionGranted) {
                    const permission = await requestPermission();
                    permissionGranted = permission === 'granted';
                }

                if (permissionGranted) {
                    console.log("Notification permission granted");

                    try {
                        await registerActionTypes([
                            {
                                id: 'new_email',
                                actions: [
                                    { id: 'open', title: 'Open' },
                                    { id: 'mark_read', title: 'Mark as Read' }
                                ]
                            },
                            {
                                id: 'summary_email',
                                actions: [
                                    { id: 'open', title: 'Open Inbox' }
                                ]
                            }
                        ]);
                    } catch (e) {
                        console.warn("Failed to register action types. May not be supported on this OS.", e);
                    }

                    // Listen for notification clicks
                    try {
                        const unlisten = await onAction((result: any) => {
                            console.log('Notification action:', result);

                            // Handle 'mark_read' action without focusing the window
                            if (result.actionId === 'mark_read') {
                                const uid = result.notification?.extra?.uid;
                                if (uid) {
                                    const emailId = `inbox-${uid}`; // Assuming inbox since notifications are for inbox
                                    markAsRead(emailId).catch(console.error);
                                }
                                return;
                            }

                            // Handle 'open' or default click
                            invoke('show_main_window').catch(console.error);
                            setCurrentFolder("inbox"); // Force navigation to inbox

                            if (result.notification?.actionTypeId === 'new_email') {
                                const uid = result.notification?.extra?.uid;
                                if (uid) {
                                    setSelectedEmailId(`inbox-${uid}`);
                                }
                            } else if (result.notification?.actionTypeId === 'summary_email') {
                                // Just clear selection so the list is shown
                                setSelectedEmailId(null);
                            } else {
                                // Fallback for default notifications
                                const uid = result.notification?.extra?.uid;
                                if (uid) {
                                    setSelectedEmailId(`inbox-${uid}`);
                                }
                            }
                        });
                        return unlisten;
                    } catch (e: any) {
                        if (e?.includes?.("registerListener not allowed") || e?.includes?.("not found")) {
                            console.info("Notification clicks are not currently supported by Tauri on this desktop OS.");
                        } else {
                            console.error("Failed to setup notification action listener:", e);
                        }
                    }
                }
            } catch (error) {
                console.error("Failed to setup notifications:", error);
            }
        };

        const listenerPromise = setupNotifications();
        return () => {
            listenerPromise.then(listener => {
                if (listener && typeof listener.unregister === 'function') {
                    listener.unregister();
                }
            });
        };
    }, []);

    const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const searchRevision = useRef(0);
    useEffect(() => () => {
        searchRevision.current += 1;
        if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    }, []);

    const handleSearchQueryChange = (query: string) => {
        const folder = currentFolder;
        const revision = ++searchRevision.current;
        if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
        if (activeSearchState.activeSearchId) {
            void invoke('clear_search', { searchId: activeSearchState.activeSearchId }).catch(console.error);
        }
        setFolderSearchContexts(prev => ({
            ...prev,
            [folder]: {
                ...(prev[folder] || { activeSearchId: null, searchProgress: null, searchResults: [], hasMoreSearch: false, isLoadingMoreSearch: false }),
                searchQuery: query,
                activeSearchId: null, searchProgress: null, searchResults: [], hasMoreSearch: false, isLoadingMoreSearch: false
            }
        }));

        if (!query.trim()) return;
        searchTimeoutRef.current = setTimeout(async () => {
            try {
                const searchId = crypto.randomUUID();
                setFolderSearchContexts(prev => ({ ...prev, [folder]: { ...prev[folder], activeSearchId: searchId } }));
                const res: any = await invoke('search_messages', { folder, query: query.trim(), searchId });
                if (revision !== searchRevision.current) {
                    void invoke('clear_search', { searchId: res.search_id }).catch(console.error);
                    return;
                }
                const localFormatted = res.local_results.map(formatEmailFromMessage);
                const deduped = dedupeEmails(localFormatted);
                
                setFolderSearchContexts(prev => ({
                    ...prev,
                    [folder]: {
                        ...(prev[folder] || { searchQuery: query, isLoadingMoreSearch: false }),
                        activeSearchId: res.search_id,
                        searchResults: dedupeEmails([...deduped, ...(prev[folder]?.searchResults || [])]),
                        hasMoreSearch: res.remote_search_state !== 'Offline' && res.remote_search_state !== 'Unsupported',
                        searchProgress: prev[folder]?.searchProgress || {
                            search_id: res.search_id,
                            state: 'SearchingRemote',
                            matched: deduped.length,
                            downloaded: 0,
                            indexed: 0,
                            streamed: 0,
                            total: 0,
                            progress_text: 'Searching server...'
                        }
                    }
                }));
            } catch (err) {
                console.error("Search failed", err);
                if (revision !== searchRevision.current) return;
                setFolderSearchContexts(prev => ({ ...prev, [folder]: { ...prev[folder], hasMoreSearch: false,
                    searchProgress: { search_id: '', state: 'Failed', matched: 0, downloaded: 0, indexed: 0, streamed: 0, total: 0, progress_text: 'Search failed. Try again.' } } }));
            }
        }, 150);
    };

    const handleSearchClear = () => {
        ++searchRevision.current;
        if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
        const folder = currentFolder;
        if (activeSearchState.activeSearchId) {
            invoke('clear_search', { searchId: activeSearchState.activeSearchId }).catch(console.error);
        }
        setFolderSearchContexts(prev => ({
            ...prev,
            [folder]: {
                searchQuery: '',
                activeSearchId: null,
                searchProgress: null,
                searchResults: [],
                hasMoreSearch: false,
                isLoadingMoreSearch: false,
            }
        }));
    };

    const handleSearchLoadMore = async () => {
        const folder = currentFolder;
        const searchId = activeSearchState.activeSearchId;
        if (!searchId || activeSearchState.isLoadingMoreSearch || !activeSearchState.hasMoreSearch) return;

        setFolderSearchContexts(prev => ({
            ...prev,
            [folder]: { ...(prev[folder] || { searchQuery: activeSearchState.searchQuery, activeSearchId: searchId, searchProgress: activeSearchState.searchProgress, searchResults: activeSearchState.searchResults, hasMoreSearch: true }), isLoadingMoreSearch: true }
        }));

        try {
            const state: any = await invoke('load_more_results', { searchId });
            setFolderSearchContexts(prev => ({
                ...prev,
                [folder]: { 
                    ...(prev[folder] || { searchQuery: activeSearchState.searchQuery, activeSearchId: searchId, searchProgress: activeSearchState.searchProgress, searchResults: activeSearchState.searchResults }), 
                    isLoadingMoreSearch: false,
                    hasMoreSearch: state !== 'Completed'
                }
            }));
        } catch (err) {
            console.error("Failed to load more search results", err);
            setFolderSearchContexts(prev => ({
                ...prev,
                [folder]: { ...(prev[folder] || { searchQuery: activeSearchState.searchQuery, activeSearchId: searchId, searchProgress: activeSearchState.searchProgress, searchResults: activeSearchState.searchResults }), isLoadingMoreSearch: false, hasMoreSearch: false }
            }));
        }
    };

    useEffect(() => {
        let unlistenProgress: (() => void) | undefined;
        let unlistenIncremental: (() => void) | undefined;

        const setupSearchListeners = async () => {
            unlistenProgress = await listen<SearchProgressData>('mail:search_progress', (event) => {
                const progress = event.payload;
                setFolderSearchContexts(prev => {
                    const next = { ...prev };
                    for (const [folder, context] of Object.entries(next)) {
                        if (context.activeSearchId === progress.search_id) {
                            next[folder] = {
                                ...context,
                                searchProgress: progress,
                                hasMoreSearch: progress.state !== 'Cancelled' && progress.state !== 'OfflineLocalOnly' && progress.state !== 'Failed' && !progress.progress_text.includes('Local results only') && !progress.progress_text.includes('Offline')
                            };
                            break;
                        }
                    }
                    return next;
                });
            });

            unlistenIncremental = await listen<any>('mail:search_incremental', (event) => {
                const payload = event.payload;
                setFolderSearchContexts(prev => {
                    const next = { ...prev };
                    for (const [folder, context] of Object.entries(next)) {
                        if (context.activeSearchId === payload.search_id) {
                            const newEmails = payload.new_messages.map(formatEmailFromMessage);
                            const merged = dedupeEmails([...newEmails,...context.searchResults]);

                            next[folder] = {
                                ...context,
                                searchResults: merged,
                            };
                            break;
                        }
                    }
                    return next;
                });
            });
        };

        setupSearchListeners();

        return () => {
            if (unlistenProgress) unlistenProgress();
            if (unlistenIncremental) unlistenIncremental();
        };
    }, []);

    useEffect(() => {
        const handler = (event: KeyboardEvent) => {
            if (!preferences.shortcutsEnabled || event.defaultPrevented || !(event.ctrlKey || event.metaKey) || event.altKey) return;
            const target = event.target as HTMLElement;
            if (target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return;
            if (event.key.toLowerCase() === 'n' && !event.shiftKey) { event.preventDefault(); if (isComposeOpen) composeWindowRef.current?.restore(); else setIsComposeOpen(true); }
            if (isComposeOpen) return;
            if (event.key.toLowerCase() === 'k' && !event.shiftKey) { event.preventDefault(); document.querySelector<HTMLInputElement>('input[placeholder*="Search"]')?.focus(); }
            if (event.key.toLowerCase() === 'u' && event.shiftKey && selectedEmailId) { event.preventDefault(); void toggleRead(selectedEmailId); }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [preferences.shortcutsEnabled, isComposeOpen, selectedEmailId, toggleRead]);

    if (isBootstrapping) {
        return (
            <div className="h-screen w-screen flex items-center justify-center bg-[#F8F9FA]/80 dark:bg-[#09090b]/80 backdrop-blur-xl transition-colors">

                <LogoSpinner message="Syncing Inbox..." />
            </div>
        );
    }

    return (
        /* Main Dashboard Container - Full Window Fill */
        <div className="mail-workspace relative flex h-full w-full overflow-hidden" data-pane={preferences.readingPane} data-has-selection={Boolean(selectedEmailId)}>
            {/* Sync Error Toast */}
            <AnimatePresence>
                {syncError && (
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 20 }}
                        className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50 bg-red-500/90 text-white px-4 py-2 rounded-lg shadow-lg text-sm font-medium backdrop-blur-md"
                    >
                        {syncError}
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Column 1: Sidebar */}
            <Sidebar
                className="mail-sidebar-column"
                onCompose={() => { if (isComposeOpen) composeWindowRef.current?.restore(); else setIsComposeOpen(true); }}
                onCreateTagClick={() => setIsCreateTagOpen(true)}
                onEditTagClick={(tag) => setEditingTag(tag)}
                onDeleteTagClick={(tag) => setDeletingTag(tag)}
                currentFolder={currentFolder}
                onFolderSelect={folder => { setSelectedEmailId(null); setCurrentFolder(folder); }}
                unreadCounts={unreadCounts}
            />

            <div className="mail-panes">
            {/* Column 2: Message List */}
            <div className="mail-list-column flex min-h-0 flex-col">
                <EmailList key={currentFolder}
                    statusBanner={<>
                {preferences.syncPaused && <div className="flex items-center justify-between border-b border-black/5 dark:border-white/5 px-4 py-2 text-xs text-muted-foreground bg-white/20 dark:bg-white/5"><span>Background sync paused</span><button className="text-primary font-medium" onClick={() => { void updatePreferences({ syncPaused: false }).then(() => invoke("sync_mail_folder", { folder: "inbox", automatic: true })).catch(() => toast.error("Could not resume sync.")); }}>Resume</button></div>}
                {/* Sync Error Banner */}
                <AnimatePresence>
                    {syncFailure && (
                        <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            className="bg-red-500/10 border-b border-red-500/20 text-red-600 dark:text-red-400 px-4 py-2.5 flex items-center justify-between z-10"
                        >
                            <div className="flex min-w-0 items-center gap-2 overflow-hidden" title={syncFailure[1]}>
                                <AlertCircle className="w-4 h-4 shrink-0" />
                                <span className="min-w-0 text-xs font-medium truncate">
                                    Sync failed in {syncFailure[0]}: {syncFailure[1]}
                                </span>
                            </div>
                            <button
                                onClick={() => handleSync(false, syncFailure[0])}
                                className="text-xs font-bold hover:text-red-700 dark:hover:text-red-300 ml-4 shrink-0 px-2 py-1 rounded hover:bg-red-500/10 transition-colors"
                            >
                                RETRY
                            </button>
                        </motion.div>
                    )}
                </AnimatePresence>

                    </>}
                    className="flex-1 overflow-hidden"
                    emails={visibleEmails}
                    pendingMessages={currentFolder === 'sent' ? pendingMessages : []}
                    selectedEmailId={selectedEmailId}
                onSelectEmail={(id) => setSelectedEmailId(id)}
                onToggleStar={toggleStar}
                onToggleRead={toggleRead}
                onDeleteMessage={deleteMessage}
                onAddTags={(email, tags, removed) => { void handleAddTags(email, tags, removed); }}
                onSync={handleSync}
                isSyncing={isSyncing || isLoadingFolder || syncingFolders.has(currentFolder)}
                onLoadMore={loadMoreEmails}
                hasMore={activeSearchState.searchQuery ? activeSearchState.hasMoreSearch : hasMore}
                isLoadingMore={activeSearchState.searchQuery ? activeSearchState.isLoadingMoreSearch : isLoadingMore}
                listRef={emailListContainerRef}
                currentFolder={currentFolder}
                searchQuery={activeSearchState.searchQuery}
                onSearchQueryChange={handleSearchQueryChange}
                onSearchClear={handleSearchClear}
                searchProgress={activeSearchState.searchProgress}
                onSearchLoadMore={handleSearchLoadMore}
            />
            </div>

            {/* Column 3: Reading Pane */}
            <EmailDetail
                className="mail-detail-pane min-h-0 min-w-0 flex-1 flex flex-col"
                email={selectedEmail}
                onToggleStar={toggleStar}
                onDeleteMessage={deleteMessage}
                onMarkAsRead={markAsRead}
                onToggleRead={toggleRead}
                onBack={() => setSelectedEmailId(null)}
            />

            </div>
            {/* Compose Modal Overlay */}
            <AnimatePresence>
                {isComposeOpen && (
                    <ComposeModal
                        windowRef={composeWindowRef}
                        onClose={() => setIsComposeOpen(false)} 
                        onSendStart={addPendingMessage}
                        onSendSuccess={(id, messageId) => {
                            updatePendingToSyncing(id, messageId);
                            invoke("sync_mail_folder", { folder: "sent" }).catch(console.error);
                        }}
                    />
                )}
            </AnimatePresence>

            {/* Create Tag Modal */}
            <AnimatePresence>
                {isCreateTagOpen && (
                    <CreateTagModal 
                        onClose={() => setIsCreateTagOpen(false)} 
                    />
                )}
            </AnimatePresence>

            {/* Edit Tag Modal */}
            <AnimatePresence>
                {editingTag && (
                    <EditTagModal 
                        tag={editingTag}
                        onClose={() => setEditingTag(null)} 
                    />
                )}
            </AnimatePresence>

            <AnimatePresence>
                {deletingTag && (
                    <DeleteTagModal
                        tag={deletingTag}
                        onClose={() => setDeletingTag(null)}
                        onSuccess={() => {
                            setDeletingTag(null);
                            if (currentFolder === `tag:${deletingTag.id}`) {
                                setCurrentFolder('inbox');
                                fetchCache('inbox');
                            }
                        }}
                    />
                )}
            </AnimatePresence>
        </div>
    );
}
