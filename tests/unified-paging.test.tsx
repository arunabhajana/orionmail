import {act,renderHook,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import type {UnifiedCursor,UnifiedPage} from '@/lib/unified-inbox';
const native=vi.hoisted(()=>({invoke:vi.fn(),path:'/inbox',events:new Map<string,()=>void>()}));
vi.mock('@tauri-apps/api/core',()=>({invoke:native.invoke}));
vi.mock('@tauri-apps/api/event',()=>({listen:vi.fn(async(name:string,callback:()=>void)=>{native.events.set(name,callback);return()=>native.events.delete(name);})}));
vi.mock('@/components/AuthContext',()=>({useAuth:()=>({accounts:[{id:'a'},{id:'b'}]})}));
vi.mock('next/navigation',()=>({usePathname:()=>native.path}));
import {useUnifiedInbox} from '@/hooks/useUnifiedInbox';
function page(start:number,limit:number,subject='Mail'):UnifiedPage{
 const end=Math.min(200,start+limit);return {messages:Array.from({length:end-start},(_,i)=>({account_id:'a',header:{folder:'inbox',uid:start+i+1,uid_validity:9,subject,from:'Sender',date:10000-start-i,seen:false,flagged:false},pinned:false})),tags:{},next_cursor:end<200?{pinned:false,date:10001-end,account:'a',folder:'inbox',uid:end,validity:9,local_id:''}:null};
}
beforeEach(()=>{native.path='/inbox';native.events.clear();native.invoke.mockReset();native.invoke.mockImplementation(async(_name,args:{cursor:UnifiedCursor|null;limit:number;queryText:string})=>page(args.cursor?.uid||0,args.limit,args.queryText||'Mail'));});
it('keeps the loaded window when refreshing and coalesces native event bursts',async()=>{
 const {result}=renderHook(()=>useUnifiedInbox('','all',''));await waitFor(()=>expect(result.current.rows).toHaveLength(50));
 await act(()=>result.current.loadMore());await act(()=>result.current.loadMore());expect(result.current.rows).toHaveLength(150);
 act(()=>{for(let i=0;i<10;i++)native.events.get('mail:updated')?.();});expect(result.current.rows).toHaveLength(150);
 await waitFor(()=>expect(native.invoke).toHaveBeenCalledTimes(5));await waitFor(()=>expect(result.current.rows).toHaveLength(150));
 expect(new Set(result.current.rows.map(row=>row.id)).size).toBe(150);
});
it('retains cached rows through Settings and ignores stale search responses',async()=>{
 const {result,rerender}=renderHook(({query})=>useUnifiedInbox(query,'all',''),{initialProps:{query:''}});await waitFor(()=>expect(result.current.rows).toHaveLength(50));
 native.path='/settings';rerender({query:''});expect(result.current.rows).toHaveLength(50);native.path='/inbox';rerender({query:''});expect(result.current.rows).toHaveLength(50);
 let resolve!:(page:UnifiedPage)=>void;native.invoke.mockImplementation(async(_name,args)=>args.queryText==='old'?new Promise(done=>{resolve=done;}):page(0,50,args.queryText));
 rerender({query:'old'});await waitFor(()=>expect(resolve).toBeTypeOf('function'));rerender({query:'new'});await waitFor(()=>expect(result.current.rows[0]?.subject).toBe('new'));
 await act(async()=>{resolve(page(0,50,'old'));});expect(result.current.rows[0].subject).toBe('new');
});
it('shows read changes before persistence finishes and restores only the failed message',async()=>{
 const {result}=renderHook(()=>useUnifiedInbox('','all',''));await waitFor(()=>expect(result.current.rows).toHaveLength(50));
 const first=result.current.rows[0],second=result.current.rows[1];let fail!:(success:boolean)=>void,accept!:(success:boolean)=>void;
 act(()=>{fail=result.current.beginRead(first,false);accept=result.current.beginRead(second,false);});
 expect(result.current.rows[0].unread).toBe(false);expect(result.current.rows[1].unread).toBe(false);
 act(()=>fail(false));expect(result.current.rows[0].unread).toBe(true);expect(result.current.rows[1].unread).toBe(false);
 act(()=>accept(true));expect(result.current.rows[1].unread).toBe(false);
});
