import {beforeEach,expect,it,vi} from 'vitest';
const success=vi.hoisted(()=>vi.fn());
vi.mock('sonner',()=>({toast:{success}}));
beforeEach(()=>{vi.resetModules();success.mockClear();});
it('updates the queued message toast when delivery completes',async()=>{
 const {queuedFeedback,deliveredFeedback}=await import('@/lib/mail-feedback');
 queuedFeedback('account','draft','Subject');deliveredFeedback('account','draft','Subject');
 expect(success).toHaveBeenCalledTimes(2);
 expect(success.mock.calls[0][1].id).toBe(success.mock.calls[1][1].id);
 expect(success.mock.calls[1][0]).toBe('Message sent');
});
it('does not replace delivered feedback with a late queue response',async()=>{
 const {queuedFeedback,deliveredFeedback}=await import('@/lib/mail-feedback');
 deliveredFeedback('account','draft','Subject');queuedFeedback('account','draft','Subject');
 expect(success).toHaveBeenCalledTimes(1);expect(success.mock.calls[0][0]).toBe('Message sent');
});
it('keeps messages and accounts independent',async()=>{
 const {queuedFeedback}=await import('@/lib/mail-feedback');
 queuedFeedback('a','draft','One');queuedFeedback('b','draft','Two');queuedFeedback('a','other','Three');
 expect(new Set(success.mock.calls.map(call=>call[1].id)).size).toBe(3);
});
