import type {MailDraft} from './drafts';
let pending: {owner:string;draft?:MailDraft;token:string}|null=null;
export function stageCompose(owner:string,draft?:MailDraft){const token=crypto.randomUUID();pending={owner,draft,token};return token;}
export function cancelCompose(token:string){if(pending?.token===token)pending=null;}
export function takeCompose(owner:string){if(pending?.owner!==owner)return null;const value=pending;pending=null;return value;}
export async function changeComposeSender(target:string,flush:()=>Promise<MailDraft|null>,copy:(source:MailDraft)=>Promise<MailDraft>,activate:()=>Promise<void>){
    const saved=await flush();
    const draft=saved ? await copy(saved) : undefined;
    const token=stageCompose(target,draft);
    try{await activate();}catch(error){cancelCompose(token);throw error;}
}
