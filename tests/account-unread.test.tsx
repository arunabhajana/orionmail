import {act,renderHook,waitFor} from '@testing-library/react';
import {expect,it,vi,beforeEach} from 'vitest';
const native=vi.hoisted(()=>({invoke:vi.fn(),events:new Map<string,()=>void>(),accounts:[{id:'a'},{id:'b'}]}));
vi.mock('@tauri-apps/api/core',()=>({invoke:native.invoke}));
vi.mock('@tauri-apps/api/event',()=>({listen:vi.fn(async(name:string,callback:()=>void)=>{native.events.set(name,callback);return()=>native.events.delete(name);})}));
vi.mock('@/components/AuthContext',()=>({useAuth:()=>({accounts:native.accounts})}));
import {useAccountUnreadOverview} from '@/hooks/useAccountUnreadOverview';
beforeEach(()=>{native.accounts=[{id:'a'},{id:'b'}];native.invoke.mockReset();native.events.clear();});
it('shows separate and combined counts and coalesces mail events',async()=>{
 native.invoke.mockResolvedValue({a:2,b:3});const {result}=renderHook(()=>useAccountUnreadOverview());
 await waitFor(()=>expect(result.current.total).toBe(5));expect(result.current.counts).toEqual({a:2,b:3});
 native.invoke.mockResolvedValue({a:0,b:4});act(()=>{for(let i=0;i<5;i++)native.events.get('mail:updated')?.();});
 await waitFor(()=>expect(result.current.total).toBe(4));expect(native.invoke).toHaveBeenCalledTimes(2);
});
it('excludes disconnected accounts and represents failed counts as unknown',async()=>{
 native.invoke.mockResolvedValue({a:2,b:3});const {result,rerender}=renderHook(()=>useAccountUnreadOverview());
 await waitFor(()=>expect(result.current.total).toBe(5));native.accounts=[{id:'a'}];rerender();expect(result.current.total).toBe(2);
 native.invoke.mockRejectedValue(new Error('Unavailable'));act(()=>native.events.get('mail:updated')?.());await waitFor(()=>expect(result.current.total).toBeNull());expect(result.current.counts).toEqual({});
});
