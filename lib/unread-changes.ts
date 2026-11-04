import {mailIdentity} from './mail-identity';
import type {Email} from './types';

type Change = {accountId:string;email:Email;unread:boolean;delta:number;pending:boolean};
const listeners=new Set<(change:Change)=>void>();
const pending=new Map<string,{accountId:string;unread:boolean}>();
let revision=0;
export const unreadRevision=()=>revision;
export const hasPendingUnread=(accountId?:string)=>[...pending.values()].some(change=>!accountId||change.accountId===accountId);
export const optimisticUnread=(email:Email)=>pending.get(JSON.stringify([email.accountId??'',mailIdentity(email)]))?.unread;
export const subscribeUnreadChanges=(listener:(change:Change)=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
export function beginUnreadChange(accountId:string,email:Email,unread:boolean){
 const key=JSON.stringify([accountId,mailIdentity(email)]);
 if(email.unread===unread||pending.has(key))return null;
 pending.set(key,{accountId,unread});
 const delta=(email.displayFolder||email.folder)==='trash'?0:unread?1:-1;
 revision++;for(const notify of listeners)notify({accountId,email,unread,delta,pending:true});
 let active=true;
 return (success:boolean)=>{
  if(!active)return;active=false;pending.delete(key);revision++;
  for(const notify of listeners)notify({accountId,email,unread:success?unread:email.unread,delta:success?0:-delta,pending:false});
 };
}
