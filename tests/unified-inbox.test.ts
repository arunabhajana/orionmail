import {expect,it,vi} from 'vitest';
import type {AccountTransport} from '@/lib/account-client';
import {ownedMail} from '@/lib/owned-mail';
import {mergeUnified,unifiedEmail,type OwnedHeader} from '@/lib/unified-inbox';
import {groupConversations} from '@/lib/conversations';
const header={folder:'inbox',uid:7,uid_validity:9,subject:'Same subject',from:'Sender',date:100,seen:false,flagged:false,message_id:'same',thread_id:'same-thread'};
const row=(account_id:string):OwnedHeader=>({account_id,header,pinned:false});
it('namespaces row IDs, pagination merges and conversations by account and UID validity',()=>{
 const a=unifiedEmail(row('a')),b=unifiedEmail(row('b'));expect(a.id).not.toBe(b.id);
 expect(unifiedEmail({...row('a'),header:{...header,uid_validity:10}}).id).not.toBe(a.id);
 expect(unifiedEmail({...row('a'),local_id:'restore'}).id).not.toBe(a.id);
 expect(unifiedEmail({...row('a'),local_id:'restore',header:{...header,uid:8}}).id).toBe(unifiedEmail({...row('a'),local_id:'restore'}).id);
 const merged=mergeUnified([a,b],[{...a,starred:true}]);expect(merged).toHaveLength(2);expect(merged[0].starred).toBe(true);expect(groupConversations(merged)).toHaveLength(2);
});
function activation(){let id='a',epoch=1;return {switchAccount:vi.fn(async(next:string)=>{id=next;epoch++;}),accountSnapshot:()=>({id,epoch}),isAccountCurrent:(owner:string,revision?:number)=>id===owner&&(revision===undefined||epoch===revision)};}
it('activates the owning account before sending a command with a colliding UID',async()=>{
 const auth=activation(),transport=vi.fn(async <T>()=>null as T);const ipc=await ownedMail('b',auth,transport as AccountTransport);
 await ipc('toggle_star',{uid:7,folder:'inbox',expectedUidValidity:9,shouldStar:true});
 expect(auth.switchAccount).toHaveBeenCalledWith('b');expect(transport).toHaveBeenCalledWith('toggle_star',{accountId:'b',uid:7,folder:'inbox',expectedUidValidity:9,shouldStar:true});
 await expect(ipc('toggle_star',{accountId:'a',uid:7})).rejects.toThrow('Account changed');
});
it('does not issue mail commands when account-change guards reject activation',async()=>{
 const auth=activation(),transport=vi.fn();auth.switchAccount.mockRejectedValue(new Error('Unsaved draft'));
 await expect(ownedMail('b',auth,transport as AccountTransport)).rejects.toThrow('Unsaved draft');expect(transport).not.toHaveBeenCalled();
 await expect(ownedMail(undefined,auth,transport as AccountTransport)).rejects.toThrow('Message account');
});
it('rejects late responses even after switching away and back to the same account',async()=>{
 const auth=activation();let resolve!:(value:unknown)=>void;const transport=vi.fn(<T>()=>new Promise<T>(done=>{resolve=value=>done(value as T);}));
 const ipc=await ownedMail('a',auth,transport as AccountTransport);const response=ipc('get_message_body',{uid:7,folder:'inbox'});const rejected=expect(response).rejects.toThrow('Account changed');
 await auth.switchAccount('b');await auth.switchAccount('a');resolve('Old body');await rejected;
});
