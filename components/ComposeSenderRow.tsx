"use client";
import {SettingSelect} from './settings/SettingsControls';
type Sender={id:string;email:string};
export function ComposeSenderRow({user,accounts,disabled,reply,changing,onChange}:{user:Sender;accounts:readonly Sender[];disabled:boolean;reply:boolean;changing:boolean;onChange:(id:string)=>void}){
 return <div className="compose-sender-row flex min-h-12 shrink-0 items-center gap-3 border-b border-black/5 px-6 py-2 dark:border-white/5">
   <span className="w-12 shrink-0 text-[11px] text-muted-foreground">From</span>
   <div className="min-w-0 flex-1">{accounts.length>1 ? <SettingSelect compact label="From account" value={user.id} options={accounts.map(account=>[account.id,account.email] as const)} disabled={disabled||reply||changing} onChange={onChange}/> : <p className="truncate text-xs text-foreground/80">{user.email}</p>}</div>
   {changing&&<span role="status" className="text-[11px] text-muted-foreground">Saving copy…</span>}
 </div>;
}
