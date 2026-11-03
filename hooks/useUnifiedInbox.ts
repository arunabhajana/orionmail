"use client";
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {usePathname} from 'next/navigation';
import {invoke} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';
import {useAuth} from '@/components/AuthContext';
import type {Email,Tag} from '@/lib/types';
import {mergeUnified,unifiedEmail,type UnifiedCursor,type UnifiedPage} from '@/lib/unified-inbox';
export function useUnifiedInbox(query:string,filter:string,accountFilter:string){
 const {accounts}=useAuth();const path=usePathname();const ids=accounts.map(a=>a.id).sort().join('\n');
 const [rows,setRows]=useState<Email[]>([]),[tags,setTags]=useState<Record<string,Tag[]>>({}),[cursor,setCursor]=useState<UnifiedCursor|null>(null),[loading,setLoading]=useState(true),[moreLoading,setMoreLoading]=useState(false),[error,setError]=useState<string|null>(null);
 const generation=useRef(0),pageSize=useRef(50),resultKey=useRef('');
 const controller=useRef({busy:false,pending:false,schedule:()=>{}});
 const refresh=useCallback(()=>controller.current.schedule(),[]);
 useEffect(()=>{
  const revision=++generation.current;let active=true;let timer:ReturnType<typeof setTimeout>|undefined;const key=JSON.stringify([ids,query,filter,accountFilter]);const changed=key!==resultKey.current;resultKey.current=key;if(changed)pageSize.current=50;
  const work={busy:false,pending:false,schedule:()=>{}};
  const read=async()=>{
   if(!active)return;if(work.busy){work.pending=true;return;}work.busy=true;
   try{
    let next:UnifiedCursor|null=null;let collected:Email[]=[];let resultTags:Record<string,Tag[]>={};
    do{
     const response:UnifiedPage=await invoke('get_unified_inbox',{queryText:query,filter,accountFilter:accountFilter||null,limit:Math.min(100,pageSize.current-collected.length),cursor:next});
     if(!active)return;
     collected=mergeUnified(collected,response.messages.map(unifiedEmail));resultTags=response.tags;next=response.next_cursor;
     if(!response.messages.length)break;
    }while(next&&collected.length<pageSize.current);
    if(active){setRows(collected);setTags(resultTags);setCursor(next);setError(null);}
   }catch(e){if(active)setError(String(e));}
   finally{work.busy=false;if(active){setLoading(false);if(work.pending){work.pending=false;work.schedule();}}}
  };
  work.schedule=()=>{if(!active||path!=='/inbox'||document.visibilityState!=='visible')return;if(work.busy){work.pending=true;return;}if(!timer)timer=setTimeout(()=>{timer=undefined;void read();},250);};
  controller.current=work;
  queueMicrotask(()=>{if(active){if(changed){setLoading(true);setRows([]);setCursor(null);setMoreLoading(false);}work.schedule();}});
  const stops=path==='/inbox'?['mail:updated','mail:reconciled','mail:snoozes_changed','mail:labels_changed','mail:tags_updated'].map(event=>listen(event,work.schedule)):[];
  window.addEventListener('focus',work.schedule);document.addEventListener('visibilitychange',work.schedule);
  const invalidate=()=>{if(generation.current===revision)generation.current++;};
  return()=>{active=false;invalidate();clearTimeout(timer);window.removeEventListener('focus',work.schedule);document.removeEventListener('visibilitychange',work.schedule);for(const stop of stops)void stop.then(fn=>fn()).catch(()=>{});};
 },[ids,path,query,filter,accountFilter]);
 const loadMore=useCallback(async()=>{
  const work=controller.current;if(!cursor||work.busy||loading)return;work.busy=true;const revision=generation.current;setMoreLoading(true);
  try{const response=await invoke<UnifiedPage>('get_unified_inbox',{queryText:query,filter,accountFilter:accountFilter||null,limit:50,cursor});if(revision===generation.current){setRows(old=>mergeUnified(old,response.messages.map(unifiedEmail)));setCursor(response.next_cursor);pageSize.current+=response.messages.length;}}
  catch(e){if(revision===generation.current)setError(String(e));}
  finally{work.busy=false;if(revision===generation.current){setMoreLoading(false);if(work.pending){work.pending=false;work.schedule();}}}
 },[cursor,loading,query,filter,accountFilter]);
 const visibleRows=useMemo(()=>{const connected=new Set(ids.split('\n'));return rows.filter(row=>connected.has(row.accountId||''));},[rows,ids]);
 return {rows:visibleRows,tags,loading,error,refresh,loadMore,moreLoading,hasMore:Boolean(cursor)};
}
