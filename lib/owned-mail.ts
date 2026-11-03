import {createAccountInvoker,type AccountTransport} from './account-client';
export interface AccountActivation{switchAccount:(id:string)=>Promise<void>;accountSnapshot:()=>{id:string;epoch:number}|null;isAccountCurrent:(id:string,epoch?:number)=>boolean}
/** Activate through unsaved-work guards, then fence every command by owner and epoch. */
export async function ownedMail(owner:string|undefined,activation:AccountActivation,transport:AccountTransport){
 if(!owner)throw new Error('Message account is unavailable. Refresh the inbox.');
 if(activation.accountSnapshot()?.id!==owner)await activation.switchAccount(owner);
 const snapshot=activation.accountSnapshot();if(snapshot?.id!==owner)throw new Error('Account changed. Try again.');
 return createAccountInvoker(owner,transport,id=>activation.isAccountCurrent(id,snapshot.epoch));
}
