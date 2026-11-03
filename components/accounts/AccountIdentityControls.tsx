"use client";
import {useMemo,useSyncExternalStore} from 'react';
import {useAuth} from '../AuthContext';
import {SettingGroup,SettingRow,SettingSelect,settingButton} from '../settings/SettingsControls';
import {toast} from 'sonner';
const key='orion_account_identity';
type Identities={startup?:string; accounts?:Record<string,{color?:string;rank?:number}>};
const subscribe=(changed:()=>void)=>{window.addEventListener('storage',changed);window.addEventListener('orion:identity',changed);return()=>{window.removeEventListener('storage',changed);window.removeEventListener('orion:identity',changed);};};
const snapshot=()=>localStorage.getItem(key)||'{}';
export function useAccountIdentities(){const raw=useSyncExternalStore(subscribe,snapshot,()=> '{}');return useMemo(()=>{try{return JSON.parse(raw) as Identities;}catch{return {} as Identities;}},[raw]);}
export function AccountIdentityControls(){
 const {user,accounts,accountBusy}=useAuth();const identities=useAccountIdentities();if(!user)return null;
 const save=(value:Identities)=>{try{localStorage.setItem(key,JSON.stringify(value));window.dispatchEvent(new Event('orion:identity'));}catch{toast.error('Could not save account identity');}};
 const ordered=[...accounts].sort((a,b)=>(identities.accounts?.[a.id]?.rank??999)-(identities.accounts?.[b.id]?.rank??999));
 const move=(delta:number)=>{const nextOrder=[...ordered];const index=nextOrder.findIndex(a=>a.id===user.id),target=index+delta;if(target<0||target>=nextOrder.length)return;[nextOrder[index],nextOrder[target]]=[nextOrder[target],nextOrder[index]];save({...identities,accounts:Object.fromEntries(nextOrder.map((a,i)=>[a.id,{...identities.accounts?.[a.id],rank:i}]))});};
 return <SettingGroup title="Account identity" description="Your alias below, account colour and ordering help identify mailboxes on this device. Changes here save immediately.">
 <SettingRow id="account.colour" title="Account colour" description="Shown beside this account in the account picker."><SettingSelect label="Account colour" value={identities.accounts?.[user.id]?.color||'#3b82f6'} options={['#3b82f6','#8b5cf6','#ec4899','#10b981','#f59e0b'].map((value,i)=>([value,['Blue','Purple','Pink','Green','Amber'][i]] as const))} onChange={color=>save({...identities,accounts:{...identities.accounts,[user.id]:{...identities.accounts?.[user.id],color}}})}/></SettingRow>
 <SettingRow id="account.order" title="Account order" description="Arrange your connected accounts."><div className="flex gap-2"><button className={settingButton} disabled={accountBusy||ordered[0]?.id===user.id} onClick={()=>move(-1)}>Move up</button><button className={settingButton} disabled={accountBusy||ordered.at(-1)?.id===user.id} onClick={()=>move(1)}>Move down</button></div></SettingRow>
 <SettingRow id="account.startup" title="Open on startup" description="Choose a preferred mailbox or remember your last selection."><SettingSelect label="Startup account" value={identities.startup||''} options={[['','Last used account'],...ordered.map(a=>[a.id,a.email] as const)]} onChange={startup=>save({...identities,startup})}/></SettingRow>
 </SettingGroup>;
}
