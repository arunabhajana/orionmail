import {toast} from 'sonner';
const delivered=new Set<string>();
export const sendFeedbackId=(account:string,draft:string)=>`mail-send:${account}:${draft}`;
export function queuedFeedback(account:string,draft:string,subject:string){
 const id=sendFeedbackId(account,draft);if(delivered.has(id))return;
 toast.success('Saved to Outbox',{id,description:subject||'It sends automatically when connected.',duration:4500});
}
export function deliveredFeedback(account:string,draft:string,subject:string){
 const id=sendFeedbackId(account,draft);delivered.add(id);
 if(delivered.size>200)delivered.delete(delivered.values().next().value!);
 toast.success('Message sent',{id,description:subject||'(No subject)',duration:4500});
}
