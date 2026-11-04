import {act,renderHook,waitFor} from '@testing-library/react';
import {expect,it,vi,beforeEach} from 'vitest';
const native=vi.hoisted(()=>({invoke:vi.fn(),events:new Map<string,()=>void>(),accounts:[{id:'a'},{id:'b'}]}));
vi.mock('@tauri-apps/api/core',()=>({invoke:native.invoke}));
vi.mock('@tauri-apps/api/event',()=>({listen:vi.fn(async(name:string,callback:()=>void)=>{native.events.set(name,callback);return()=>native.events.delete(name);})}));
vi.mock('@/components/AuthContext',()=>({useAuth:()=>({accounts:native.accounts})}));
import {useAccountUnreadOverview} from '@/hooks/useAccountUnreadOverview';
import {beginUnreadChange} from '@/lib/unread-changes';
import type {Email} from '@/lib/types';
const unreadMail={accountId:'a',id:'inbox-1',folder:'inbox',uid:1,unread:true} as Email;
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
it('does no sidebar work while disabled and ignores old event callbacks after teardown',async()=>{
 native.invoke.mockResolvedValue({a:2,b:3});const {result,rerender}=renderHook(({enabled})=>useAccountUnreadOverview(enabled),{initialProps:{enabled:false}});
 await new Promise(resolve=>setTimeout(resolve,250));expect(native.invoke).not.toHaveBeenCalled();rerender({enabled:true});await waitFor(()=>expect(result.current.total).toBe(5));
 const notify=native.events.get('mail:updated');rerender({enabled:false});act(()=>notify?.());await new Promise(resolve=>setTimeout(resolve,250));expect(native.invoke).toHaveBeenCalledOnce();
});
it('updates account and combined badges immediately, ignores stale refreshes, and rolls back once',async()=>{
 native.invoke.mockResolvedValue({a:1,b:3});const {result}=renderHook(()=>useAccountUnreadOverview());
 await waitFor(()=>expect(result.current.total).toBe(4));
 let resolve!:(counts:Record<string,number>)=>void;
 native.invoke.mockImplementation(()=>new Promise(done=>{resolve=done;}));
 act(()=>native.events.get('mail:updated')?.());await waitFor(()=>expect(resolve).toBeTypeOf('function'));
 let finish!:ReturnType<typeof beginUnreadChange>;
 act(()=>{finish=beginUnreadChange('a',unreadMail,false);});
 expect(result.current.counts.a).toBe(0);expect(result.current.total).toBe(3);
 expect(beginUnreadChange('a',unreadMail,false)).toBeNull();
 await act(async()=>resolve({a:1,b:3}));expect(result.current.counts.a).toBe(0);
 act(()=>{finish!(false);finish!(false);});expect(result.current.counts.a).toBe(1);expect(result.current.total).toBe(4);
});
it('keeps a successful read optimistic until the local count refresh catches up',async()=>{
 native.invoke.mockResolvedValue({a:1,b:2});const {result}=renderHook(()=>useAccountUnreadOverview());await waitFor(()=>expect(result.current.total).toBe(3));
 let finish!:ReturnType<typeof beginUnreadChange>;act(()=>{finish=beginUnreadChange('a',unreadMail,false);});expect(result.current.total).toBe(2);
 native.invoke.mockResolvedValue({a:0,b:2});act(()=>finish!(true));expect(result.current.total).toBe(2);
 await waitFor(()=>expect(native.invoke).toHaveBeenCalledTimes(2));expect(result.current.total).toBe(2);
});
