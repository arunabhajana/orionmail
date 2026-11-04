import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import type {ReactNode} from 'react';
import type {Email} from '@/lib/types';
const native=vi.hoisted(()=>({id:'a',epoch:1,blocked:false,filter:'all',listeners:new Set<()=>void>(),invoke:vi.fn(),switchAccount:vi.fn(),refresh:vi.fn(),reader:null as null|{onAction:(email:Email,action:'markRead')=>void}}));
const rows:Email[]=['a','b'].map(accountId=>({accountId,id:JSON.stringify([accountId,'inbox',7,9,'']),uid:7,uidValidity:9,subject:'Hello',sender:'Sender',senderEmail:'sender@example.com',preview:'Mail',date:'Today',time:'Now',timestamp:100,unread:true,starred:false,folder:'inbox',tags:[],attachments:[]}));
vi.mock('@/components/AuthContext',async()=>{const React=await import('react');return {useAuth:()=>{const id=React.useSyncExternalStore(callback=>{native.listeners.add(callback);return()=>native.listeners.delete(callback);},()=>native.id);return {user:{id,email:id+'@example.com'},accounts:['a','b'].map(id=>({id,email:id+'@example.com'})),accountBusy:false,switchAccount:native.switchAccount,accountSnapshot:()=>({id:native.id,epoch:native.epoch}),isAccountCurrent:(owner:string,epoch?:number)=>owner===native.id&&(epoch===undefined||epoch===native.epoch)};}};});
vi.mock('@tauri-apps/api/core',()=>({invoke:native.invoke}));
vi.mock('@tauri-apps/api/event',()=>({listen:vi.fn(async()=>()=>{})}));
vi.mock('next/navigation',()=>({usePathname:()=>'/inbox',useRouter:()=>({push:vi.fn()})}));
vi.mock('@/components/AppPreferencesContext',async()=>{const {defaultPreferences}=await import('@/lib/app-preferences');return {useAppPreferences:()=>({devicePreferences:defaultPreferences,overrides:{}})};});
vi.mock('@/components/accounts/AccountIdentityControls',()=>({useAccountIdentities:()=>({accounts:{}})}));
vi.mock('@/hooks/useUnifiedInbox',()=>({useUnifiedInbox:(_query:string,filter:string)=>{native.filter=filter;return {rows,tags:{},loading:false,error:null,refresh:native.refresh,hasMore:false,loadMore:vi.fn(),beginRead:()=>()=>{},moreLoading:false};}}));
vi.mock('@/components/SyncContext',()=>({useSync:()=>({setIsSyncing:vi.fn(),syncTriggerCount:0})}));
vi.mock('@/components/Sidebar',()=>({default:({onCompose,unifiedFilter,onUnifiedFilterSelect}:{onCompose:()=>void;unifiedFilter:string;onUnifiedFilterSelect:(filter:'all'|'unread'|'flagged')=>void})=> <nav>All inboxes<button onClick={onCompose}>Compose new</button><button aria-pressed={unifiedFilter==='flagged'} onClick={()=>onUnifiedFilterSelect('flagged')}>Sidebar starred</button></nav>}));
vi.mock('@/components/settings/SettingsControls',()=>({SettingSelect:({label,value,options,onChange}:{label:string;value:string;options:readonly(readonly[string,string])[];onChange:(value:string)=>void})=><select aria-label={label} value={value} onChange={event=>onChange(event.target.value)}>{options.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>}));
vi.mock('@/components/EmailList',()=>({default:(props:{statusBanner?:ReactNode;onSelectEmail:(id:string)=>void;onToggleStar:(id:string)=>void})=><div>{props.statusBanner}{rows.map(row=><div key={row.id}><button onClick={()=>props.onSelectEmail(row.id)}>Open {row.accountId}</button><button onClick={()=>props.onToggleStar(row.id)}>Star {row.accountId}</button></div>)}</div>}));
vi.mock('@/components/ConversationReader',()=>({default:(props:{email?:Email|null;onReply:(email:Email)=>void;onAction:(email:Email,action:'markRead')=>void})=>{native.reader=props;return <section>{props.email&&<><p>Reading {props.email.accountId}</p><button onClick={()=>props.onReply(props.email!)}>Reply</button></>}</section>;}}));
vi.mock('@/components/ComposeModal',()=>({default:()=> <p>Compose from {native.id}</p>}));
import UnifiedInbox from '@/components/UnifiedInbox';
beforeEach(()=>{native.id='a';native.epoch=1;native.blocked=false;native.invoke.mockReset();native.switchAccount.mockReset();native.switchAccount.mockImplementation(async(id:string)=>{if(native.blocked)throw new Error('Save your draft first');native.id=id;native.epoch++;for(const listener of native.listeners)listener();});native.invoke.mockImplementation(async(command:string)=>command==='prepare_reply'?{to:['sender@example.com'],cc:'',in_reply_to:'message',references:[]}:null);});
it('reads and acts on a foreign mailbox through guarded owner activation',async()=>{
 render(<UnifiedInbox/>);fireEvent.click(screen.getByText('Open b'));await screen.findByText('Reading b');
 expect(native.switchAccount).toHaveBeenCalledWith('b');fireEvent.click(screen.getByText('Star b'));
 await waitFor(()=>expect(native.invoke).toHaveBeenCalledWith('toggle_star',expect.objectContaining({accountId:'b',uid:7,expectedUidValidity:9,shouldStar:true})));
 fireEvent.click(screen.getByText('Reply'));await screen.findByText('Compose from b');expect(native.invoke).toHaveBeenCalledWith('prepare_reply',expect.objectContaining({accountId:'b',uid:7}));
});
it('leaves the owning mailbox unchanged when switching is blocked by unsaved work',async()=>{
 render(<UnifiedInbox/>);fireEvent.click(screen.getByText('Open a'));await screen.findByText('Reading a');native.blocked=true;fireEvent.click(screen.getByText('Star b'));
 await waitFor(()=>expect(native.switchAccount).toHaveBeenCalledWith('b'));expect(native.id).toBe('a');expect(screen.getByText('Reading a')).toBeInTheDocument();expect(native.invoke.mock.calls.some(([command])=>command==='toggle_star')).toBe(false);
});
it('does not let a stale automatic read timer reactivate the old mailbox',async()=>{
 render(<UnifiedInbox/>);fireEvent.click(screen.getByText('Open a'));await screen.findByText('Reading a');const oldReader=native.reader!;
 act(()=>{fireEvent.click(screen.getByText('Open b'));oldReader.onAction(rows[0],'markRead');});await screen.findByText('Reading b');
 await waitFor(()=>expect(native.id).toBe('b'));expect(native.invoke.mock.calls.some(([command])=>command==='mark_as_read')).toBe(false);
});
it('starts a new message from the account selected by the inbox filter',async()=>{
 render(<UnifiedInbox/>);fireEvent.change(screen.getByLabelText('Filter inboxes by account'),{target:{value:'b'}});fireEvent.click(screen.getByText('Compose new'));
 await screen.findByText('Compose from b');expect(native.switchAccount).toHaveBeenCalledWith('b',true);
});
it('does not replace a prepared reply with a second compose request',async()=>{
 let resolve!:(value:unknown)=>void;const original=native.invoke.getMockImplementation()!;native.invoke.mockImplementation((command:string,...args:unknown[])=>command==='prepare_reply'?new Promise(done=>{resolve=done;}):original(command,...args));
 render(<UnifiedInbox/>);fireEvent.click(screen.getByText('Open a'));await screen.findByText('Reading a');fireEvent.click(screen.getByText('Reply'));await waitFor(()=>expect(resolve).toBeTypeOf('function'));
 fireEvent.click(screen.getByText('Compose new'));expect(screen.queryByText('Compose from a')).toBeNull();
 await act(async()=>{resolve({to:['sender@example.com'],cc:'',in_reply_to:'message',references:[]});});await screen.findByText('Compose from a');
});

it('connects sidebar filters to the combined feed and clears the previous reader selection',async()=>{
 render(<UnifiedInbox/>);fireEvent.click(screen.getByText('Open a'));await screen.findByText('Reading a');fireEvent.click(screen.getByRole('button',{name:'Sidebar starred'}));
 expect(native.filter).toBe('flagged');expect(screen.queryByText('Reading a')).toBeNull();expect(screen.getByRole('button',{name:'Sidebar starred'})).toHaveAttribute('aria-pressed','true');
});
