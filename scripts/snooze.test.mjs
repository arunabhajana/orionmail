import {test} from 'node:test';
import assert from 'node:assert/strict';
import {snoozeKey,snoozePresets} from '../lib/snooze.ts';
import {pinnedFirst} from '../lib/mail-pins.ts';
test('presets use local calendar days and next Monday',()=>{
 const now=new Date(2026,10,2,23,30);const choices=snoozePresets(now);
 assert.equal(choices[0].date.getTime()-now.getTime(),3*3600000);
 assert.equal(choices[1].date.getDate(),3);assert.equal(choices[1].date.getHours(),9);
 assert.equal(choices[2].date.getDay(),1);assert.equal(choices[2].date.getDate(),9);assert.equal(choices[2].date.getHours(),9);
 assert.ok(choices.every(choice=>choice.date>now));assert.equal(now.getHours(),23);
});
test('snooze keys join a thread across copies without trusting reused UIDs',()=>{
 const base={folder:'inbox',uid:1,uidValidity:7};
 assert.equal(snoozeKey({...base,threadId:'<root>'}),snoozeKey({...base,folder:'tag:one',uid:88,threadId:'<root>'}));
 assert.notEqual(snoozeKey(base),snoozeKey({...base,uidValidity:8}));
});
test('returned mail resurfaces without changing its original date or identity',()=>{
 const old={id:'old',timestamp:1,resurfacedAt:20};const fresh={id:'fresh',timestamp:30};const normal={id:'normal',timestamp:10};
 assert.deepEqual(pinnedFirst([normal,old,fresh]).map(item=>item.id),['fresh','old','normal']);assert.equal(old.timestamp,1);
});
