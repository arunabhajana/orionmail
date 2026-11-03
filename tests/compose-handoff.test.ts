import {expect,it,vi} from 'vitest';
import {changeComposeSender,takeCompose} from '@/lib/compose-handoff';
import type {MailDraft} from '@/lib/drafts';
const source={id:'source',revision:3,payload:{attachments:[{id:'file'}]}} as MailDraft;
it('persists and copies before activating the new sender and consumes only for its owner',async()=>{
 const steps:string[]=[];const target={...source,id:'target'};
 await changeComposeSender('b',async()=>{steps.push('save');return source;},async saved=>{expect(saved).toBe(source);steps.push('copy');return target;},async()=>{steps.push('activate');});
 expect(steps).toEqual(['save','copy','activate']);expect(takeCompose('a')).toBeNull();expect(takeCompose('b')?.draft).toBe(target);expect(takeCompose('b')).toBeNull();
});
it('leaves the sender unchanged on a failed save or attachment copy',async()=>{
 const activate=vi.fn();const copy=vi.fn().mockRejectedValue(new Error('Attachment copy failed'));
 await expect(changeComposeSender('b',async()=>source,copy,activate)).rejects.toThrow('Attachment copy failed');expect(activate).not.toHaveBeenCalled();expect(takeCompose('b')).toBeNull();
 await expect(changeComposeSender('b',async()=>{throw new Error('Save failed');},copy,activate)).rejects.toThrow('Save failed');expect(copy).toHaveBeenCalledOnce();
});
it('clears a staged handoff if guarded activation fails',async()=>{
 await expect(changeComposeSender('b',async()=>source,async()=>source,async()=>{throw new Error('Unsaved settings');})).rejects.toThrow('Unsaved settings');expect(takeCompose('b')).toBeNull();
});
it('starts an empty compose without copying an account-owned draft',async()=>{
 const copy=vi.fn();await changeComposeSender('b',async()=>null,copy,async()=>{});expect(copy).not.toHaveBeenCalled();expect(takeCompose('b')?.draft).toBeUndefined();
});
