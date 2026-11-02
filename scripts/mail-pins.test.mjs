import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pinIdentity,pinnedFirst} from '../lib/mail-pins.ts';
import {groupConversations} from '../lib/conversations.ts';
const email=(id,extra={})=>({id,folder:'inbox',uid:1,uidValidity:9,timestamp:1,senderEmail:'a@example.com',subject:'hello',...extra});
test('pins float above recent unpinned mail without changing the input',()=>{
 const input=[email('recent',{timestamp:10}),email('older',{timestamp:2,pinned:true}),email('newer-pin',{timestamp:5,pinned:true})];
 assert.deepEqual(pinnedFirst(input).map(item=>item.id),['newer-pin','older','recent']);assert.equal(input[0].id,'recent');
});
test('pin identities survive mailbox aliases but reject reused UIDs without Message-ID',()=>{
 assert.equal(pinIdentity(email('a',{messageId:'<same>'})),pinIdentity(email('b',{messageId:'<same>',folder:'tag:work',uid:9})));
 assert.notEqual(pinIdentity(email('a')),pinIdentity(email('a',{uidValidity:10})));
 assert.notEqual(pinIdentity(email('a',{messageId:'<same>'})),pinIdentity(email('a',{messageId:'<same>',subject:'different'})));
});
test('a pinned conversation member elevates its latest representative',()=>{
 const items=[email('older',{messageId:'<a>',threadId:'<root>',pinned:true}),email('latest',{messageId:'<b>',threadId:'<root>',timestamp:2}),email('unrelated',{timestamp:10})];
 const grouped=pinnedFirst(groupConversations(items));assert.equal(grouped[0].id,'latest');assert.equal(grouped[0].pinned,true);assert.equal(grouped[0].conversationCount,2);
});
