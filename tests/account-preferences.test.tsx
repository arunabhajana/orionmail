import {act,renderHook,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import {AppPreferencesProvider,useAppPreferences} from '@/components/AppPreferencesContext';
const auth=vi.hoisted(()=>({id:'a',current:(id:string)=>id===auth.id}));
vi.mock('@/components/AuthContext',()=>({useAuth:()=>({user:{id:auth.id},isAccountCurrent:auth.current})}));
vi.mock('@tauri-apps/api/core',()=>({isTauri:()=>false,invoke:vi.fn()}));
beforeEach(()=>{localStorage.clear();auth.id='a';});
const wrapper=({children}:{children:React.ReactNode})=><AppPreferencesProvider>{children}</AppPreferencesProvider>;
it('inherits device changes while explicit account values stay isolated',async()=>{
 const {result,rerender}=renderHook(()=>useAppPreferences(),{wrapper});
 await waitFor(()=>expect(result.current).not.toBeNull());
 await act(()=>result.current.updateDevicePreferences({signature:'Device',markRead:'manual'}));
 expect(result.current.preferences.signature).toBe('Device');
 await act(()=>result.current.saveAccountPreferences('a',{signature:'Account A'}));
 await act(()=>result.current.updateDevicePreferences({signature:'New device',markRead:'5'}));
 expect(result.current.preferences.signature).toBe('Account A');expect(result.current.preferences.markRead).toBe('5');
 auth.id='b';rerender();expect(result.current.preferences.signature).toBe('New device');
 auth.id='a';rerender();
 await act(()=>result.current.saveAccountPreferences('a',{},['signature']));
 expect(result.current.preferences.signature).toBe('New device');
});
it('rejects stale account saves and restores overrides on reload',async()=>{
 const first=renderHook(()=>useAppPreferences(),{wrapper});await waitFor(()=>expect(first.result.current).not.toBeNull());
 await act(()=>first.result.current.saveAccountPreferences('a',{signature:'Saved'}));first.unmount();
 const next=renderHook(()=>useAppPreferences(),{wrapper});await waitFor(()=>expect(next.result.current.preferences.signature).toBe('Saved'));
 auth.id='b';await expect(next.result.current.saveAccountPreferences('a',{signature:'Wrong owner'})).rejects.toThrow('Account changed');
});
