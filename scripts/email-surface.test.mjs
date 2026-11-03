import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {conversationSurfaceScript} from '../lib/email-surface.ts';
function render(html,dark){const dom=new JSDOM('<html><body style="background:#fff;color:#000"><div id="email-content-wrapper">'+html+'</div></body></html>',{runScripts:'outside-only'});dom.window.eval("const wrapper=document.getElementById('email-content-wrapper');"+conversationSurfaceScript(dark)+';window.applyConversationSurface=applyConversationSurface;window.applied=applyConversationSurface();');return dom;}
test('simple replies have a transparent canvas and direct dark theme text',()=>{const dom=render('<div style="background:white;color:black">Third message.</div>',true);assert.equal(dom.window.applied,true);const node=dom.window.document.querySelector('#email-content-wrapper > div');assert.equal(node.style.backgroundColor,'transparent');assert.equal(node.style.color,'rgb(228, 228, 231)');assert.equal(dom.window.document.documentElement.style.filter,'none');dom.window.close();});
test('light replies keep readable text without inverting their canvas',()=>{const dom=render('<p>Hello</p>',false);assert.equal(dom.window.applied,true);assert.equal(dom.window.document.querySelector('p').style.color,'rgb(24, 24, 27)');dom.window.close();});
test('branded and rich HTML retain their original rendering path',()=>{for(const html of ['<table><tr><td>Receipt</td></tr></table>','<img src="cid:photo">','<div style="background:rgb(240,200,20)">Highlighted content</div>']){const dom=render(html,true);assert.equal(dom.window.applied,false);assert.equal(dom.window.document.body.getAttribute('style'),'background:#fff;color:#000');dom.window.close();}});

test('conversation canvas overrides important white reply backgrounds and remains stable when reapplied',()=>{
 const dom=render('<div style="background: white !important; color: #ddd !important"><span>Second message.</span></div>',true);
 const node=dom.window.document.querySelector('#email-content-wrapper > div');
 assert.equal(dom.window.applied,true);assert.equal(node.style.backgroundColor,'transparent');assert.equal(node.style.getPropertyPriority('background'),'important');
 dom.window.eval('applyConversationSurface()');assert.equal(node.style.backgroundColor,'transparent');assert.equal(node.style.color,'rgb(228, 228, 231)');
 assert.equal(dom.window.document.documentElement.style.getPropertyValue('color-scheme'),'only light');dom.window.close();
});

test('plain replies with embedded provider styles still use the transparent conversation surface',()=>{
 const dom=render('<style>.reply {background:white;color:#ddd}</style><div class="reply">Second message.</div>',true);
 assert.equal(dom.window.applied,true);const reply=dom.window.document.querySelector('.reply');assert.equal(reply.style.backgroundColor,'transparent');assert.equal(reply.style.color,'rgb(228, 228, 231)');dom.window.close();
});
