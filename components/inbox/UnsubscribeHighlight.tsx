"use client";
import {useMemo} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {confirm} from '@tauri-apps/plugin-dialog';
import {toast} from 'sonner';
export function UnsubscribeHighlight({html,loading}:{html:string;loading:boolean}){
 const target=useMemo(()=>{
  if(!html||typeof DOMParser==='undefined')return null;
  const doc=new DOMParser().parseFromString(html,'text/html');
  for(const a of Array.from(doc.querySelectorAll('a[href]'))){
   if(!/\bunsubscribe\b/i.test(a.textContent||''))continue;
   try{const url=new URL(a.getAttribute('href')||'');if(['https:','http:','mailto:'].includes(url.protocol)&&!url.username&&!url.password)return url;}catch{}
  }
  return null;
 },[html]);
 if(loading||!target)return null;
 return <section aria-label="Unsubscribe highlight" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-foreground/[0.025] p-4"><div><p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Highlights</p><h2 className="mt-1 text-xs font-medium">Manage this subscription</h2><p className="mt-1 text-[11px] text-muted-foreground">Sender-provided link · {target.hostname||target.pathname}</p></div><button type="button" className="rounded-lg border border-border px-3 py-2 text-xs transition-colors hover:bg-primary/10 hover:text-primary" onClick={()=>{void (async()=>{if(await confirm(`Open the sender’s unsubscribe link? Only continue if you trust this message.\n\n${target.href.slice(0,1000)}`,{title:'Unsubscribe',okLabel:'Continue',cancelLabel:'Cancel'}))await invoke('open_url',{url:target.href});})().catch(()=>toast.error('Could not open the unsubscribe link.'));}}>Unsubscribe</button></section>;
}
