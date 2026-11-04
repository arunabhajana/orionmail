"use client";
import {useEffect,useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';
import {useAuth} from '@/components/AuthContext';
import {hasPendingUnread,subscribeUnreadChanges,unreadRevision} from '@/lib/unread-changes';
export function useAccountUnreadOverview(enabled=true){
 const {accounts}=useAuth();const ids=accounts.map(a=>a.id).sort().join('\n');
 const [counts,setCounts]=useState<Record<string,number>>({});
 useEffect(()=>{if(!enabled)return;let active=true,running=false,again=false;let timer:ReturnType<typeof setTimeout>|undefined;
 const refresh=async()=>{if(!active||document.visibilityState!=='visible'||hasPendingUnread())return;if(running){again=true;return;}running=true;const revision=unreadRevision();try{const next=await invoke<Record<string,number>>('get_account_unread_counts');if(active&&revision===unreadRevision()&&!hasPendingUnread())setCounts(next);}catch{if(active&&revision===unreadRevision()&&!hasPendingUnread())setCounts({});}finally{running=false;if(again){again=false;schedule();}}};
 const schedule=()=>{if(!active||timer||document.visibilityState!=='visible')return;timer=setTimeout(()=>{timer=undefined;void refresh();},200);};
 const unsubscribe=subscribeUnreadChanges(change=>{if(!active)return;setCounts(previous=>previous[change.accountId]===undefined?previous:{...previous,[change.accountId]:Math.max(0,previous[change.accountId]+change.delta)});if(!change.pending)schedule();});
 schedule();const stops=['mail:updated','mail:reconciled','mail:labels_changed'].map(name=>listen(name,schedule));window.addEventListener('focus',schedule);document.addEventListener('visibilitychange',schedule);
 return()=>{active=false;unsubscribe();clearTimeout(timer);window.removeEventListener('focus',schedule);document.removeEventListener('visibilitychange',schedule);for(const stop of stops)void stop.then(fn=>fn()).catch(()=>{});};
 },[ids,enabled]);
 const visible=Object.fromEntries(accounts.filter(a=>counts[a.id]!==undefined).map(a=>[a.id,counts[a.id]]));
 return {counts:visible,total:accounts.every(a=>visible[a.id]!==undefined)?Object.values(visible).reduce((a,b)=>a+b,0):null};
}
