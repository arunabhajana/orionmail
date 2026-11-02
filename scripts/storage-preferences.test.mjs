import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizePreferences} from '../lib/app-preferences.ts';
test('new profiles enable conversations and use system Downloads and bounded caching',()=>{
    const prefs=normalizePreferences({});assert.equal(prefs.conversationView,true);assert.equal(prefs.downloadFolder,'');assert.equal(prefs.cacheRetention,'30');assert.equal(prefs.cacheBudget,'512');assert.equal(prefs.taskbarBadge,true);
});
test('explicit choices survive normalization including no automatic eviction',()=>{
    const prefs=normalizePreferences({conversationView:false,cacheRetention:'0',cacheBudget:'0',taskbarBadge:false});assert.equal(prefs.conversationView,false);assert.equal(prefs.cacheRetention,'0');assert.equal(prefs.cacheBudget,'0');assert.equal(prefs.taskbarBadge,false);
});
test('unsupported cache policies are rejected',()=>{
    const prefs=normalizePreferences({cacheRetention:'-1',cacheBudget:'banana'});assert.equal(prefs.cacheRetention,'30');assert.equal(prefs.cacheBudget,'512');
});
