"use client";

import { usePathname } from 'next/navigation';
import React, { useState, useRef, useEffect, useCallback, useMemo, useEffectEvent } from 'react';
import { Email, Tag, type NativeMessageHeader } from '@/lib/types';
import { SnoozeDialog } from './inbox/SnoozeDialog';
import { useSnoozedMail } from '@/hooks/useSnoozedMail';
import { snoozeKey } from '@/lib/snooze';
import { contactFromHeader } from '@/lib/mail-display';
import { pinIdentity, pinnedFirst } from '@/lib/mail-pins';
import DOMPurify from 'isomorphic-dompurify';
import { MessageTagPicker } from './inbox/MessageTagPicker';
import { dedupeMail, sameMail,mailIdentity, reuseUnchangedMail } from '@/lib/mail-identity';
import { formatNativeEmail } from '@/lib/mail-format';
import { AlertCircle,Pencil,RefreshCw } from 'lucide-react';
import {useMailboxCommands} from './CommandPalette';

import { motion, AnimatePresence } from 'framer-motion';
import ComposeModal, { type ComposeHandle } from '@/components/ComposeModal';
import { DraftFolder } from '@/components/inbox/DraftFolder';
import {OutboxFolder} from '@/components/inbox/OutboxFolder';
import {OfflineStatus} from '@/components/inbox/OfflineStatus';
import { useTrashOperations } from '@/hooks/useTrashOperations';
import type { PendingTrashAction } from '@/lib/trash';
import { useActiveFolderRefresh } from '@/hooks/useActiveFolderRefresh';
import { confirm } from '@tauri-apps/plugin-dialog';
import { plainTextHtml, signatureHtml } from '@/lib/app-preferences';
import type { DraftPayload, MailDraft } from '@/lib/drafts';
import { useAccountInvoke } from '@/hooks/useAccountInvoke';
import { listen } from '@tauri-apps/api/event';
import { waitForInitialMail } from '@/lib/initial-sync';
import { createEventScope } from '@/lib/event-scope';
import { useSync } from '@/components/SyncContext';
import {isAccountRequestCancelled} from '@/lib/account-client';
import {beginUnreadChange,hasPendingUnread,unreadRevision} from '@/lib/unread-changes';
import { useAuth } from '@/components/AuthContext';
import {takeCompose} from '@/lib/compose-handoff';
import LogoSpinner from '@/components/LogoSpinner';
import {useMailboxView,useMailboxNavigation} from './MailboxViewContext';
import Sidebar from '@/components/Sidebar';
import EmailList from '@/components/EmailList';
import ConversationReader from '@/components/ConversationReader';
import { usePendingSentMessages } from '@/hooks/usePendingSentMessages';
import { SearchProgressData } from '@/components/inbox/EmailListHeader';
import { CreateTagModal } from '@/components/tags/CreateTagModal';
import { EditTagModal } from '@/components/tags/EditTagModal';
import { DeleteTagModal } from '@/components/tags/DeleteTagModal';
import { toast } from 'sonner';
import { useAppPreferences } from './AppPreferencesContext';
interface FolderSearchState {
    localHasMore?:boolean;
    searchQuery: string;
    activeSearchId: string | null;
    searchProgress: SearchProgressData | null;
    searchResults: Email[];
    hasMoreSearch: boolean;
    isLoadingMoreSearch: boolean;
}

const EMPTY_SEARCH_STATE: FolderSearchState = {
    searchQuery: '', activeSearchId: null, searchProgress: null,
    searchResults: [], hasMoreSearch: false, isLoadingMoreSearch: false,
};
interface LocalLocationChoice { accountId: string; email: Email; desired: 'inbox' | 'trash' | 'deleted'; token: number; requestId: string; }

export default function MainLayout() {
    const invoke = useAccountInvoke();
    const view=useMailboxView();
    const {unified:notificationUnified,setUnified:setNotificationUnified}=view;
    const { user, accountBusy, switchAccount, accountEpoch, isAccountCurrent } = useAuth();
    const requestedFolder=view.navigation&&view.navigation.owner===user?.id?view.navigation.folder:view.folder;
    const formatEmailFromMessage = useCallback((message: NativeMessageHeader) => formatNativeEmail(message, user?.id), [user?.id]);
    const pathname=usePathname();
    const snoozes=useSnoozedMail(user?.id);
    const [showSnoozed,setShowSnoozed]=useState(requestedFolder==='snoozed');
    const [snoozeSearch,setSnoozeSearch]=useState('');
    const [snoozeTarget,setSnoozeTarget]=useState<Email|null>(null);
    const replyBusy=useRef(false);
    const [pinRows,setPinRows]=useState<Email[]>([]);
    const pinBusy=useRef(new Set<string>());
    const pinRevision=useRef(0);
    useEffect(()=>{
        if(!user?.id)return;let active=true;let stop:(()=>void)|undefined;let timer:ReturnType<typeof setTimeout>|undefined;
        const refresh=async()=>{const version=pinRevision.current;try{const rows=await invoke<NativeMessageHeader[]>('list_mail_pins',{accountId:user.id});if(active&&version===pinRevision.current&&!pinBusy.current.size)setPinRows(previous=>reuseUnchangedMail(previous,rows.map(formatEmailFromMessage).sort((a,b)=>a.id.localeCompare(b.id))));}catch(error){if(active)console.error('Could not load mail pins',error);}};
        void listen<{account_id:string}>('mail:updated',event=>{if(event.payload.account_id!==user.id||timer)return;timer=setTimeout(()=>{timer=undefined;void refresh();},1500);}).then(fn=>{if(active){stop=fn;void refresh();}else fn();});
        return()=>{active=false;stop?.();clearTimeout(timer);};
    },[user?.id, invoke, formatEmailFromMessage]);
    const [detailTags,setDetailTags]=useState<{accountId:string;email:Email;tags:Tag[]}|null>(null);
    const { preferences, updatePreferences } = useAppPreferences();
    const preferencesRef = useRef(preferences);
    useEffect(() => { preferencesRef.current = preferences; }, [preferences]);
    const activeAccountRef = useRef(user?.id);
    useEffect(() => { activeAccountRef.current = user?.id; }, [user?.id]);
    const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
    const [isComposeOpen, setIsComposeOpen] = useState(false);
    const composeOpenRef=useRef(isComposeOpen);
    useEffect(() => { composeOpenRef.current=isComposeOpen; }, [isComposeOpen]);
    const pathnameRef=useRef(pathname);
    useEffect(() => { pathnameRef.current=pathname; }, [pathname]);
    const [mailLink, setMailLink] = useState<{id:string;payload:DraftPayload}|null>(null);
    const mailLinkBusy=useRef(false);
    const [composeDraft, setComposeDraft] = useState<MailDraft | undefined>();
    useEffect(()=>{let active=true;queueMicrotask(()=>{if(!active||!user?.id)return;const handoff=takeCompose(user.id);if(!handoff)return;void (async()=>{try{const restored=handoff.draft ? await invoke<MailDraft>('open_draft',{id:handoff.draft.id}) : undefined;if(active){setComposeDraft(restored);setMailLink(null);setIsComposeOpen(true);}}catch(error){if(active)toast.error('Your copy is saved in Drafts. Could not open it.',{description:String(error)});}})();});return()=>{active=false;};},[user?.id,invoke]);
    const [locationChoices, setLocationChoices] = useState<Record<string, LocalLocationChoice>>({});
    const locationChoicesRef = useRef<Record<string, LocalLocationChoice>>({});
    const locationSerial = useRef(0);
    const locationChains = useRef(new Map<string, Promise<PendingTrashAction>>());
    const purgeConfirmations = useRef(new Set<string>());
    const composeWindowRef = useRef<ComposeHandle>(null);
    useEffect(()=>{
        if (!user?.id || pathname!=='/inbox') return;
        let active=true;let stop:(()=>void)|undefined;
        const consume=async()=>{
            if(!active)return;
            if(mailLinkBusy.current){setTimeout(()=>{if(active)void consume();},50);return;}
            mailLinkBusy.current=true;
            try{
                const link=await invoke<{id:string;to:string[];cc:string;bcc:string;subject:string;body:string}|null>('pending_mailto');
                if(!active||!link)return;
                if(isComposeOpen){composeWindowRef.current?.restore();toast.info('An email link is waiting. Close your current draft to open it.');return;}
                const html=(link.body ? '<p>'+plainTextHtml(link.body)+'</p>' : '<p></p>')+signatureHtml(preferences.signature);
                setComposeDraft(undefined);
                setMailLink({id:link.id,payload:{to:link.to,pending_to:'',cc:link.cc||preferences.defaultCc,bcc:link.bcc||preferences.defaultBcc,subject:link.subject,plain:link.body+(preferences.signature.trim()?'\n\n—\n'+preferences.signature:''),html,attachments:[]}});
                setIsComposeOpen(true);
                await invoke('ack_mailto',{id:link.id});
            }catch(error){if(active)toast.error('Could not open email link',{description:String(error)});}
            finally{mailLinkBusy.current=false;}
        };
        void listen('mailto:pending',()=>{void consume();}).then(fn=>{if(active){stop=fn;void consume();}else fn();});
        return()=>{active=false;stop?.();};
    },[user?.id,isComposeOpen,preferences.signature,preferences.defaultCc,preferences.defaultBcc,pathname, invoke]);
    const [isCreateTagOpen, setIsCreateTagOpen] = useState(false);
    const [editingTag, setEditingTag] = useState<Tag | null>(null);
    const [deletingTag, setDeletingTag] = useState<Tag | null>(null);

    // --- New State for Folders & Stars ---
    const initialFolder=requestedFolder==='snoozed'?'inbox':requestedFolder||preferences.defaultFolder;
    const [currentFolder, setCurrentFolder] = useState<string>(initialFolder);
    const currentFolderRef = useRef<string>(initialFolder); // Live reference to avoid stale closures in event listeners
    useMailboxNavigation(folder=>{
        setSelectedEmailId(null);setShowSnoozed(folder==='snoozed');setSnoozeSearch('');
        setCurrentFolder(folder==='snoozed'?'inbox':folder);
    });
    const [emails, setEmails] = useState<Email[]>([]);
    const [pendingTagAdds, setPendingTagAdds] = useState<Record<string, { accountId: string; email: Email; tags: string[]; removed: string[] }>>({});
    const tagRequests = useRef(new Set<string>());
    const [pendingFlags,setPendingFlags]=useState<Record<string,{accountId:string;email:Email;patch:Partial<Email>}>>({});
    const flagVersions=useRef(new Map<string,number>());
    const { isSyncing, setIsSyncing, setSyncMessage, unreadCounts, setUnreadCounts, syncTriggerCount, triggerSync } = useSync();
    const [isBootstrapping, setIsBootstrapping] = useState(true);
    const [isFirstSync, setIsFirstSync] = useState(false);
    const [isLoadingFolder, setIsLoadingFolder] = useState(false); // Loading skeleton when switching folders
    const [syncError, setSyncError] = useState<string | null>(null);
    const [syncErrors, setSyncErrors] = useState<Record<string, string>>({});
    const syncFailure = Object.entries(syncErrors)[0] ?? null;

    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(true);
    const emailListContainerRef = useRef<HTMLDivElement>(null);
    const emailsRef = useRef<Email[]>([]);
    const notificationTargetRef = useRef<{ accountId: string; email: Email } | null>(null);
    useEffect(() => {
        if (notificationTargetRef.current?.email.id !== selectedEmailId || currentFolder !== 'inbox') notificationTargetRef.current = null;
    }, [selectedEmailId, currentFolder]);
    const cacheRevisionRef = useRef(0);

    const [folderSearchContexts, setFolderSearchContexts] = useState<Record<string, FolderSearchState>>({});
    const folderSearchRef=useRef(folderSearchContexts);
    useEffect(() => { folderSearchRef.current=folderSearchContexts; }, [folderSearchContexts]);

    const activeSearchState = folderSearchContexts[currentFolder] || EMPTY_SEARCH_STATE;
    const { operations: pendingTrash, accept: acceptLocation } = useTrashOperations(user?.id, event => {
        if (event.account_id !== activeAccountRef.current) return false;
        if (Object.values(locationChoicesRef.current).some(choice => choice.accountId === event.account_id && (choice.requestId === event.id || choice.email.locationId === event.id))) return false;
        ++cacheRevisionRef.current;
        // Roll back from the current cached row, never an obsolete renderer
        // snapshot or a fabricated Inbox UID. Preserve the scrolled list.
        if (event.source && currentFolderRef.current === event.source.folder) {
            const restored = formatEmailFromMessage(event.source);
            setEmails(previous => dedupeMail([restored, ...previous]));
            const query = folderSearchRef.current[currentFolderRef.current]?.searchQuery;
            if (query) handleSearchQueryChange(query);
        }
    }, selectedEmailId);

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
        removePendingMessage,
        reconcileWithDb
    } = usePendingSentMessages();

    // --- Derived State ---

    const { filteredEmails, visibleEmails } = useMemo(() => {
        const receipts = new Map(pendingTrash.map(row => [mailIdentity(formatEmailFromMessage(row.source)), row]));
        const pendingTags = Object.values(pendingTagAdds).filter(item => item.accountId === user?.id);
        const overlayTags = (email: Email): Email => {
            const flagEdits = Object.values(pendingFlags).filter(edit => edit.accountId === user?.id && sameMail(edit.email, email));
            if (flagEdits.length) email = Object.assign({}, email, ...flagEdits.map(edit => edit.patch));
            const pending = pendingTags.find(item => sameMail(item.email, email));
            return pending ? { ...email, tags: [...new Set([...email.tags, ...pending.tags])].filter(id => !pending.removed.includes(id)), tagsPending: true } : email;
        };
        const candidates = new Map<string, Email>();
        const activeSnoozes=snoozes.active.map(row=>({...row,email:formatEmailFromMessage(row.message)}));
        const snoozeIds=new Map(activeSnoozes.map(row=>[snoozeKey(row.email),row.until]));
        const returned=snoozes.returned.map(row=>({...formatEmailFromMessage(row.message),resurfacedAt:row.until*1000}));
        const base = showSnoozed ? activeSnoozes.map(row=>row.email).filter(email=>(email.senderEmail+' '+email.subject+' '+email.preview).toLocaleLowerCase().includes(snoozeSearch.toLocaleLowerCase())) : activeSearchState.searchQuery ? activeSearchState.searchResults : dedupeMail([...emails,...pinRows.filter(email=>currentFolder.startsWith('tag:')||currentFolder==='starred'||email.folder===currentFolder),...returned.filter(email=>email.folder===currentFolder)]);
        const returnedTimes=new Map(returned.map(email=>[mailIdentity(email),email.resurfacedAt]));
        const pinIds=new Set(pinRows.map(pinIdentity));
        const searchMatches = new Set(base.map(mailIdentity));
        const matchesSearch = (email: Email) => {
            if (!activeSearchState.searchQuery || searchMatches.has(mailIdentity(email))) return true;
            const text = `${email.senderEmail} ${email.to || ''} ${email.subject} ${email.preview}`.toLocaleLowerCase();
            return activeSearchState.searchQuery.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).every(word => text.includes(word));
        };
        for (const email of base) {
            const identity = mailIdentity(email);
            const receipt = receipts.get(identity);
            if (receipt?.optimistic) continue;
            if (receipt && !receipt.deleted) {
                candidates.set(identity, { ...email, id: receipt.locallyTouched ? `local-${receipt.id}` : email.id, locationId: receipt.id });
            } else candidates.set(identity, email);
        }
        for (const row of pendingTrash) {
            if (row.deleted || (!row.optimistic && (!row.locallyTouched || !row.cached))) continue;
            const source = formatEmailFromMessage(row.source);
            const identity = mailIdentity(source);
            if (row.optimistic && row.desired === 'deleted') { candidates.delete(identity); continue; }
            if (row.optimistic || !candidates.has(identity)) {
                const email: Email = { ...source, id: `local-${row.id}`, locationId: row.id,
                    displayFolder: row.optimistic ? row.desired as 'inbox' | 'trash' : undefined };
                if (matchesSearch(email)) candidates.set(identity, email);
            }
        }
        for (const choice of Object.values(locationChoices)) {
            if (choice.accountId !== user?.id) continue;
            const identity = mailIdentity(choice.email);
            candidates.delete(identity);
            if (choice.desired !== 'deleted') {
                const email: Email = { ...choice.email, id: `local-${choice.requestId}`, locationId: choice.requestId, displayFolder: choice.desired };
                if (matchesSearch(email)) candidates.set(identity, email);
            }
        }
        for (const pending of pendingTags) {
            if (!candidates.has(mailIdentity(pending.email)) && pending.tags.includes(currentFolder.slice(4)) && currentFolder.startsWith('tag:') && !receipts.get(mailIdentity(pending.email))?.optimistic) {
                candidates.set(mailIdentity(pending.email), pending.email);
            }
        }
        const filteredEmails = dedupeMail([...candidates.values()].map(overlayTags).map(email=>({...email,pinned:currentFolder!=='trash'&&pinIds.has(pinIdentity(email)),snoozedUntil:snoozeIds.get(snoozeKey(email)),resurfacedAt:returnedTimes.get(mailIdentity(email))})).filter(email => {
            const folder = email.displayFolder || email.folder;
            if(showSnoozed)return folder!=='trash'&&snoozeIds.has(snoozeKey(email));
            if(activeSearchState.searchQuery)return true;
            if(currentFolder==='inbox'&&snoozeIds.has(snoozeKey(email)))return false;
            if (currentFolder === 'starred') return folder !== 'trash' && email.starred;
            if (currentFolder.startsWith('tag:')) return folder !== 'trash' && email.tags.includes(currentFolder.slice(4));
            return folder === currentFolder;
        }));
        return { filteredEmails, visibleEmails: showSnoozed?[...filteredEmails].sort((a,b)=>(a.snoozedUntil||Infinity)-(b.snoozedUntil||Infinity)):pinnedFirst(filteredEmails) };
    }, [emails, pinRows, snoozes.active, snoozes.returned, showSnoozed, snoozeSearch, pendingTagAdds, pendingFlags, locationChoices, pendingTrash, user?.id, currentFolder, activeSearchState.searchQuery, activeSearchState.searchResults, formatEmailFromMessage]);
    const conversationTargetRef = useRef<Email | null>(null);
    const selectedEmail = visibleEmails.find(e => e.id === selectedEmailId);


    useEffect(()=>{
        const online=()=>triggerSync();
        window.addEventListener('online',online);
        return()=>window.removeEventListener('online',online);
    },[triggerSync]);
    const unreadRefresh = useRef<{ again: boolean; promise: Promise<void> } | null>(null);
    const fetchUnreadCounts = useCallback((): Promise<void> => {
        if (unreadRefresh.current) {
            unreadRefresh.current.again = true;
            return unreadRefresh.current.promise;
        }
        const work = { again: false, promise: Promise.resolve() };
        unreadRefresh.current = work;
        work.promise = (async () => {
            try {
                do {
                    work.again = false;
                    const accountId = activeAccountRef.current;
                    const revision=unreadRevision();
                    const counts = await invoke<Record<string, number>>('get_unread_counts');
                    if (accountId !== activeAccountRef.current||revision!==unreadRevision()||hasPendingUnread(accountId??undefined)) continue;
                    setUnreadCounts(previous => {
                        const keys = Object.keys(counts);
                        return keys.length === Object.keys(previous).length
                            && keys.every(key => previous[key] === counts[key]) ? previous : counts;
                    });
                } while (work.again);
            } catch (error) {
                if(!isAccountRequestCancelled(error))console.error("Failed to fetch unread counts", error);
            } finally {
                if (unreadRefresh.current === work) unreadRefresh.current = null;
            }
        })();
        return work.promise;
    }, [setUnreadCounts, invoke]);

    const updateUnreadCount = (email: Email, delta: number) => {
        setUnreadCounts(prev => {
            const newCounts = { ...prev };
            const folders=new Set([email.folder.toLowerCase(),...visibleEmails.filter(row=>sameMail(row,email)).map(row=>row.folder.toLowerCase()),...email.tags.map(tag=>`tag:${tag}`.toLowerCase())]);
            if(email.tags.includes('INBOX'))folders.add('inbox');
            for(const folderId of folders)if(folderId!=='starred')newCounts[folderId] = Math.max(0, (newCounts[folderId] || 0) + delta);
            if (email.starred) {
                newCounts['starred'] = Math.max(0, (newCounts['starred'] || 0) + delta);
            }
            return newCounts;
        });
    };

    // --- Global State Sync ---
    useEffect(() => {
        void fetchUnreadCounts();
    }, [fetchUnreadCounts]);

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
            current:()=>isAccountCurrent(accountId,accountEpoch)&&flagVersions.current.get(key)===version,
            finish:()=>{if(flagVersions.current.get(key)===version)setPendingFlags(prev=>{const next={...prev};delete next[key];return next;});}
        };
    };

    const unsnooze=async(email:Email)=>{
        const accountId=user?.id;if(!accountId)return;
        const rows=snoozes.active.filter(row=>snoozeKey(formatEmailFromMessage(row.message))===snoozeKey(email));
        try{for(const row of rows)await invoke('unsnooze_mail',{accountId,key:row.key});await snoozes.refresh();setSelectedEmailId(null);toast.success('Returned to Inbox');}catch(error){toast.error('Could not unsnooze',{description:String(error)});}
    };
    const togglePin=async(email:Email)=>{
        const accountId=user?.id;if(!accountId)return;
        const key=preferences.conversationView&&email.threadId?email.threadId:pinIdentity(email);
        if(pinBusy.current.has(key))return;pinBusy.current.add(key);pinRevision.current++;
        const memberKeys=new Set(visibleEmails.filter(item=>preferences.conversationView&&email.threadId&&item.threadId===email.threadId).map(pinIdentity));
        const pinned=pinRows.filter(item=>memberKeys.has(pinIdentity(item))||pinIdentity(item)===pinIdentity(email)||(preferences.conversationView&&email.threadId&&item.threadId===email.threadId));
        const targets=pinned.length?pinned:[email];
        try{
            const unique=new Map(targets.map(item=>[pinIdentity(item),item]));
            for(const target of unique.values())await invoke('set_mail_pin',{accountId,folder:target.folder,uid:target.uid,expectedUidValidity:target.uidValidity??0,pinned:!pinned.length});
        }catch(error){toast.error('Could not update pin',{description:String(error)});}finally{
            pinBusy.current.delete(key);const version=++pinRevision.current;
            if(!pinBusy.current.size){try{const rows=await invoke<NativeMessageHeader[]>('list_mail_pins',{accountId});if(activeAccountRef.current===accountId&&pinRevision.current===version)setPinRows(previous=>reuseUnchangedMail(previous,rows.map(formatEmailFromMessage).sort((a,b)=>a.id.localeCompare(b.id))));}catch(error){toast.error('Could not refresh pins',{description:String(error)});}}
        }
    };
    const newMessageToSender=(email:Email)=>{
        if(replyBusy.current){toast.info('A message is being prepared. Try again in a moment.');return;}
        if(composeOpenRef.current){composeWindowRef.current?.restore();toast.info('Close your current draft before starting a new message.');return;}
        const sender=contactFromHeader(email.senderEmail).email;
        if(!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(sender)){toast.error('This message has no valid sender address.');return;}
        setComposeDraft(undefined);
        setMailLink({id:crypto.randomUUID(),payload:{to:[sender],pending_to:'',cc:preferences.defaultCc,bcc:preferences.defaultBcc,subject:'',plain:preferences.signature.trim()?'—\n'+preferences.signature:'',html:'<p></p>'+signatureHtml(preferences.signature),attachments:[]}});
        setIsComposeOpen(true);
    };
    const startReply = async (email:Email, replyAll=false) => {
        if(isComposeOpen){composeWindowRef.current?.restore();toast.info('Close your current draft before starting a reply.');return;}
        if(replyBusy.current||!user)return;
        replyBusy.current=true;const accountId=user.id;
        const notice=toast.loading(replyAll?'Preparing reply all…':'Preparing reply…');
        try{
            const headers=await invoke<{to:string[];cc:string;in_reply_to:string|null;references:string[]}>('prepare_reply',{accountId,replyAll,folder:email.folder,uid:email.uid,expectedUidValidity:email.uidValidity??0});
            if(activeAccountRef.current!==accountId||pathnameRef.current!=='/inbox')return;
            if(composeOpenRef.current){toast.info('Close your current draft before starting a reply.');return;}
            const signature=signatureHtml(preferences.signature);
            setComposeDraft(undefined);
            setMailLink({id:crypto.randomUUID(),payload:{...headers,pending_to:'',cc:headers.cc,bcc:preferences.defaultBcc,subject:/^re\s*:/i.test(email.subject)?email.subject:'Re: '+email.subject,plain:preferences.signature.trim()?'—\n'+preferences.signature:'',html:'<p></p>'+signature,attachments:[]}});
            setIsComposeOpen(true);
        }catch(error){toast.error('Could not prepare reply',{description:String(error)});}finally{toast.dismiss(notice);replyBusy.current=false;}
    };
    const openDetailTags=async(email:Email)=>{
        const accountId=user?.id;if(!accountId||tagRequests.current.has(accountId+':'+email.id))return;
        try{const tags=await invoke<Tag[]>('get_all_tags');if(activeAccountRef.current===accountId&&pathnameRef.current==='/inbox')setDetailTags({accountId,email,tags});}
        catch(error){toast.error('Could not load tags',{description:String(error)});}
    };
    const startForward=async(email:Email)=>{
        if(composeOpenRef.current){composeWindowRef.current?.restore();toast.info('Close your current draft before forwarding.');return;}
        if(replyBusy.current||!user)return;
        replyBusy.current=true;const accountId=user.id;const notice=toast.loading('Preparing forward…');
        let handles:string[]=[];let transferred=false;
        try{
            const original=await invoke<{plain:string;html:string;from:string;to:string;cc:string;date:string;subject:string;attachments:{handle:string;name:string;size:number;mime_type:string}[]}>('prepare_forward',{accountId,folder:email.folder,uid:email.uid,expectedUidValidity:email.uidValidity??0});
            handles=original.attachments.map(file=>file.handle);
            if(activeAccountRef.current!==accountId||pathnameRef.current!=='/inbox')return;
            if(composeOpenRef.current){toast.info('Close your current draft before forwarding.');return;}
            let text=original.plain;
            if(!text&&original.html){const document=new DOMParser().parseFromString(DOMPurify.sanitize(original.html),'text/html');document.querySelectorAll('style,script,head').forEach(node=>node.remove());document.querySelectorAll('br').forEach(node=>node.replaceWith('\n'));document.querySelectorAll('p,div,tr').forEach(node=>node.append('\n'));text=document.body.textContent||'';}
            const forwarded='---------- Forwarded message ----------\nFrom: '+original.from+'\nDate: '+original.date+'\nSubject: '+original.subject+'\nTo: '+original.to+(original.cc?'\nCc: '+original.cc:'')+'\n\n'+text;
            const signature=preferences.signature.trim()?'—\n'+preferences.signature+'\n\n':'';
            setComposeDraft(undefined);
            setMailLink({id:crypto.randomUUID(),payload:{to:[],pending_to:'',cc:preferences.defaultCc,bcc:preferences.defaultBcc,subject:/^fwd?\s*:/i.test(original.subject)?original.subject:'Fwd: '+original.subject,plain:signature+forwarded,html:'<p></p>'+signatureHtml(preferences.signature)+'<p>'+plainTextHtml(forwarded)+'</p>',attachments:original.attachments.map(file=>({id:crypto.randomUUID(),...file}))}});
            setIsComposeOpen(true);transferred=true;
        }catch(error){toast.error('Could not prepare forward',{description:String(error)});}finally{
            if(!transferred&&handles.length)void invoke('release_attachment_handles',{handles}).catch(()=>{});
            toast.dismiss(notice);replyBusy.current=false;
        }
    };
    const toggleStar = async (emailId: string) => {
        const target = (conversationTargetRef.current?.id === emailId ? conversationTargetRef.current : undefined) || filteredEmails.find(e => e.id === emailId);
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
            const receipt=await invoke<PendingTrashAction | null>('toggle_star', { accountId:user?.id, expectedUidValidity:target.uidValidity??0, uid: target.uid, shouldStar: newStarredState, folder: folderName, localId: target.locationId });
            if(receipt && activeAccountRef.current===user?.id) acceptLocation(receipt);
            if(edit.current())patchMessage(target,{starred:newStarredState});
            fetchUnreadCounts();
        } catch (err) {
            if(isAccountRequestCancelled(err)||!edit.current())return;
            console.error("Failed to toggle star", err);
            toast.error("Couldn't update star", { description: String(err) });
            // Rollback
            patchMessage(target,{starred:target.starred});
        }finally{edit.finish();}
    };

    const toggleRead = async (emailId: string) => {
        const target = (conversationTargetRef.current?.id === emailId ? conversationTargetRef.current : undefined) || filteredEmails.find(e => e.id === emailId);
        if (!target) return;

        const newReadState = Boolean(target.unread);
        const finishUnread=beginUnreadChange(user?.id??'',target,!newReadState);
        if(!finishUnread)return;
        let accepted=false;
        const edit=beginFlagEdit(target,'unread',!newReadState);

        // Optimistic Update
        setEmails(prev => prev.map(email =>
            email.id === emailId ? { ...email, unread: !newReadState } : email
        ));

        updateUnreadCount(target, newReadState ? -1 : 1);

        try {
            const folderName = target.folder || "inbox";
            const receipt=await invoke<PendingTrashAction | null>('toggle_read', { accountId:user?.id,expectedUidValidity:target.uidValidity??0,uid: target.uid, shouldRead: newReadState, folder: folderName, localId: target.locationId });
            accepted=true;
            if(receipt && activeAccountRef.current===user?.id) acceptLocation(receipt);
            if(edit.current())patchMessage(target,{unread:!newReadState});
        } catch (err) {
            if(isAccountRequestCancelled(err)||!edit.current())return;
            console.error("Failed to toggle read", err);
            toast.error("Couldn't update read status", { description: String(err) });
            // Rollback
            patchMessage(target,{unread:target.unread});
            updateUnreadCount(target,newReadState?1:-1);
        }finally{finishUnread(accepted);edit.finish();void fetchUnreadCounts();}
    };

    const markAsRead = async (emailId: string) => {
        const target = (conversationTargetRef.current?.id === emailId ? conversationTargetRef.current : undefined) || filteredEmails.find(e => e.id === emailId);
        if (!target || !target.unread) return;
        const finishUnread=beginUnreadChange(user?.id??'',target,false);
        if(!finishUnread)return;
        let accepted=false;
        const edit=beginFlagEdit(target,'unread',false);

        // Optimistic Update
        setEmails(prev => prev.map(email =>
            email.id === emailId ? { ...email, unread: false } : email
        ));

        updateUnreadCount(target, -1);

        try {
            const folderName = target.folder || "inbox";
            const receipt=await invoke<PendingTrashAction | null>('mark_as_read', { accountId:user?.id,expectedUidValidity:target.uidValidity??0,uid: target.uid, folder: folderName, localId: target.locationId });
            accepted=true;
            if(receipt && activeAccountRef.current===user?.id) acceptLocation(receipt);
            if(edit.current())patchMessage(target,{unread:false});
        } catch (err) {
            if(isAccountRequestCancelled(err)||!edit.current())return;
            console.error("Failed to mark as read", err);
            toast.error("Couldn't mark message as read", { description: String(err) });
            // Rollback
            patchMessage(target,{unread:target.unread});
            updateUnreadCount(target,1);
        }finally{finishUnread(accepted);edit.finish();void fetchUnreadCounts();}
    };

    const deleteMessage = async (emailId: string) => {
        const target = (conversationTargetRef.current?.id === emailId ? conversationTargetRef.current : undefined) || visibleEmails.find(email => email.id === emailId);
        if (target) await performTrashAction(emailId, (target.displayFolder || target.folder) === 'trash' ? 'purge' : 'move');
    };


    const performTrashAction = async (emailId: string, action: 'move' | 'restore' | 'purge') => {
        const target = (conversationTargetRef.current?.id === emailId ? conversationTargetRef.current : undefined) || visibleEmails.find(email => email.id === emailId);
        const accountId = user?.id;
        if (!target || !accountId) return;
        const identity = mailIdentity(target);
        const key = JSON.stringify([accountId, identity]);
        if (action === 'purge') {
            if (purgeConfirmations.current.has(key)) return;
            purgeConfirmations.current.add(key);
            try {
                if (!await confirm(`Permanently delete “${target.subject || '(No subject)'}”? This cannot be undone.`, { title: 'Delete forever', kind: 'warning', okLabel: 'Delete forever', cancelLabel: 'Cancel' })) return;
            } finally { purgeConfirmations.current.delete(key); }
        }
        if (activeAccountRef.current !== accountId) return;
        const desired = action === 'move' ? 'trash' : action === 'restore' ? 'inbox' : 'deleted';
        const oldChoice = locationChoicesRef.current[key];
        if (oldChoice?.desired === desired) return;
        const token = ++locationSerial.current;
        const requestId = oldChoice?.requestId || target.locationId || crypto.randomUUID();
        const choice: LocalLocationChoice = { accountId, email: target, desired, token, requestId };
        locationChoicesRef.current = { ...locationChoicesRef.current, [key]: choice };
        setLocationChoices(locationChoicesRef.current);
        ++cacheRevisionRef.current;
        if (selectedEmailId === emailId) {
            const index = visibleEmails.findIndex(email => email.id === emailId);
            const next = visibleEmails[index + 1]?.id || visibleEmails[index - 1]?.id || null;
            setSelectedEmailId(preferences.autoSelectNext ? next : null);
        }
        // Only local queue writes are ordered here. Gmail never blocks another
        // click, including a reversal on the same still-syncing message.
        const previous = locationChains.current.get(key);
        const work = (previous || Promise.resolve(undefined)).catch(() => undefined).then(async receipt => {
            if (activeAccountRef.current !== accountId) throw new Error('Account changed');
            return invoke<PendingTrashAction>('trash_action', {
                accountId, uid: target.uid, expectedUidValidity: target.uidValidity ?? 0,
                folder: target.folder, localId: receipt?.id || target.locationId || null,
                requestId, action,
            });
        });
        locationChains.current.set(key, work);
        try {
            const receipt = await work;
            if (activeAccountRef.current === accountId && locationChoicesRef.current[key]?.token === token) {
                acceptLocation(receipt, true);
                setSelectedEmailId(previous => previous === `local-${requestId}` ? `local-${receipt.id}` : previous);
            }
        } catch (error) {
            if (activeAccountRef.current === accountId && locationChoicesRef.current[key]?.token === token) {
                toast.error('Mail change reverted', { description: String(error) });
            }
        } finally {
            if (locationChoicesRef.current[key]?.token === token) {
                const next = { ...locationChoicesRef.current }; delete next[key];
                locationChoicesRef.current = next; setLocationChoices(next);
            }
            if (locationChains.current.get(key) === work) locationChains.current.delete(key);
        }
    };
    const fetchCache = async (folderToFetch = currentFolderRef.current) => {
        const revision = cacheRevisionRef.current;
        if (['drafts','outbox'].includes(folderToFetch)) {
            setEmails([]);
            setHasMore(false);
            return false;
        }

        try {
            const cached: NativeMessageHeader[] = await invoke('get_folder_messages', { folder: folderToFetch, beforeUid: null, limit: 50 });
            if (revision !== cacheRevisionRef.current || folderToFetch !== currentFolderRef.current) return false;
            if (cached && cached.length > 0) {
                const formattedEmails = cached.map(formatEmailFromMessage);
                const target = notificationTargetRef.current;
                let pinned: Email[] = [];
                if (folderToFetch === 'inbox' && target && target.accountId === activeAccountRef.current && !formattedEmails.some(email => email.id === target.email.id)) {
                    const rows = await invoke<Parameters<typeof formatEmailFromMessage>[0][]>('get_cached_message_headers', { requests: [{ folder: target.email.folder, uid: target.email.uid }] });
                    pinned = rows.map(formatEmailFromMessage).filter(email => email.uidValidity === target.email.uidValidity);
                }
                if (revision !== cacheRevisionRef.current || folderToFetch !== currentFolderRef.current) return false;
                const deduped = dedupeMail([...formattedEmails, ...pinned]);
                setEmails(previous => reuseUnchangedMail(previous, deduped));
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
                const next=dedupeMail([...head.map(formatEmailFromMessage),...existing.map(formatEmailFromMessage).filter(email=>loadedIds.has(email.id))].filter(matchesView));
                setEmails(previous => reuseUnchangedMail(previous, next));
                setSelectedEmailId(previous=>{
                    if(next.some(email=>email.id===previous))return previous;
                    const selected=loaded.find(email=>email.id===previous);
                    return selected?next.find(email=>sameMail(email,selected))?.id??null:previous;
                });
                setFolderSearchContexts(prev=>Object.fromEntries(Object.entries(prev).map(([key,state])=>{
                    const map=new Map(existing.map(formatEmailFromMessage).map(email=>[email.id,email]));
                    const queried=new Set(requested.map(email=>email.id));
                    return[key,{...state,searchResults:dedupeMail(state.searchResults.flatMap(email=>map.has(email.id)?[map.get(email.id)!]:queried.has(email.id)?[]:[email])).filter(email=>key==='starred'?email.starred:key.startsWith('tag:')?email.tags.includes(key.slice(4)):email.folder===key)}];
                })));
                void unreadFromEffect();
            }catch(error){console.error('Could not refresh cached label changes',error);}
        };
        void listen<string>('mail:labels_changed',event=>{
            if(timer)clearTimeout(timer);
            timer=setTimeout(()=>{void refresh(event.payload);},80);
        }).then(unlisten=>{if(disposed)unlisten();else stop=unlisten;}).catch(console.error);
        return()=>{disposed=true;if(timer)clearTimeout(timer);stop?.();};
    },[invoke, formatEmailFromMessage]);

    const refreshNewEmails = async (folderToFetch = currentFolderRef.current) => {
        const revision = cacheRevisionRef.current;
        if (['drafts','outbox'].includes(folderToFetch)) return;

        try {
            const cached: NativeMessageHeader[] = await invoke('get_folder_messages', { folder: folderToFetch, beforeUid: null, limit: 50 });
            if (revision !== cacheRevisionRef.current || folderToFetch !== currentFolderRef.current) return;
            if (!cached || cached.length === 0) {
                setEmails([]);
                setSelectedEmailId(null);
                fetchUnreadCounts();
                return;
            }

            const existingEmails = emailsRef.current;
            if (existingEmails.length <= 50) setHasMore(cached.length === 50);
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
                const deduped = dedupeMail(merged);
                reconcileWithDb(deduped);
                return reuseUnchangedMail(prev, deduped);
            });

            fetchUnreadCounts();
        } catch (error) {
            console.error("Failed to refresh new emails", error);
        }
    };

    const loadMoreEmails = async () => {
        const revision = cacheRevisionRef.current;
        const currentEmails = emailsRef.current;
        if (isLoadingMore || !hasMore || currentEmails.length === 0 || ['drafts','outbox'].includes(currentFolder)) return;
        setIsLoadingMore(true);
        try {
            const lastEmail = currentEmails[currentEmails.length - 1];
            const beforeUid = lastEmail.uid;

            const nextBatch: NativeMessageHeader[] = await invoke('get_folder_messages', { folder: currentFolder, beforeUid, beforeFolder: lastEmail.folder, limit: 50 });
            if (revision !== cacheRevisionRef.current || currentFolderRef.current !== currentFolder) return;
            if (nextBatch.length === 0) {
                setHasMore(false);
            } else {
                const formattedEmails = nextBatch.map(formatEmailFromMessage);
                setEmails(prev => {
                    if (revision !== cacheRevisionRef.current || currentFolderRef.current !== currentFolder) return prev;
                    const merged = [...prev, ...formattedEmails];
                    return reuseUnchangedMail(prev, dedupeMail(merged));
                });
                if (nextBatch.length < 50) {
                    setHasMore(false);
                }
            }
        } catch (err) {
            console.error("Failed to load more emails", err);
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
                    if (!removed.some(id => email.folder === `tag:${id}`)) return dedupeMail([{ ...email, tags: assigned }, ...updated]);
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
        const targetFolder = requestedFolder ?? folderAtSyncTime;
        if(targetFolder==='outbox'||!navigator.onLine)return Promise.resolve();
        if (targetFolder === 'drafts') return invoke('sync_drafts', { accountId: activeAccountRef.current }).then(() => {}).catch(error => { if (!isBackground) toast.error(String(error)); });
        if (!requestedFolder && isSyncing) return Promise.resolve();
        setIsSyncing(true);
        setSyncError(null);

        // For Starred, we just need to ensure Inbox/Sent are relatively up-to-date.
        // Tags are now directly synchronized from their respective IMAP mailboxes.
        const syncTarget = targetFolder === 'starred' ? 'inbox' : targetFolder;

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
                if (!isBackground) {
                    setSyncError("Failed to sync messages. Please try again.");
                    setTimeout(() => setSyncError(null), 3000);
                }
            })
            .finally(() => {
                setIsSyncing(false);
            });
    };
    
    const syncFromEffect = useEffectEvent((background: boolean, folder?: string) => handleSync(background, folder));
    const cacheFromEffect = useEffectEvent((folder?: string) => fetchCache(folder));
    const unreadFromEffect = useEffectEvent(() => fetchUnreadCounts());
    const refreshFromEffect = useEffectEvent((folder?: string) => refreshNewEmails(folder));
    useActiveFolderRefresh(!isBootstrapping && !preferences.syncPaused && currentFolder === 'trash', `${user?.id}:${currentFolder}`, () => handleSync(true, 'trash'));

    const lastSyncTrigger=useRef(syncTriggerCount);
    useEffect(() => {
        let active = true;
        const changed=lastSyncTrigger.current!==syncTriggerCount;lastSyncTrigger.current=syncTriggerCount;
        if (changed && syncTriggerCount > 0) {
            // Start external sync after the subscription effect has committed.
            queueMicrotask(() => { if (active) syncFromEffect(false); });
        }
        return () => { active = false; };
    }, [syncTriggerCount]);



    // IMAP IDLE and the backend fallback poll own automatic sync. A second
    // renderer timer also ran while minimized and ignored the poll preference.

    useEffect(() => {
        const subscriptions = createEventScope(listen);
        let unlistenSync: (() => void) | undefined;
        let unlistenCompose: (() => void) | undefined;
        let unlistenHidden: (() => void) | undefined;

        const setupTrayListeners = async () => {
            unlistenSync = await subscriptions.listen('tray:sync_now', () => {
                console.log("tray:sync_now event received");
                triggerSync(); // Use context trigger to avoid stale state in handleSync
            });
            
            unlistenCompose = await subscriptions.listen('tray:compose', () => {
                console.log("tray:compose event received");
                setIsComposeOpen(true);
            });
            
            unlistenHidden = await subscriptions.listen('window:hidden', async () => {
                const hintShown = localStorage.getItem("orion_tray_hint");
                if (!hintShown) {
                    try {
                        await invoke('show_background_notification');
                        localStorage.setItem("orion_tray_hint", "true");
                    } catch (e) {
                        console.error("Failed to send tray hint notification", e);
                    }
                }
            });
        };

        void setupTrayListeners().catch(console.error);

        return () => {
            subscriptions.dispose();
            if (unlistenSync) unlistenSync();
            if (unlistenCompose) unlistenCompose();
            if (unlistenHidden) unlistenHidden();
        };
    }, [invoke, triggerSync]);

    useEffect(() => {
        const controller = new AbortController();
        const timers = new Set<ReturnType<typeof setTimeout>>();
        const later = (work: () => void, ms: number) => { const timer = setTimeout(() => { timers.delete(timer); if (!controller.signal.aborted) work(); }, ms); timers.add(timer); };
        const loadCache = async () => {
            // Dedicated/placeholder views do not participate in IMAP bootstrap.
            if (['drafts','outbox'].includes(currentFolderRef.current)) {
                setIsBootstrapping(false);
                return;
            }
            const hasCache = await cacheFromEffect();
            if (controller.signal.aborted) return;
            const wasMinimized = await invoke<boolean>('was_launched_minimized').catch(() => false);

            if (controller.signal.aborted) return;
            if (!wasMinimized) {
                setSyncMessage("✓ Background sync active");
                later(() => setSyncMessage(null), 2500);
            }

            if (!hasCache && navigator.onLine && !preferencesRef.current.syncPaused && currentFolderRef.current === 'inbox') {
                const localCache = await invoke<{ messages: number }>('get_cache_summary').catch(() => null);
                if (controller.signal.aborted) return;
                setIsFirstSync(localCache?.messages === 0);
                // DB is empty, sync is likely already running in the background. Block and poll.
                // If this is a fresh launch (not after login), we trigger sync ourselves.
                syncFromEffect(false);
                await waitForInitialMail(() => cacheFromEffect(), () => invoke('get_sync_diagnostics'), controller.signal);
            }

            if (controller.signal.aborted) return;
            // Drop bootstrap loader only after emails are available
            setIsBootstrapping(false);

            if (!hasSyncedRef.current) {
                hasSyncedRef.current = true;

                // If we already had a cache, we just spun up instantly. 
                // Delay a background sync to grab new items to prevent layout jank.
                // If launched via autostart, delay 10s to let VPN/WiFi connect.
                if (hasCache) {
                    const delay = wasMinimized ? 10000 : 500;
                    later(() => {
                        syncFromEffect(true);
                    }, delay);
                }
            }
        };

        void loadCache().catch(error => { if (!controller.signal.aborted) { console.error('Mailbox setup failed', error); setIsBootstrapping(false); } });
        return () => { controller.abort(); timers.forEach(clearTimeout); };
    }, [invoke, setSyncMessage]);

    useEffect(() => {
        if (isBootstrapping) return;
        let cancelled = false;
        let syncTimer: ReturnType<typeof setTimeout> | undefined;
        const folder = currentFolder;
        const notificationTarget = notificationTargetRef.current;
        const pinned = folder === 'inbox' && notificationTarget?.accountId === activeAccountRef.current ? notificationTarget?.email : null;
        setSelectedEmailId(pinned?.id ?? null);
        setIsLoadingFolder(true);
        setEmails(pinned ? [pinned] : []);
        setHasMore(false);
        setIsLoadingMore(false);
        // DraftFolder owns its local loading and Gmail synchronization. Avoid
        // a second sync from the ordinary mailbox navigation effect.
        if (['drafts','outbox'].includes(folder)) {
            setIsLoadingFolder(false);
            return;
        }
        void cacheFromEffect(folder).then(hasCache => {
            if (cancelled) return;
            setIsLoadingFolder(false);
            if (!preferencesRef.current.syncPaused) {
                syncTimer = setTimeout(() => {
                    if (!cancelled) void syncFromEffect(true, folder);
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
        const subscriptions = createEventScope(listen);
        let unlistenUpdated: (() => void) | undefined;
        let unlistenStarted: (() => void) | undefined;
        let unlistenFinished: (() => void) | undefined;
        let unlistenError: (() => void) | undefined;
        let unlistenReconciled: (() => void) | undefined;
        let unlistenConflict: (() => void) | undefined;
        let disposed = false;
        let refreshTimer: ReturnType<typeof setTimeout> | undefined;
        let refreshing = false;
        let refreshAgain = false;
        const scheduleMailRefresh = () => {
            if (disposed) return;
            if (refreshing) { refreshAgain = true; return; }
            if (refreshTimer) return;
            refreshTimer = setTimeout(async () => {
                refreshTimer = undefined;
                if (disposed) return;
                refreshing = true;
                try {
                    const folder = currentFolderRef.current;
                    if (emailsRef.current.length === 0) await cacheFromEffect(folder);
                    else await refreshFromEffect(folder);
                } finally {
                    refreshing = false;
                    if (refreshAgain) { refreshAgain = false; scheduleMailRefresh(); }
                }
            }, 150);
        };

        const setupListener = async () => {
            unlistenReconciled = await subscriptions.listen<{ account_id: string; folder: string; updated_flags: { uid: number; seen: boolean; flagged: boolean }[]; removed_uids: number[] }>('mail:reconciled', event => {
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
                unreadFromEffect();
            });
            unlistenConflict = await subscriptions.listen<{ account_id: string; error: string }>('mail:action_conflict', event => {
                if (event.payload.account_id !== activeAccountRef.current) return;
                toast.error('A queued message action needs attention', { description: event.payload.error });
            });
            unlistenUpdated = await subscriptions.listen<{ account_id: string; folder: string }>('mail:updated', (event) => {
                if (event.payload.account_id !== activeAccountRef.current) return;
                const syncedFolder = event.payload.folder;
                const activeFolder = currentFolderRef.current;

                const isRelevant = 
                    activeFolder === syncedFolder ||
                    (activeFolder === 'starred' && syncedFolder !== 'starred');

                if (!isRelevant) return;

                scheduleMailRefresh();
            });

            unlistenStarted = await subscriptions.listen<{ account_id: string; folder: string }>('mail:sync_started', (event) => {
                if (event.payload.account_id !== activeAccountRef.current) return;
                const folder = event.payload.folder;
                setSyncingFolders(prev => new Set(prev).add(folder));
                setSyncErrors(prev => {
                    const next = { ...prev };
                    delete next[folder];
                    return next;
                });
            });

            unlistenFinished = await subscriptions.listen<{ account_id: string; folder: string }>('mail:sync_finished', (event) => {
                if (event.payload.account_id !== activeAccountRef.current) return;
                setSyncingFolders(prev => {
                    const next = new Set(prev);
                    next.delete(event.payload.folder);
                    return next;
                });
                
                // Only mail:updated reloads rows. A completed no-op sync must
                // not query the list/counts again or reset a paginated view.
            });
            
            unlistenError = await subscriptions.listen<{ account_id: string; folder: string; error: string }>('mail:sync_error', (event) => {
                if (event.payload.account_id !== activeAccountRef.current) return;
                // Recoverable sync errors already have a retry banner. Keep
                // Next.js's development error overlay out of that flow.
                console.warn(`Sync failed for ${event.payload.folder}:`, event.payload.error);
                setSyncingFolders(prev => {
                    const next = new Set(prev);
                    next.delete(event.payload.folder);
                    return next;
                });
                setSyncErrors(prev => ({
                    ...prev,
                    [event.payload.folder]: event.payload.error
                }));
            });
        };

        void setupListener().catch(console.error);

        return () => {
            subscriptions.dispose();
            if (unlistenUpdated) unlistenUpdated();
            disposed = true;
            if (refreshTimer) clearTimeout(refreshTimer);
            if (unlistenStarted) unlistenStarted();
            if (unlistenFinished) unlistenFinished();
            if (unlistenError) unlistenError();
            if (unlistenReconciled) unlistenReconciled();
            if (unlistenConflict) unlistenConflict();
        };
    }, []);

    // Register before consuming: cold-start activations are retained in Rust
    // until auth and the initial mailbox load have completed.
    useEffect(() => {
        if (!user?.id || isBootstrapping) return;
        let disposed = false;
        let running = false;
        let rerun = false;
        const stops: (() => void)[] = [];
        const consume = async () => {
            if (running) { rerun = true; return; }
            running = true;
            try {
                do {
                    rerun = false;
                    const notificationAccount = await invoke<string | null>('pending_notification_account');
                    if (disposed) return;
                    if (notificationAccount && notificationUnified) { setNotificationUnified(false); return; }
                    if (notificationAccount && (notificationAccount !== user.id || pathname !== '/inbox')) {
                        await switchAccount(notificationAccount, true);
                        return; // The remounted account/route consumes the retained activation.
                    }
                    const target = await invoke<{ account_id: string; message: Parameters<typeof formatEmailFromMessage>[0] | null } | null>('consume_notification_navigation');
                    if (disposed || !target || target.account_id !== activeAccountRef.current) continue;
                    const destination = target.message?.folder || 'inbox';
                    const current = await invoke<Parameters<typeof formatEmailFromMessage>[0][]>('get_folder_messages', { folder: destination, beforeUid: null, limit: 50 });
                    if (disposed || target.account_id !== activeAccountRef.current) continue;
                    setShowSnoozed(false);
                    currentFolderRef.current = destination;
                    cacheRevisionRef.current += 1;
                    setCurrentFolder(destination);
                    setFolderSearchContexts(prev => { const next = { ...prev }; delete next[destination]; return next; });
                    const message = target.message ? formatEmailFromMessage(target.message) : null;
                    notificationTargetRef.current = message ? { accountId: target.account_id, email: message } : null;
                    setEmails(dedupeMail([...(message ? [message] : []), ...current.map(formatEmailFromMessage)]));
                    setSelectedEmailId(message?.id ?? null);
                    setHasMore(current.length === 50);
                    rerun = true;
                } while (rerun && !disposed);
            } catch (error) {
                if (!disposed) toast.error('Could not complete notification action', { description: String(error) });
            } finally { running = false; }
        };
        const setup = async () => {
            for (const [event, handler] of [
                ['mail:notification_navigation', () => { void consume(); }],
                ['mail:notification_error', (event: { payload: string }) => toast.error('Mail action needs attention', { description: event.payload })],
            ] as const) {
                const stop = await listen<string>(event, handler);
                if (disposed) stop(); else stops.push(stop);
            }
            if (!disposed) await consume();
        };
        void setup().catch(console.error);
        return () => { disposed = true; stops.forEach(stop => stop()); };
    }, [user?.id, isBootstrapping, pathname, switchAccount, invoke, formatEmailFromMessage, notificationUnified, setNotificationUnified]);

    const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const searchRevision = useRef(0);
    useEffect(() => () => {
        searchRevision.current += 1;
        if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    }, []);

    function handleSearchQueryChange(query: string) {
        query=query.trimStart();
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
                activeSearchId: null, searchProgress: null, searchResults: [], hasMoreSearch: false, localHasMore:false,isLoadingMoreSearch: false
            }
        }));

        if (!query.trim()) return;
        searchTimeoutRef.current = setTimeout(async () => {
            try {
                const searchId = crypto.randomUUID();
                setFolderSearchContexts(prev => ({ ...prev, [folder]: { ...prev[folder], activeSearchId: searchId } }));
                const res = await invoke<{search_id:string;local_results:NativeMessageHeader[];remote_search_state:string;has_more_local?:boolean}>('search_messages', { folder, query: query.trim(), searchId });
                if (revision !== searchRevision.current) {
                    void invoke('clear_search', { searchId: res.search_id }).catch(console.error);
                    return;
                }
                const localFormatted = res.local_results.map(formatEmailFromMessage);
                const deduped = dedupeMail(localFormatted);
                
                setFolderSearchContexts(prev => ({
                    ...prev,
                    [folder]: {
                        ...(prev[folder] || { searchQuery: query, isLoadingMoreSearch: false }),
                        activeSearchId: res.search_id,
                        localHasMore:Boolean(res.has_more_local),
                        searchResults: dedupeMail([...deduped, ...(prev[folder]?.searchResults || [])]),
                        hasMoreSearch: res.remote_search_state !== 'Offline' && res.remote_search_state !== 'Unsupported',
                        searchProgress: prev[folder]?.searchProgress || {
                            search_id: res.search_id,
                            state: ['Offline','Unsupported'].includes(res.remote_search_state)?'Completed':'SearchingRemote',
                            matched: deduped.length,
                            downloaded: 0,
                            indexed: 0,
                            streamed: 0,
                            total: 0,
                            progress_text: ['Offline','Unsupported'].includes(res.remote_search_state)?'Downloaded mail · local index':'Searching server...'
                        }
                    }
                }));
            } catch (err) {
                console.warn("Search could not run", err);
                if (revision !== searchRevision.current) return;
                setFolderSearchContexts(prev => ({ ...prev, [folder]: { ...prev[folder], hasMoreSearch: false,
                    searchProgress: { search_id: '', state: 'Failed', matched: 0, downloaded: 0, indexed: 0, streamed: 0, total: 0, progress_text: String(err) } } }));
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
        if (!searchId || activeSearchState.isLoadingMoreSearch || !(activeSearchState.hasMoreSearch||activeSearchState.localHasMore)) return;

        setFolderSearchContexts(prev => ({
            ...prev,
            [folder]: { ...(prev[folder] || { searchQuery: activeSearchState.searchQuery, activeSearchId: searchId, searchProgress: activeSearchState.searchProgress, searchResults: activeSearchState.searchResults, hasMoreSearch: true }), isLoadingMoreSearch: true }
        }));

        try {
            const state = await invoke<string>('load_more_results', { searchId });
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
        const subscriptions = createEventScope(listen);
        let unlistenProgress: (() => void) | undefined;
        let unlistenIncremental: (() => void) | undefined;

        const setupSearchListeners = async () => {
            await subscriptions.listen<{search_id:string;has_more:boolean}>('mail:search_local_more',event=>setFolderSearchContexts(previous=>Object.fromEntries(Object.entries(previous).map(([folder,state])=>[folder,state.activeSearchId===event.payload.search_id?{...state,localHasMore:event.payload.has_more}:state]))));
            unlistenProgress = await subscriptions.listen<SearchProgressData>('mail:search_progress', (event) => {
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

            unlistenIncremental = await subscriptions.listen<{search_id:string;new_messages:NativeMessageHeader[]}>('mail:search_incremental', (event) => {
                const payload = event.payload;
                setFolderSearchContexts(prev => {
                    const next = { ...prev };
                    for (const [folder, context] of Object.entries(next)) {
                        if (context.activeSearchId === payload.search_id) {
                            const newEmails = payload.new_messages.map(formatEmailFromMessage);
                            const merged = dedupeMail([...newEmails,...context.searchResults]);

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

        void setupSearchListeners().catch(console.error);

        return () => {
            subscriptions.dispose();
            if (unlistenProgress) unlistenProgress();
            if (unlistenIncremental) unlistenIncremental();
        };
    }, [formatEmailFromMessage]);

    const keyboardAction = useEffectEvent((event: KeyboardEvent) => {
            if (accountBusy || !preferences.shortcutsEnabled || event.defaultPrevented || !(event.ctrlKey || event.metaKey) || event.altKey) return;
            const target = event.target as HTMLElement;
            if (target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return;
            if (pathname!=='/inbox')return;
            if (event.key.toLowerCase() === 'n' && !event.shiftKey) { event.preventDefault(); if (isComposeOpen) composeWindowRef.current?.restore(); else setIsComposeOpen(true); }
            if (isComposeOpen) return;
            if (event.key.toLowerCase() === 'u' && event.shiftKey && selectedEmailId) { event.preventDefault(); void toggleRead(selectedEmailId); }
        });
    useEffect(() => {
        const handler = (event: KeyboardEvent) => keyboardAction(event);
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, []);

    useMailboxCommands(()=>pathname!=='/inbox'||accountBusy||isBootstrapping||isComposeOpen?[]:[
        {id:'compose.'+user?.id,label:'New message',group:'Compose',keywords:'write send email',shortcut:'Ctrl N',icon:Pencil,run:()=>{setComposeDraft(undefined);setIsComposeOpen(true);}},
        {id:'sync.'+user?.id,label:'Sync this mailbox',group:'Mailbox',keywords:'refresh fetch',icon:RefreshCw,run:()=>handleSync(false)},
    ]);
    if (isBootstrapping) {
        return (
            <div className="h-screen w-screen flex items-center justify-center bg-[#F8F9FA]/80 dark:bg-[#09090b]/80 backdrop-blur-xl transition-colors">

                <div className="flex max-w-md flex-col items-center px-6 text-center" role="status" aria-live="polite">
                    <LogoSpinner message={isFirstSync ? 'Setting up your mailbox' : 'Loading your inbox…'} />
                    {isFirstSync && <p className="mt-5 text-sm leading-relaxed text-muted-foreground">Your first sync can take a little while, especially if you have a lot of mail. We’re loading your recent messages first; older emails will continue syncing in the background.</p>}
                </div>
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
                currentFolder={showSnoozed?'snoozed':currentFolder}
                onFolderSelect={folder => { setSelectedEmailId(null);setShowSnoozed(folder==='snoozed');setSnoozeSearch('');setCurrentFolder(folder==='snoozed'?'inbox':folder); }}
                unreadCounts={{...unreadCounts,snoozed:snoozes.active.length}}
            />

            <div className="mail-panes">
            {currentFolder==='outbox'?<OutboxFolder key={user?.id} accountId={user?.id||''} onBeforeOpen={()=>{if(!isComposeOpen)return true;composeWindowRef.current?.restore();toast.info('Save and close your current message first.');return false;}} onOpen={draft=>{setComposeDraft(draft);setIsComposeOpen(true);}}/>:currentFolder === 'drafts' ? <DraftFolder key={user?.id} accountId={user?.id || ''} onCompose={() => { if (isComposeOpen) composeWindowRef.current?.restore(); else { setComposeDraft(undefined); setIsComposeOpen(true); } }} onBeforeOpen={() => {
                if (!isComposeOpen) return true;
                composeWindowRef.current?.restore(); toast.info('Save and close your current message before opening another draft.'); return false;
            }} onOpen={draft => {
                setComposeDraft(draft); setIsComposeOpen(true);
            }} /> : <>
            {/* Column 2: Message List */}
            <div className="mail-list-column flex min-h-0 flex-col">
                <EmailList key={currentFolder}
                    statusBanner={<>
                <OfflineStatus/>
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
                    onSnooze={id=>{const email=visibleEmails.find(item=>item.id===id);if(email)setSnoozeTarget(email);}}
                    onUnsnooze={id=>{const email=visibleEmails.find(item=>item.id===id);if(email)void unsnooze(email);}}
                    onTogglePin={id=>{const email=visibleEmails.find(item=>item.id===id);if(email)void togglePin(email);}}
                    onNewToSender={id=>{const email=visibleEmails.find(item=>item.id===id);if(email)newMessageToSender(email);}}
                    onReplyAll={id=>{const email=visibleEmails.find(item=>item.id===id);if(email)void startReply(email,true);}}
                    onForward={id=>{const email=visibleEmails.find(item=>item.id===id);if(email)void startForward(email);}}
                    onReply={id=>{const email=visibleEmails.find(item=>item.id===id);if(email)void startReply(email);}}
                    pendingMessages={currentFolder === 'sent' ? pendingMessages : []}
                    selectedEmailId={selectedEmailId}
                onSelectEmail={(id) => setSelectedEmailId(id)}
                onToggleStar={toggleStar}
                onToggleRead={toggleRead}
                onDeleteMessage={deleteMessage}
                onRestoreMessage={id => { void performTrashAction(id, 'restore'); }}
                onAddTags={(email, tags, removed) => { void handleAddTags(email, tags, removed); }}
                onSync={handleSync}
                isSyncing={isSyncing || isLoadingFolder || syncingFolders.has(currentFolder)}
                isLoading={showSnoozed?false:isLoadingFolder}
                onLoadMore={loadMoreEmails}
                    hasMore={!showSnoozed&&(activeSearchState.searchQuery ? Boolean(activeSearchState.hasMoreSearch||activeSearchState.localHasMore) : hasMore)}
                isLoadingMore={!showSnoozed&&(activeSearchState.searchQuery ? activeSearchState.isLoadingMoreSearch : isLoadingMore)}
                listRef={emailListContainerRef}
                currentFolder={showSnoozed?'snoozed':currentFolder}
                searchQuery={showSnoozed?snoozeSearch:activeSearchState.searchQuery}
                onSearchQueryChange={showSnoozed?setSnoozeSearch:handleSearchQueryChange}
                onSearchClear={showSnoozed?()=>setSnoozeSearch(''):handleSearchClear}
                searchProgress={showSnoozed?null:activeSearchState.searchProgress}
                onSearchLoadMore={handleSearchLoadMore}
            />
            </div>

            {/* Column 3: Reading Pane */}
            <ConversationReader
                onSnooze={email=>setSnoozeTarget(email)}
                isSnoozed={email=>snoozes.active.some(row=>snoozeKey(formatEmailFromMessage(row.message))===snoozeKey(email))}
                onReplyAll={email=>{void startReply(email,true);}}
                onForward={email=>{void startForward(email);}}
                onManageTags={email=>{void openDetailTags(email);}}
                onReply={email=>{void startReply(email);}}
                className="mail-detail-pane min-h-0 min-w-0 flex-1 flex flex-col"
                email={selectedEmail}
                onAction={(message,action)=>{
                    conversationTargetRef.current=message;
                    if(action==='star')void toggleStar(message.id);
                    else if(action==='read')void toggleRead(message.id);
                    else if(action==='markRead')void markAsRead(message.id);
                    else if(action==='delete')void deleteMessage(message.id);
                    else void performTrashAction(message.id,'restore');
                    conversationTargetRef.current=null;
                }}
                onBack={() => setSelectedEmailId(null)}
            />
            </>}

            </div>
            {detailTags&&detailTags.accountId===user?.id&&pathname==='/inbox'&&<MessageTagPicker key={detailTags.accountId+':'+detailTags.email.id} email={detailTags.email} tags={detailTags.tags} onClose={()=>setDetailTags(null)} onApply={(email,added,removed)=>{void handleAddTags(email,added,removed);}}/>}
            {snoozeTarget&&pathname==='/inbox'&&<SnoozeDialog subject={snoozeTarget.subject} onClose={()=>setSnoozeTarget(null)} onSave={async until=>{const accountId=user?.id;if(!accountId)return;const savedKey=await invoke<string>('snooze_mail',{accountId,folder:snoozeTarget.folder,uid:snoozeTarget.uid,expectedUidValidity:snoozeTarget.uidValidity??0,until});if(activeAccountRef.current!==accountId)return;await snoozes.refresh();setSelectedEmailId(null);toast.success('Snoozed until '+new Date(until*1000).toLocaleString(),{action:{label:'Undo',onClick:()=>{void invoke('unsnooze_mail',{accountId,key:savedKey}).then(()=>snoozes.refresh()).catch(error=>toast.error('Could not undo snooze',{description:String(error)}));}}});}}/>}
            {/* Compose Modal Overlay */}
            <AnimatePresence>
                {isComposeOpen && (
                    <ComposeModal
                        key={`${user?.id}:${composeDraft?.id || mailLink?.id || 'new'}`}
                        initialDraft={composeDraft}
                        initialMessage={mailLink?.payload}
                        windowRef={composeWindowRef}
                        onClose={() => { setIsComposeOpen(false); setComposeDraft(undefined); setMailLink(null); }}
                        onSendStart={addPendingMessage}
                        onSendFailure={removePendingMessage}
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
