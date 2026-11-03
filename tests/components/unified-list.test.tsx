import {render,screen,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import type {Email,Tag} from '@/lib/types';
const native=vi.hoisted(()=>({invoke:vi.fn(async()=>null),labels:vi.fn(),paused:false,prefetch:true}));
vi.mock('@/components/AuthContext',()=>({useAuth:()=>({user:{id:'a'},accounts:[{id:'a',email:'work@example.com'},{id:'b',email:'personal@example.com'}]})}));
vi.mock('@/hooks/useAccountInvoke',()=>({useAccountInvoke:()=>native.invoke}));
vi.mock('@tauri-apps/api/event',()=>({listen:vi.fn(async()=>()=>{})}));
vi.mock('@/components/accounts/AccountIdentityControls',()=>({useAccountIdentities:()=>({accounts:{}})}));
vi.mock('@/hooks/useVisibleMailLabels',()=>({useVisibleMailLabels:native.labels}));
vi.mock('@/hooks/useVirtualEmailList',async()=>{const React=await import('react');return {useVirtualEmailList:({itemCount}:{itemCount:number})=>({parentRef:React.useRef(null),rowVirtualizer:{scrollOffset:0,scrollRect:{height:600},measure:vi.fn(),measureElement:vi.fn(),getTotalSize:()=>200},virtualItems:Array.from({length:itemCount},(_,index)=>({index,key:index,start:index*100,end:(index+1)*100}))})};});
vi.mock('@/components/AppPreferencesContext',async()=>{const {defaultPreferences}=await import('@/lib/app-preferences');return {useAppPreferences:()=>({preferences:{...defaultPreferences,syncPaused:native.paused,prefetchBodies:native.prefetch},devicePreferences:defaultPreferences,overrides:{}})};});
import EmailList from '@/components/EmailList';
beforeEach(()=>{native.paused=false;native.prefetch=true;});
it('shows owning account markers and tags, and prefetches only active-owned UIDs',async()=>{
 vi.spyOn(document,'hasFocus').mockReturnValue(true);
 const emails:Email[]=['a','b'].map(accountId=>({accountId,id:accountId+'-7',uid:7,uidValidity:9,subject:'Hello',sender:'Sender',senderEmail:'sender@example.com',preview:'Mail',date:'Today',time:'Now',timestamp:100,unread:true,starred:false,folder:'inbox',tags:['same-tag-id'],attachments:[],threadId:'same-thread'}));
 const tag=(owner:string,name:string):Tag=>({account_id:owner,id:'same-tag-id',name,tag_type:'user',provider:'google',updated_at:0});
 render(<EmailList unified emails={emails} selectedEmailId={null} onSelectEmail={()=>{}} tagsByAccount={{a:{'same-tag-id':tag('a','Work tag')},b:{'same-tag-id':tag('b','Personal tag')}}}/>);
 expect(screen.getByText('All inboxes')).toBeInTheDocument();expect(screen.getByText('work@example.com')).toBeInTheDocument();expect(screen.getByText('personal@example.com')).toBeInTheDocument();expect(screen.getByText('Work tag')).toBeInTheDocument();expect(screen.getByText('Personal tag')).toBeInTheDocument();
 expect(native.labels).toHaveBeenCalledWith('a',[emails[0]],true);
 await waitFor(()=>expect(native.invoke).toHaveBeenCalledWith('prefetch_messages',{requests:[{account_id:'a',folder:'inbox',uid:7,uid_validity:9}]}),{timeout:2000});
});
it('honours account background-sync overrides while keeping device list styling',async()=>{
 vi.spyOn(document,'hasFocus').mockReturnValue(true);native.paused=true;native.prefetch=false;
 const email:Email={accountId:'a',id:'a-7',uid:7,uidValidity:9,subject:'Hello',sender:'Sender',senderEmail:'sender@example.com',preview:'Mail',date:'Today',time:'Now',timestamp:100,unread:true,starred:false,folder:'inbox',tags:[],attachments:[]};
 render(<EmailList unified emails={[email]} selectedEmailId={null} onSelectEmail={()=>{}}/>);
 expect(native.labels).toHaveBeenCalledWith('a',[email],false);
 await new Promise(resolve=>setTimeout(resolve,700));expect(native.invoke).not.toHaveBeenCalled();
});
