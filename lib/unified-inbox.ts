import type {Email,NativeMessageHeader,Tag} from './types';
import {formatNativeEmail} from './mail-format';
export interface UnifiedCursor{pinned:boolean;date:number;account:string;folder:string;uid:number;validity:number;local_id:string}
export interface OwnedHeader{account_id:string;header:NativeMessageHeader;local_id?:string|null;pinned:boolean;resurfaced_at?:number|null}
export interface UnifiedPage{messages:OwnedHeader[];next_cursor:UnifiedCursor|null;tags:Record<string,Tag[]>}
export function unifiedId(email:Pick<Email,'accountId'|'folder'|'uid'|'uidValidity'|'locationId'>){return email.locationId ? JSON.stringify([email.accountId,'location',email.locationId]) : JSON.stringify([email.accountId,email.folder,email.uid,email.uidValidity||0,'']);}
export function unifiedEmail(row:OwnedHeader):Email{const email={...formatNativeEmail(row.header,row.account_id),locationId:row.local_id||undefined};return {...email,id:unifiedId(email),displayFolder:'inbox',pinned:row.pinned,resurfacedAt:row.resurfaced_at ? row.resurfaced_at*1000 : undefined};}
export function sameUnifiedMessage(a:Email,b:Email){
 if(a.accountId!==b.accountId)return false;
 if(a.locationId&&a.locationId===b.locationId)return true;
 if(a.messageId&&b.messageId)return a.messageId===b.messageId&&a.timestamp===b.timestamp&&a.senderEmail===b.senderEmail&&a.subject===b.subject;
 return a.folder===b.folder&&a.uid===b.uid&&a.uidValidity===b.uidValidity;
}
export function mergeUnified(previous:Email[],incoming:Email[]){const rows=new Map(previous.map(row=>[row.id,row]));for(const row of incoming)rows.set(row.id,row);return [...rows.values()];}
