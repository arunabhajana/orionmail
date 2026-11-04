"use client";
import {useCallback,useEffect,useState} from 'react';
import {listen} from '@tauri-apps/api/event';
import {Send,Loader2,RefreshCw,ArrowLeft,AlertCircle,Paperclip} from 'lucide-react';
import {toast} from 'sonner';
import {useAccountInvoke} from '@/hooks/useAccountInvoke';
import type {DraftSummary,MailDraft} from '@/lib/drafts';
import {cn} from '@/lib/utils';
import {OfflineStatus} from './OfflineStatus';
type Entry=DraftSummary&{delivery_state:string;delivery_error:string|null;attempts:number};
const status=(entry:Entry)=>entry.state==='send_unknown'?'Check delivery':entry.delivery_state==='attention'?'Needs attention':entry.delivery_state==='delivering'?'Sending…':'Waiting to send';
export function OutboxFolder({accountId,onOpen,onBeforeOpen}:{accountId:string;onOpen:(draft:MailDraft)=>void;onBeforeOpen:()=>boolean}){
 const invoke=useAccountInvoke();const [rows,setRows]=useState<Entry[]>([]),[selected,setSelected]=useState<string|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false);
 const [message,setMessage]=useState<MailDraft|null>(null);
 const refresh=useCallback(async()=>{try{const rows=await invoke<Entry[]>('list_outbox',{accountId});setRows(rows);setError(null);}catch(error){setError(String(error));}finally{setLoading(false);}},[accountId,invoke]);
 useEffect(()=>{let active=true;const load=()=>{if(active)void refresh();};load();const stop=listen<string>('drafts:updated',event=>{if(event.payload===accountId)load();});return()=>{active=false;void stop.then(fn=>fn()).catch(()=>{});};},[accountId,refresh]);
 const current=rows.find(row=>row.id===selected)||rows[0];
 const currentId=current?.id;
 useEffect(()=>{let active=true;if(currentId)void invoke<MailDraft>('read_outbox',{accountId,id:currentId}).then(draft=>{if(active)setMessage(draft);}).catch(()=>{});return()=>{active=false;};},[accountId,currentId,invoke]);
 const action=async(entry:Entry,kind:'retry'|'draft'|'check')=>{
  if(busy||kind!=='retry'&&!onBeforeOpen())return;setBusy(true);
  try{
   if(kind==='retry'){if(entry.state==='checking')await invoke('sync_drafts',{accountId});await invoke('retry_outbox',{accountId,id:entry.id});toast.info('Delivery retry requested');}
   else{if(kind==='draft')await invoke('cancel_outbox',{accountId,id:entry.id});const draft=await invoke<MailDraft>('open_draft',{accountId,id:entry.id});onOpen(draft);}
   await refresh();
  }catch(error){toast.error('Could not update Outbox',{description:String(error)});}finally{setBusy(false);}
 };
 return <>
  <section className="mail-list-column flex min-h-0 flex-col">
   <header className="flex items-center justify-between gap-3 border-b border-border/60 px-5 py-4"><div><h1 className="text-sm font-semibold">Outbox <span className="ml-1 text-xs font-normal text-muted-foreground">{rows.length}</span></h1><p className="mt-1 text-xs text-muted-foreground">Saved on this device until sent.</p></div><button type="button" aria-label="Refresh Outbox" onClick={()=>{void refresh();}} className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"><RefreshCw className="size-4"/></button></header>
   <OfflineStatus/>
   <div className="min-h-0 flex-1 overflow-y-auto p-2">
    {error&&<p role="alert" className="p-3 text-xs text-amber-600 dark:text-amber-400">{error}</p>}
    {loading?<p role="status" className="p-4 text-xs text-muted-foreground">Loading saved messages…</p>:rows.length===0?<div className="px-5 py-10 text-center"><Send className="mx-auto size-6 text-muted-foreground"/><p className="mt-3 text-sm font-medium">All caught up</p><p className="mt-2 text-xs leading-relaxed text-muted-foreground">Messages waiting to send will appear here.</p></div>:rows.map(row=><button key={row.id} type="button" onClick={()=>setSelected(row.id)} aria-pressed={current?.id===row.id} className={cn('mb-2 block w-full rounded-xl border p-4 text-left transition-colors',current?.id===row.id?'border-primary/40 bg-primary/10':'border-border/50 bg-foreground/[0.02] hover:bg-foreground/5')}><span className="block truncate text-xs text-muted-foreground">To: {row.to.join(', ')}</span><span className="mt-1 block truncate text-[13px] font-semibold">{row.subject||'(No subject)'}</span><span className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{row.preview}</span><span className={cn('mt-3 inline-flex items-center gap-1.5 text-[11px]',row.delivery_state==='attention'?'text-amber-600 dark:text-amber-400':'text-primary')}>{row.delivery_state==='delivering'?<Loader2 className="size-3 animate-spin"/>:row.delivery_state==='attention'?<AlertCircle className="size-3"/>:<Send className="size-3"/>}{status(row)}{row.attachments>0&&<Paperclip className="ml-2 size-3"/>}</span></button>)}
   </div>
   {current&&<div className="flex flex-wrap gap-2 border-t border-border/60 p-3"><button disabled={busy||current.delivery_state==='delivering'} onClick={()=>{void action(current,current.state==='send_unknown'?'check':'draft');}} className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs transition-colors hover:bg-foreground/5 disabled:opacity-50"><ArrowLeft className="size-3.5"/>{current.state==='send_unknown'?'Review delivery':'Return to Drafts'}</button>{current.delivery_state!=='delivering'&&current.state!=='send_unknown'&&<button disabled={busy} onClick={()=>{void action(current,'retry');}} className="rounded-lg bg-primary/10 px-3 py-2 text-xs font-medium text-primary transition-colors hover:bg-primary/20 disabled:opacity-50">Try now</button>}</div>}
  </section>
  <section className="mail-detail-pane flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto p-6 sm:p-8">
   {current?<div className="mx-auto w-full max-w-3xl"><h2 className="text-xl font-semibold tracking-tight">{current.subject||'(No subject)'}</h2><p className="mt-2 break-words text-xs text-muted-foreground">To: {current.to.join(', ')}</p><div className="mt-6 rounded-xl border border-border/70 bg-foreground/[0.025] p-4"><p role="status" className="text-sm font-medium">{status(current)}</p><p className="mt-2 text-xs leading-relaxed text-muted-foreground">{current.delivery_error||'This message and its attachments are saved locally. Delivery resumes when OrionMail is running and connected. Fully quitting pauses delivery; reopening resumes it.'}</p></div><p className="mt-6 whitespace-pre-wrap break-words text-sm leading-relaxed">{message?.id===current.id?message.payload.plain:current.preview}</p>{current.attachments>0&&<p className="mt-4 text-xs text-muted-foreground">{current.attachments} saved {current.attachments===1?'attachment':'attachments'}</p>}</div>:<div className="m-auto max-w-xs text-center"><Send className="mx-auto size-8 text-primary/60"/><h2 className="mt-4 text-lg font-semibold">A safe place before sending</h2><p className="mt-2 text-sm leading-relaxed text-muted-foreground">Write and send while offline. OrionMail keeps a local copy and delivers it when a connection is available.</p></div>}
  </section>
 </>;
}
