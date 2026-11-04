import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
const native=vi.hoisted(()=>({invoke:vi.fn(),state:'outbox',delivery:'waiting',events:new Map<string,(event:{payload:string})=>void>()}));
vi.mock('@/hooks/useAccountInvoke',()=>({useAccountInvoke:()=>native.invoke}));
vi.mock('@tauri-apps/api/event',()=>({listen:vi.fn(async(name:string,callback:(event:{payload:string})=>void)=>{native.events.set(name,callback);return()=>native.events.delete(name);})}));
import {OutboxFolder} from '@/components/inbox/OutboxFolder';
const summary=()=>({id:'saved-message',revision:2,to:['friend@example.com'],subject:'Saved while offline',preview:'Message preview',state:native.state,delivery_state:native.delivery,delivery_error:null,attempts:0,attachments:1});
beforeEach(()=>{native.state='outbox';native.delivery='waiting';native.invoke.mockReset();native.events.clear();native.invoke.mockImplementation(async(command:string)=>command==='list_outbox'?[summary()]:command==='read_outbox'||command==='open_draft'?{id:'saved-message',revision:2,payload:{plain:'The complete saved message',attachments:[]}}:null);});
it('loads saved mail locally and only retries after an explicit request',async()=>{
 render(<OutboxFolder accountId="a" onBeforeOpen={()=>true} onOpen={()=>{}}/>);
 await screen.findByText('The complete saved message');expect(native.invoke).toHaveBeenCalledWith('list_outbox',{accountId:'a'});
 expect(native.invoke.mock.calls.some(([command])=>['send_draft','queue_draft','retry_outbox'].includes(command))).toBe(false);
 fireEvent.click(screen.getByRole('button',{name:'Try now'}));await waitFor(()=>expect(native.invoke).toHaveBeenCalledWith('retry_outbox',{accountId:'a',id:'saved-message'}));
});
it('returns a queued message to Drafts before opening the editor',async()=>{
 const open=vi.fn();render(<OutboxFolder accountId="a" onBeforeOpen={()=>true} onOpen={open}/>);await screen.findByText('The complete saved message');
 fireEvent.click(screen.getByRole('button',{name:'Return to Drafts'}));await waitFor(()=>expect(open).toHaveBeenCalledOnce());
 expect(native.invoke).toHaveBeenCalledWith('cancel_outbox',{accountId:'a',id:'saved-message'});expect(native.invoke).toHaveBeenCalledWith('open_draft',{accountId:'a',id:'saved-message'});
});
it('never offers an automatic retry for uncertain delivery',async()=>{
 native.state='send_unknown';native.delivery='attention';render(<OutboxFolder accountId="a" onBeforeOpen={()=>true} onOpen={()=>{}}/>);await screen.findByText('The complete saved message');
 expect(screen.queryByRole('button',{name:'Try now'})).toBeNull();expect(screen.getByRole('button',{name:'Review delivery'})).toBeInTheDocument();
});
it('protects the current compose window when returning mail to Drafts',async()=>{
 render(<OutboxFolder accountId="a" onBeforeOpen={()=>false} onOpen={()=>{}}/>);await screen.findByText('The complete saved message');fireEvent.click(screen.getByRole('button',{name:'Return to Drafts'}));
 expect(native.invoke.mock.calls.some(([command])=>command==='cancel_outbox')).toBe(false);
});
