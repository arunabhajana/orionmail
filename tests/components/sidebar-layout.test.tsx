import {useState} from 'react';
import type {FilterType} from '@/components/inbox/EmailListHeader';
import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
const native=vi.hoisted(()=>({count:1,invoke:vi.fn(),switchAccount:vi.fn(async()=>{}),add:vi.fn(async()=>{}),sync:vi.fn(),router:{push:vi.fn()}}));
vi.mock('@/components/SyncContext',()=>({useSync:()=>({isSyncing:false,triggerSync:native.sync})}));
vi.mock('next/navigation',()=>({usePathname:()=>'/inbox',useRouter:()=>native.router}));
vi.mock('@tauri-apps/api/event',()=>({listen:vi.fn(async()=>()=>{})}));
vi.mock('@/hooks/useAccountInvoke',()=>({useAccountInvoke:()=>native.invoke}));
vi.mock('@tauri-apps/api/core',()=>({invoke:native.invoke}));
vi.mock('@/components/AuthContext',()=>({useAuth:()=>({user:{id:'a',email:'a@example.com',name:'Personal',picture:''},accounts:['a','b','c'].slice(0,native.count).map(id=>({id,email:id+'@example.com',name:id==='a'?'Personal':'Work '+id,picture:''})),accountBusy:false,switchAccount:native.switchAccount,addGoogleAccount:native.add,logout:vi.fn(async()=>{})})}));
vi.mock('@/components/AppPreferencesContext',async()=>{const {defaultPreferences}=await import('@/lib/app-preferences');return {useAppPreferences:()=>({preferences:defaultPreferences})};});
import {MailboxViewProvider} from '@/components/MailboxViewContext';
import Sidebar from '@/components/Sidebar';
beforeEach(()=>{native.count=1;native.sync.mockClear();native.invoke.mockReset();native.switchAccount.mockClear();native.add.mockClear();native.router.push.mockClear();native.invoke.mockImplementation(async(command)=>command==='get_all_tags'?[]:{a:2,b:3,c:0});});
function SidebarProbe(){const [filter,setFilter]=useState<FilterType>('all');return <Sidebar onCompose={()=>{}} currentFolder="inbox" onFolderSelect={()=>{}} unifiedFilter={filter} onUnifiedFilterSelect={setFilter}/>;}
const app=()=>render(<MailboxViewProvider><SidebarProbe/></MailboxViewProvider>);
it('keeps the single-account sidebar simple with visible folders and permanent settings',()=>{
 app();expect(screen.getByRole('button',{name:/a@example.com, active account/})).toBeInTheDocument();expect(screen.queryByRole('button',{name:'All inboxes'})).toBeNull();
 expect(screen.getByRole('navigation',{name:'Mail folders'})).toBeInTheDocument();expect(screen.getByRole('button',{name:'Inbox'})).toBeInTheDocument();expect(screen.getByRole('button',{name:'Settings'})).toBeInTheDocument();expect(screen.getByRole('button',{name:'Add Google account'})).toBeEnabled();
});
it('shows accounts inline and removes ambiguous folders in the combined view',async()=>{
 native.count=2;app();expect(screen.getByRole('button',{name:/^Work b, b@example.com/})).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'All inboxes'}));
 await waitFor(()=>expect(screen.queryByRole('navigation',{name:'Mail folders'})).toBeNull());expect(screen.getByRole('navigation',{name:'Combined inbox views'})).toBeInTheDocument();expect(screen.getByRole('button',{name:/^Work b, b@example.com/})).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:/^Personal, a@example.com/}));await screen.findByRole('navigation',{name:'Mail folders'});
});
it('honours the three-account limit and exposes settings without opening an account popover',async()=>{
 native.count=3;app();expect(screen.getByRole('button',{name:'Add Google account'})).toBeDisabled();fireEvent.click(screen.getByRole('button',{name:'Settings'}));
 await waitFor(()=>expect(native.router.push).toHaveBeenCalledWith('/settings'));expect(native.switchAccount).toHaveBeenCalledWith('a',true);
});

it('offers working combined filters and a sync shortcut without exposing account folders',async()=>{
 native.count=2;app();fireEvent.click(screen.getByRole('button',{name:'All inboxes'}));await screen.findByRole('navigation',{name:'Combined inbox views'});
 fireEvent.click(screen.getByRole('button',{name:'Unread'}));expect(screen.getByRole('button',{name:'Unread'})).toHaveAttribute('aria-current','page');expect(screen.getByRole('button',{name:'All mail'})).not.toHaveAttribute('aria-current');
 fireEvent.click(screen.getByRole('button',{name:'Starred'}));expect(screen.getByRole('button',{name:'Starred'})).toHaveAttribute('aria-current','page');expect(screen.queryByRole('navigation',{name:'Mail folders'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Sync all inboxes'}));expect(native.sync).toHaveBeenCalledOnce();
});
it('keeps add-account and sync actions in the footer for a single account',()=>{
 app();fireEvent.click(screen.getByRole('button',{name:'Add Google account'}));expect(native.add).toHaveBeenCalledOnce();fireEvent.click(screen.getByRole('button',{name:'Sync this account'}));expect(native.sync).toHaveBeenCalledOnce();expect(screen.getByRole('contentinfo',{name:'Quick access'})).toContainElement(screen.getByRole('button',{name:'Settings'}));
});
