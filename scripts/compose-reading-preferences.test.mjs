import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizePreferences, parseAddressList, signatureHtml, quietHoursActive} from '../lib/app-preferences.ts';
const at=(hour,minute=0)=>new Date(2026,10,2,hour,minute);
test('quiet hours cover overnight, daytime, boundaries and all-day schedules',()=>{
 const prefs=normalizePreferences({quietHours:true});
 assert.equal(quietHoursActive(prefs,at(22)),true);
 assert.equal(quietHoursActive(prefs,at(0)),true);
 assert.equal(quietHoursActive(prefs,at(7,59)),true);
 assert.equal(quietHoursActive(prefs,at(8)),false);
 assert.equal(quietHoursActive(prefs,at(21,59)),false);
 const day={...prefs,quietStart:'09:00',quietEnd:'17:00'};
 assert.equal(quietHoursActive(day,at(8,59)),false);
 assert.equal(quietHoursActive(day,at(9)),true);
 assert.equal(quietHoursActive(day,at(17)),false);
 assert.equal(quietHoursActive({...day,quietEnd:'09:00'},at(0)),true);
 assert.equal(quietHoursActive({...day,quietHours:false},at(10)),false);
});
test('signature preserves plain text and cannot inject HTML',()=>{
 assert.equal(signatureHtml('   '),'');
 assert.equal(signatureHtml('  Alex\nEngineer & <team>  '),'<p>—<br>Alex<br>Engineer &amp; &lt;team&gt;</p>');
 assert.equal(signatureHtml('<img src=x onerror="bad()">').includes('<img'),false);
});
test('all compose and reading choices persist while corrupt values fall back',()=>{
 const input={signature:'Alex',defaultCc:'a@example.com',defaultBcc:'b@example.com',composeFont:'monospace',confirmEmptySubject:false,attachmentReminder:false,readingFontSize:'20',markRead:'5',autoSelectNext:true,density:'compact',showAvatars:false,previewLines:'0',dateFormat:'absolute',readingPane:'bottom',defaultFolder:'sent',conversationView:false,dndEnabled:true,quietHours:true,quietStart:'23:59',quietEnd:'00:01'};
 const prefs=normalizePreferences(JSON.parse(JSON.stringify(input)));
 for(const [key,value] of Object.entries(input))assert.equal(prefs[key],value,key);
 const bad=normalizePreferences({quietStart:'25:00',quietEnd:'08:61',composeFont:'script',markRead:'-1',readingPane:'floating'});
 assert.equal(bad.quietStart,'22:00');assert.equal(bad.quietEnd,'08:00');assert.equal(bad.composeFont,'system');assert.equal(bad.markRead,'immediate');assert.equal(bad.readingPane,'right');
});
test('default copy recipients validate and deduplicate before saving or sending',()=>{
 assert.deepEqual(parseAddressList('a@example.com; b@example.com,a@example.com'),['a@example.com','b@example.com']);
 assert.throws(()=>parseAddressList('bad address'));
});

test('notification controls persist and unsupported tones are rejected',()=>{
 const values={notifyInbox:false,notifySent:true,notifyLabels:true,importantOnly:true,notificationTone:'im',notificationSound:false};
 const prefs=normalizePreferences(values);for(const [key,value] of Object.entries(values))assert.equal(prefs[key],value,key);
 assert.equal(normalizePreferences({notificationTone:'https://untrusted/audio'}).notificationTone,'mail');
 const defaults=normalizePreferences({});assert.equal(defaults.notifyInbox,true);assert.equal(defaults.notifySent,false);assert.equal(defaults.notifyLabels,false);assert.equal(defaults.importantOnly,false);
});
