import {test} from 'node:test';
import assert from 'node:assert/strict';
import {groupConversations} from '../lib/conversations.ts';
const email=(id,extra={})=>({id,uid:1,folder:'inbox',timestamp:1,subject:'Monthly statement',...extra});
test('matching subjects alone never create a conversation',()=>{
    assert.equal(groupConversations([email('a'),email('b')]).length,2);
});
test('reply metadata groups with its root and retains each action target',()=>{
    const rows=groupConversations([email('a',{messageId:'<root>',threadId:'<root>'}),email('b',{messageId:'<reply>',threadId:'<root>',timestamp:2})]);
    assert.equal(rows.length,1);assert.equal(rows[0].id,'b');
    assert.equal(rows[0].conversationCount,2);assert.deepEqual(rows[0].conversationIds,['a','b']);
});
test('optimistic moves remain independent while their location is unsettled',()=>{
    assert.equal(groupConversations([email('a',{threadId:'<root>',locationId:'pending'}),email('b',{threadId:'<root>'})]).length,2);
});
