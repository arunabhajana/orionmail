import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {replyDisplay,replyPreview} from '../lib/reply-display.ts';
globalThis.DOMParser=new JSDOM('').window.DOMParser;
test('nested Gmail history is hidden without changing authored content',()=>{
    const original='<p>Third message.</p><div class="gmail_quote"><div>On Mon wrote:</div><blockquote>Second<div class="gmail_quote">First</div></blockquote></div>';
    const clean=replyDisplay(original);
    assert(clean.hasQuoted);assert(clean.html.includes('Third message.'));assert(!clean.html.includes('Second'));assert(original.includes('Second'));
});
test('legitimate quotations and quote-only forwards remain visible',()=>{
    for(const html of ['<p>A quotation:</p><blockquote>Important words</blockquote>','<div class="gmail_quote">Forwarded content</div>'])assert.equal(replyDisplay(html).html,html);
});
test('plain-text reply headers and preview history are trimmed',()=>{
    const body='Third message. On Mon, Nov 2, 2026 at 8:15 PM Sender wrote: Second message.';
    assert.equal(replyPreview(body),'Third message.');
    assert(!replyDisplay(`<pre>${body}</pre>`).html.includes('Second message.'));
    assert.equal(replyPreview('Your OTP is 123456'),'Your OTP is 123456');
});
test('head styling survives display trimming',()=>{
    const clean=replyDisplay('<html><head><style>p{color:red}</style></head><body><p>Reply</p><div class="gmail_quote">old</div></body></html>');
    assert(clean.html.includes('p{color:red}'));assert(!clean.html.includes('old'));
});
test('removing quotes also removes empty edge spacers without losing inline images',()=>{
    const result=replyDisplay('<div><div><br></div><div>Third message.<div><br></div></div><div class="gmail_quote">old</div></div>');
    assert(!result.html.includes('<br>'));
    assert(result.html.includes('Third message.'));
    const image=replyDisplay('<p>Reply</p><div><img src="cid:photo"></div><div class="gmail_quote">old</div>');
    assert(image.html.includes('cid:photo'));
});
