"use client";
import {useCallback,useEffect,useEffectEvent,useMemo,useRef,useState} from 'react';
import {usePathname,useRouter} from 'next/navigation';
import {invoke} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';
import DOMPurify from 'isomorphic-dompurify';
import {toast} from 'sonner';
import {useAuth} from './AuthContext';
import {useAppPreferences} from './AppPreferencesContext';
import {useMailboxView} from './MailboxViewContext';
import {useSync} from './SyncContext';
import {useAccountIdentities} from './accounts/AccountIdentityControls';
import {useUnifiedInbox} from '@/hooks/useUnifiedInbox';
import {ownedMail} from '@/lib/owned-mail';
import {unifiedId,sameUnifiedMessage} from '@/lib/unified-inbox';
import {mailIdentity} from '@/lib/mail-identity';
import {contactFromHeader} from '@/lib/mail-display';
import {normalizePreferences,plainTextHtml,signatureHtml} from '@/lib/app-preferences';
import {takeCompose} from '@/lib/compose-handoff';
import type {AccountTransport} from '@/lib/account-client';
import type {Email,Tag} from '@/lib/types';
import type {DraftPayload,MailDraft} from '@/lib/drafts';
import Sidebar from './Sidebar';
import EmailList from './EmailList';
import ConversationReader from './ConversationReader';
import ComposeModal,{type ComposeHandle} from './ComposeModal';
import {MessageTagPicker} from './inbox/MessageTagPicker';
import {SnoozeDialog} from './inbox/SnoozeDialog';
import {SettingSelect} from './settings/SettingsControls';
import type {FilterType} from './inbox/EmailListHeader';

type ComposeState={owner:string;key:string;draft?:MailDraft;payload?:DraftPayload};
type Action='star'|'read'|'markRead'|'delete'|'restore'|'pin';
type Forward={plain:string;html:string;from:string;to:string;cc:string;date:string;subject:string;attachments:{handle:string;name:string;size:number;mime_type:string}[]};
export default function UnifiedInbox(){
 const auth=useAuth();const {user,accounts,isAccountCurrent}=auth;const view=useMailboxView();const path=usePathname();const router=useRouter();
 const {devicePreferences,overrides}=useAppPreferences();const identities=useAccountIdentities();
 const {setIsSyncing,syncTriggerCount}=useSync();
 const [query,setQuery]=useState(''),[filter,setFilter]=useState<FilterType>('all'),[accountFilter,setAccountFilter]=useState('');
 const validFilter=accounts.some(a=>a.id===accountFilter)?accountFilter:'';
 const feed=useUnifiedInbox(query,filter,validFilter);
 const [selected,setSelected]=useState<Email|null>(null),[opening,setOpening]=useState(false),[syncing,setSyncing]=useState(false);
 const [errors,setErrors]=useState<Record<string,string>>({});
 const [preparing,setPreparing]=useState(false);
 const [syncingAccounts,setSyncingAccounts]=useState<Set<string>>(new Set());
 const syncRevision=useRef(0);
 const [compose,setCompose]=useState<ComposeState|null>(null),[tagTarget,setTagTarget]=useState<{email:Email;tags:Tag[]}|null>(null),[snoozeTarget,setSnoozeTarget]=useState<Email|null>(null);
 const [lastRows,setLastRows]=useState(feed.rows);
 if(lastRows!==feed.rows){setLastRows(feed.rows);const updated=selected&&feed.rows.find(row=>sameUnifiedMessage(row,selected));if(updated)setSelected(previous=>previous&&sameUnifiedMessage(previous,updated)?{...previous,...updated}:previous);}
 const [lastOwner,setLastOwner]=useState(user?.id);
 if(lastOwner!==user?.id){setLastOwner(user?.id);if(compose?.owner!==user?.id)setCompose(null);if(tagTarget?.email.accountId!==user?.id)setTagTarget(null);if(snoozeTarget?.accountId!==user?.id)setSnoozeTarget(null);if(selected?.accountId!==user?.id)setSelected(null);}
 const composeRef=useRef<ComposeHandle>(null);const alive=useRef(true);const queue=useRef(Promise.resolve());const sequence=useRef(0);const busy=useRef(new Set<string>());
 useEffect(()=>{alive.current=true;const teardown=()=>{alive.current=false;sequence.current++;};return teardown;},[]);
 const preferencesFor=(owner:string)=>normalizePreferences({...devicePreferences,...overrides[owner]});
 const run=useCallback((email:Email,work:(ipc:AccountTransport)=>Promise<void>,choose=true,valid:()=>boolean=()=>true)=>{
  const order=choose?++sequence.current:sequence.current;
  const task=queue.current.catch(()=>{}).then(async()=>{
   if(!alive.current||!valid())return;
   const ipc=await ownedMail(email.accountId,auth,invoke);
   if(!alive.current)return;
   if(choose&&order===sequence.current)setSelected({...email,id:unifiedId(email)});
   await work(ipc);
  }).finally(()=>{if(choose&&alive.current&&order===sequence.current)setOpening(false);});queue.current=task.catch(()=>{});return task;
 },[auth]);
 const report=(error:unknown)=>toast.error('Could not complete mail action',{description:String(error)});
 const select=(email:Email)=>{const order=sequence.current+1;setOpening(true);void run(email,async()=>{}).catch(report).finally(()=>{if(alive.current&&sequence.current===order)setOpening(false);});};
 const fields=(email:Email)=>({accountId:email.accountId,folder:email.folder,uid:email.uid,expectedUidValidity:email.uidValidity??0,localId:email.locationId});
 const patchSelected=(email:Email,patch:Partial<Email>)=>setSelected(previous=>previous&&mailIdentity(previous)===mailIdentity(email)?{...previous,...patch}:previous);
 const perform=(email:Email,action:Action)=>{
  const key=mailIdentity(email);if(busy.current.has(key))return;busy.current.add(key);
  const actionSequence=sequence.current;
  void run(email,async ipc=>{
   if(action==='delete'){
    const receipt=await ipc<{id:string}>('trash_action',{...fields(email),action:'move',requestId:crypto.randomUUID()});
    if(alive.current){setSelected(previous=>previous&&mailIdentity(previous)===key?null:previous);toast.success('Moved to Trash',{action:{label:'Undo',onClick:()=>{void run(email,async undo=>{await undo('trash_action',{...fields(email),localId:receipt.id,requestId:receipt.id,action:'restore'});feed.refresh();},false).catch(report);}}});}
   }else if(action==='pin'){
    const members=feed.rows.filter(item=>item.accountId===email.accountId&&email.threadId&&item.threadId===email.threadId);const pinned=members.filter(item=>item.pinned);const targets=pinned.length?pinned:[email];for(const target of targets)await ipc('set_mail_pin',{...fields(target),pinned:!pinned.length&&!email.pinned});if(alive.current)patchSelected(email,{pinned:!pinned.length&&!email.pinned});
   }else if(action==='star'){
    await ipc('toggle_star',{...fields(email),shouldStar:!email.starred});if(alive.current)patchSelected(email,{starred:!email.starred});
   }else if(action==='read'||action==='markRead'){
    await ipc(action==='markRead'?'mark_as_read':'toggle_read',{...fields(email),shouldRead:action==='markRead'||email.unread});if(alive.current)patchSelected(email,{unread:action==='markRead'?false:!email.unread});
   }
   feed.refresh();
  },action!=='markRead',()=>action!=='markRead'||actionSequence===sequence.current&&Boolean(email.accountId&&isAccountCurrent(email.accountId))).catch(report).finally(()=>busy.current.delete(key));
 };
 const openTags=(email:Email)=>{void run(email,async ipc=>{const tags=await ipc<Tag[]>('get_all_tags');if(alive.current)setTagTarget({email,tags});}).catch(report);};
 const openSnooze=(email:Email)=>{void run(email,async()=>{if(alive.current)setSnoozeTarget(email);}).catch(report);};
 const newMessage=()=>{
  if(!user)return;if(compose?.owner===user.id){composeRef.current?.restore();return;}
  if(busy.current.has('compose')){toast.info('A message is being prepared. Please wait.');return;}
  const owner=validFilter||user.id;
  if(owner===user.id){setCompose({owner,key:crypto.randomUUID()});return;}
  if(busy.current.has('new-compose'))return;busy.current.add('new-compose');
  void auth.switchAccount(owner,true).then(()=>{if(alive.current&&isAccountCurrent(owner))setCompose({owner,key:crypto.randomUUID()});}).catch(report).finally(()=>busy.current.delete('new-compose'));
 };
 const prepare=(email:Email,kind:'reply'|'replyAll'|'forward'|'sender')=>{
  if(compose){composeRef.current?.restore();toast.info('Close your current draft before starting another message.');return;}
  const key='compose';if(busy.current.has(key)||busy.current.has('new-compose'))return;busy.current.add(key);setPreparing(true);const notice=toast.loading('Preparing message…');
  void run(email,async ipc=>{
   const owner=email.accountId!;const prefs=preferencesFor(owner);const signature=prefs.signature.trim()?'—\n'+prefs.signature:'';
   let payload:DraftPayload={to:[],pending_to:'',cc:prefs.defaultCc,bcc:prefs.defaultBcc,subject:'',plain:signature,html:'<p></p>'+signatureHtml(prefs.signature),attachments:[]};
   let handles:string[]=[];let transferred=false;
   try{
    if(kind==='forward'){
     const original=await ipc<Forward>('prepare_forward',fields(email));handles=original.attachments.map(file=>file.handle);
     let text=original.plain;
     if(!text&&original.html){const document=new DOMParser().parseFromString(DOMPurify.sanitize(original.html),'text/html');document.querySelectorAll('style,script,head').forEach(node=>node.remove());document.querySelectorAll('br').forEach(node=>node.replaceWith('\n'));document.querySelectorAll('p,div,tr').forEach(node=>node.append('\n'));text=document.body.textContent||'';}
     const forwarded=`---------- Forwarded message ----------\nFrom: ${original.from}\nDate: ${original.date}\nSubject: ${original.subject}\nTo: ${original.to}${original.cc?'\nCc: '+original.cc:''}\n\n${text}`;
     payload={...payload,subject:/^fwd?\s*:/i.test(original.subject)?original.subject:'Fwd: '+original.subject,plain:(signature?signature+'\n\n':'')+forwarded,html:payload.html+'<p>'+plainTextHtml(forwarded)+'</p>',attachments:original.attachments.map(file=>({id:crypto.randomUUID(),...file}))};
    }else if(kind==='sender'){
     const sender=contactFromHeader(email.senderEmail).email;if(!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(sender))throw new Error('No valid sender address');payload.to=[sender];
    }else{
     const headers=await ipc<{to:string[];cc:string;in_reply_to:string|null;references:string[]}>('prepare_reply',{...fields(email),replyAll:kind==='replyAll'});
     payload={...payload,...headers,subject:/^re\s*:/i.test(email.subject)?email.subject:'Re: '+email.subject};
    }
    if(alive.current&&isAccountCurrent(owner)){setCompose({owner,key:crypto.randomUUID(),payload});transferred=true;}
   }finally{if(!transferred&&handles.length)await ipc('release_attachment_handles',{handles}).catch(()=>{});}
  }).catch(report).finally(()=>{busy.current.delete(key);if(alive.current)setPreparing(false);toast.dismiss(notice);});
 };
 const navigate=(folder:string)=>{if(!user)return;void auth.switchAccount(user.id,true).then(()=>{view.setFolder(folder);view.setUnified(false);}).catch(report);};
 const sync=async()=>{if(syncing)return;setSyncing(true);try{await invoke('sync_unified_inbox');feed.refresh();toast.info('Sync requested for connected inboxes');}catch(error){report(error);}finally{if(alive.current)setSyncing(false);}};
 const accountIds=accounts.map(a=>a.id).sort().join('\n');
 useEffect(()=>{
  let active=true;
  const finish=(owner:string)=>{syncRevision.current++;setSyncingAccounts(old=>{const next=new Set(old);next.delete(owner);return next;});};
  const stops=[
   listen<{account_id:string;folder:string}>('mail:sync_started',event=>{if(active&&event.payload.folder==='inbox'){syncRevision.current++;setSyncingAccounts(old=>new Set(old).add(event.payload.account_id));}}),
   listen<{account_id:string;folder:string;error:string}>('mail:sync_error',event=>{if(active&&event.payload.folder==='inbox'){finish(event.payload.account_id);setErrors(old=>({...old,[event.payload.account_id]:event.payload.error}));}}),
   listen<{account_id:string;folder:string}>('mail:sync_finished',event=>{if(active&&event.payload.folder==='inbox'){finish(event.payload.account_id);setErrors(old=>{const next={...old};delete next[event.payload.account_id];return next;});}})
  ];
  const revision=syncRevision.current;
  void Promise.all(accountIds.split('\n').filter(Boolean).map(async owner=>({owner,status:await invoke<{inbox_sync_in_progress:boolean;inbox_sync_error:string|null}>('get_account_health',{accountId:owner}).catch(()=>null)}))).then(rows=>{if(active&&revision===syncRevision.current){setSyncingAccounts(new Set(rows.filter(row=>row.status?.inbox_sync_in_progress).map(row=>row.owner)));setErrors(Object.fromEntries(rows.filter(row=>row.status?.inbox_sync_error).map(row=>[row.owner,row.status!.inbox_sync_error!])));}});
  return()=>{active=false;for(const stop of stops)void stop.then(fn=>fn()).catch(()=>{});};
 },[accountIds]);
 const anySyncing=syncing||syncingAccounts.size>0;
 useEffect(()=>{let active=true;queueMicrotask(()=>{if(active)setIsSyncing(anySyncing);});return()=>{active=false;setIsSyncing(false);};},[anySyncing,setIsSyncing]);
 const syncEffect=useEffectEvent(()=>{void sync();});
 const lastSyncTrigger=useRef({owner:user?.id,count:syncTriggerCount});
 useEffect(()=>{const previous=lastSyncTrigger.current;lastSyncTrigger.current={owner:user?.id,count:syncTriggerCount};let active=true;if(previous.owner===user?.id&&previous.count!==syncTriggerCount)queueMicrotask(()=>{if(active)syncEffect();});return()=>{active=false;};},[syncTriggerCount,user?.id]);
 const trayCompose=useEffectEvent(async()=>{if(user){await auth.switchAccount(user.id,true);newMessage();}});
 useEffect(()=>{const stops=[listen('tray:sync_now',()=>syncEffect()),listen('tray:compose',()=>{void trayCompose().catch(report);})];return()=>{for(const stop of stops)void stop.then(fn=>fn()).catch(()=>{});};},[]);
 // A From change uses the same saved-draft handoff as an ordinary mailbox.
 const restoreCompose=useEffectEvent(async(active:()=>boolean)=>{if(!active()||!user)return;const owner=user.id;const pending=takeCompose(owner);if(!pending)return;try{const ipc=await ownedMail(owner,auth,invoke);const draft=pending.draft?await ipc<MailDraft>('open_draft',{id:pending.draft.id}):undefined;if(active())setCompose({owner,key:pending.token,draft});}catch(error){if(active())report(error);}});
 useEffect(()=>{let active=true;queueMicrotask(()=>{void restoreCompose(()=>active);});return()=>{active=false;};},[user?.id]);
 // Keep native activations queued for the established account-specific handler.
 const notification=useEffectEvent(async()=>{const owner=await invoke<string|null>('pending_notification_account');if(owner&&alive.current){await auth.switchAccount(owner,true);if(alive.current){view.setFolder('inbox');view.setUnified(false);}}});
 useEffect(()=>{let active=true,running=false;const consume=async()=>{if(!active||running)return;running=true;try{await notification();}catch(error){if(active)report(error);}finally{running=false;}};const stop=listen('mail:notification_navigation',()=>{void consume();});void consume();return()=>{active=false;void stop.then(fn=>fn()).catch(()=>{});};},[user?.id,path]);
 const mailto=useEffectEvent(async()=>{
  if(path!=='/inbox'||!user||preparing||busy.current.has('new-compose'))return;const owner=user.id;const link=await invoke<{id:string;to:string[];cc:string;bcc:string;subject:string;body:string}|null>('pending_mailto');if(!link||!alive.current||!isAccountCurrent(owner))return;
  if(compose?.owner===owner){toast.info('Close your current draft to open the waiting email link.');return;}
  const prefs=preferencesFor(owner);setCompose({owner,key:crypto.randomUUID(),payload:{to:link.to,pending_to:'',cc:link.cc||prefs.defaultCc,bcc:link.bcc||prefs.defaultBcc,subject:link.subject,plain:link.body+(prefs.signature.trim()?'\n\n—\n'+prefs.signature:''),html:'<p>'+plainTextHtml(link.body)+'</p>'+signatureHtml(prefs.signature),attachments:[]}});await invoke('ack_mailto',{id:link.id});
 });
 const composing=Boolean(compose);
 useEffect(()=>{let active=true,running=false;const consume=async()=>{if(!active||running)return;running=true;try{await mailto();}catch(error){if(active)report(error);}finally{running=false;}};const stop=listen('mailto:pending',()=>{void consume();});void consume();return()=>{active=false;void stop.then(fn=>fn()).catch(()=>{});};},[user?.id,path,composing,preparing]);
 const keyCompose=useEffectEvent(()=>newMessage());
 useEffect(()=>{const key=(event:KeyboardEvent)=>{if(path==='/inbox'&&devicePreferences.shortcutsEnabled&&(event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='n'){event.preventDefault();keyCompose();}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[path,devicePreferences.shortcutsEnabled]);
 const tagsByAccount=useMemo(()=>Object.fromEntries(Object.entries(feed.tags).map(([owner,tags])=>[owner,Object.fromEntries(tags.map(tag=>[tag.id,tag]))])),[feed.tags]);
 const current=selected?.accountId===user?.id&&!opening ? selected : null;
 const find=(id:string)=>feed.rows.find(email=>email.id===id);
 const act=(id:string,callback:(email:Email)=>void)=>{const email=find(id);if(email)callback(email);};
 const changeFilter=(value:FilterType)=>{sequence.current++;setOpening(false);setSelected(null);setFilter(value);};
 const attention=accounts.filter(account=>account.needs_reauth||errors[account.id]);
 return <div className="mail-workspace relative flex h-full w-full overflow-hidden" data-pane={devicePreferences.readingPane} data-has-selection={Boolean(selected)}>
  <Sidebar className="mail-sidebar-column" currentFolder="unified" unifiedFilter={filter} onUnifiedFilterSelect={changeFilter} onCompose={newMessage} onFolderSelect={navigate}/>
  <div className="mail-panes">
   <EmailList className="mail-list-column" unified emails={feed.rows} tagsByAccount={tagsByAccount} selectedEmailId={selected ? feed.rows.find(row=>row.accountId===selected.accountId&&selected.threadId&&row.threadId===selected.threadId)?.id||selected.id : null} onSelectEmail={id=>act(id,select)}
    filter={filter} onFilterChange={changeFilter}
    onToggleStar={id=>act(id,email=>perform(email,'star'))} onToggleRead={id=>act(id,email=>perform(email,'read'))} onDeleteMessage={id=>act(id,email=>perform(email,'delete'))} onTogglePin={id=>act(id,email=>perform(email,'pin'))}
    onReply={id=>act(id,email=>prepare(email,'reply'))} onReplyAll={id=>act(id,email=>prepare(email,'replyAll'))} onForward={id=>act(id,email=>prepare(email,'forward'))} onNewToSender={id=>act(id,email=>prepare(email,'sender'))} onManageTags={id=>act(id,openTags)} onSnooze={id=>act(id,openSnooze)}
    isLoading={feed.loading} isLoadingMore={feed.moreLoading} hasMore={feed.hasMore} onLoadMore={()=>{void feed.loadMore();}} onSearchLoadMore={()=>{void feed.loadMore();}}
    onSync={()=>{void sync();}} isSyncing={anySyncing} searchQuery={query} onSearchQueryChange={value=>{sequence.current++;setOpening(false);setSelected(null);setQuery(value);}} onSearchClear={()=>setQuery('')}
    searchProgress={query?{search_id:'unified-local',state:feed.error?'Failed':feed.loading?'SearchingLocal':'Completed',matched:feed.rows.length,downloaded:0,indexed:0,streamed:0,total:feed.rows.length,progress_text:'Searches downloaded inbox mail'}:null}
    statusBanner={<div className="space-y-2 border-b border-border/50 px-3 pb-3"><div className="flex min-w-0 items-center justify-between gap-2"><p className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground">Inbox mail · {query?'Searches downloaded mail':`${accounts.length} connected accounts`}</p><SettingSelect compact label="Filter inboxes by account" value={validFilter} options={[["","All accounts"],...accounts.map(account=>[account.id,account.name||account.email] as const)]} onChange={value=>{sequence.current++;setSelected(null);setOpening(false);setAccountFilter(value);}}/></div>{attention.length>0&&<p role="status" className="text-[11px] text-amber-600 dark:text-amber-400">{attention.length} {attention.length===1?'account needs':'accounts need'} attention. Cached mail remains available. <button className="underline" onClick={()=>{if(user)void auth.switchAccount(user.id,true).then(()=>router.push('/settings')).catch(report);}}>Review accounts</button></p>}{feed.error&&<p role="alert" className="text-[11px] text-amber-600 dark:text-amber-400">Could not refresh inboxes. <button className="underline" onClick={feed.refresh}>Try again</button></p>}</div>}/>
   <ConversationReader className="mail-detail-pane min-h-0 min-w-0 flex-1 flex flex-col" email={current} accountBadge={current?{label:accounts.find(a=>a.id===current.accountId)?.email||'',color:identities.accounts?.[current.accountId||'']?.color}:undefined}
    onBack={()=>{sequence.current++;setOpening(false);setSelected(null);}} onAction={(email,action)=>perform(email,action)} onReply={email=>prepare(email,'reply')} onReplyAll={email=>prepare(email,'replyAll')} onForward={email=>prepare(email,'forward')} onManageTags={openTags} onSnooze={openSnooze}/>
  </div>
  {opening&&<div role="status" className="pointer-events-none absolute bottom-5 right-5 rounded-xl border border-border bg-background/95 px-4 py-2 text-xs shadow-lg">Opening the owning mailbox…</div>}
  {compose&&compose.owner===user?.id&&<ComposeModal key={compose.key} windowRef={composeRef} initialDraft={compose.draft} initialMessage={compose.payload} onClose={()=>setCompose(null)} onSendSuccess={()=>{feed.refresh();if(isAccountCurrent(compose.owner))void invoke('sync_mail_folder',{accountId:compose.owner,folder:'sent'}).catch(()=>{});}}/>}
  {tagTarget&&tagTarget.email.accountId===user?.id&&<MessageTagPicker email={tagTarget.email} tags={tagTarget.tags} onClose={()=>setTagTarget(null)} onApply={(email,addIds,removeIds)=>{void run(email,async ipc=>{const tags=await ipc<string[]>('update_message_tags',{...fields(email),addIds,removeIds});if(alive.current)patchSelected(email,{tags});feed.refresh();}).catch(report);}}/>}
  {snoozeTarget&&snoozeTarget.accountId===user?.id&&<SnoozeDialog subject={snoozeTarget.subject} onClose={()=>setSnoozeTarget(null)} onSave={async until=>{await run(snoozeTarget,async ipc=>{await ipc('snooze_mail',{...fields(snoozeTarget),until});if(alive.current){setSelected(null);setSnoozeTarget(null);}feed.refresh();toast.success('Snoozed');});}}/>}
 </div>;
}
