import type { Email } from './types';
export function pinIdentity(email:Email):string {
 return email.messageId?.trim()?JSON.stringify(['message',email.messageId.trim(),email.timestamp,email.senderEmail,email.subject]):JSON.stringify(['source',email.folder,email.uid,email.uidValidity??0]);
}
export function pinnedFirst(emails:Email[]):Email[] {
 return [...emails].sort((a,b)=>Number(Boolean(b.pinned))-Number(Boolean(a.pinned))||(b.resurfacedAt||b.timestamp)-(a.resurfacedAt||a.timestamp));
}
