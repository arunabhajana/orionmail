import {render,screen,waitFor,fireEvent} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
const native=vi.hoisted(()=>({invoke:vi.fn(),switchAccount:vi.fn(),login:vi.fn()}));
const accounts=[{id:'a',name:'Work',email:'a@example.com'},{id:'b',name:'Personal',email:'b@example.com'}];
vi.mock('@tauri-apps/api/core',()=>({invoke:native.invoke}));
vi.mock('@/components/AuthContext',()=>({useAuth:()=>({user:accounts[0],accounts,accountBusy:false,switchAccount:native.switchAccount,loginWithGoogle:native.login})}));
import {AccountHealth} from '@/components/accounts/AccountHealth';
import {AccountIdentityControls} from '@/components/accounts/AccountIdentityControls';
beforeEach(()=>{localStorage.clear();native.invoke.mockReset();native.switchAccount.mockReset();native.invoke.mockImplementation(async(command)=>command==='get_account_health'?{sync_paused:false,sync_in_progress:false,last_sync_at:123,last_sync_error:null,unread_count:2}:0);});
it('reads health for inactive accounts without switching and switches before a manual sync',async()=>{
 render(<AccountHealth/>);
 await screen.findAllByText('Last sync successful');
 expect(native.invoke).toHaveBeenCalledWith('get_account_health',{accountId:'b'});
 expect(native.switchAccount).not.toHaveBeenCalled();
 fireEvent.click(screen.getAllByText('Sync now')[1]);
 await waitFor(()=>expect(native.invoke).toHaveBeenCalledWith('sync_mail_folder',{accountId:'b',folder:'inbox',automatic:false}));
 expect(native.switchAccount).toHaveBeenCalledWith('b');
});
it('persists ordering without changing mailbox ownership',()=>{
 render(<AccountIdentityControls/>);
 fireEvent.click(screen.getByText('Move down'));
 const data=JSON.parse(localStorage.getItem('orion_account_identity')!);
 expect(data.accounts.b.rank).toBe(0);expect(data.accounts.a.rank).toBe(1);
 expect(native.switchAccount).not.toHaveBeenCalled();
});
