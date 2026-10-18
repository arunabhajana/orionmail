import {test} from 'node:test';
import assert from 'node:assert/strict';
import {dedupeMail,sameMail} from '../lib/mail-identity.ts';
const mail=(values={})=>({id:'inbox-1',uid:1,folder:'inbox',messageId:'<same@example>',timestamp:1000,senderEmail:'sender@example',subject:'Mail',tags:['paper'],starred:true,...values});
test('fresh removals and flags win over stale list rows',()=>{
 const fresh=mail({tags:[],starred:false});assert.deepEqual(dedupeMail([fresh,mail()]),[fresh]);
});
test('cached copies collapse without transplanting their source UID',()=>{
 const inbox=mail();const label=mail({id:'tag:paper-99',uid:99,folder:'tag:paper'});
 assert.deepEqual(dedupeMail([inbox,label]),[inbox]);assert(sameMail(inbox,label));
});
test('reused Message-ID with different content remains separate',()=>{
 assert.equal(dedupeMail([mail(),mail({id:'inbox-2',uid:2,subject:'Different'})]).length,2);
 assert.equal(dedupeMail([mail(),mail({id:'sent-2',uid:2,folder:'sent',timestamp:2000})]).length,2);
});
test('identical subjects and colliding UIDs are insufficient to merge mail',()=>{
 const a=mail({messageId:undefined});const b=mail({messageId:undefined,id:'sent-1',folder:'sent'});
 assert.equal(dedupeMail([a,b]).length,2);assert(!sameMail(a,b));
});
test('equal timestamps use the same folder and UID ordering as keyset pages',()=>{
 const a=mail({messageId:undefined,id:'inbox-2',uid:2});const b=mail({messageId:undefined,id:'sent-1',folder:'sent'});
 assert.deepEqual(dedupeMail([a,b]).map(m=>m.id),['sent-1','inbox-2']);
});
