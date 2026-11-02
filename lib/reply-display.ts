/** Display-only trimming: the stored body and extraction input stay intact. */
export function replyPreview(text: string): string {
    const boundary = /\bOn\s+(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[\s\S]{0,500}?wrote\s*:|(?:^|\n)\s*-{3,}\s*Original Message\s*-{3,}/i.exec(text);
    const before = boundary ? text.slice(0,boundary.index).trim() : '';
    return before || text;
}

export function replyDisplay(html: string): {html:string;hasQuoted:boolean} {
    if (!html || typeof DOMParser==='undefined') return {html,hasQuoted:false};
    const doc = new DOMParser().parseFromString(html,'text/html');
    let changed=false;
    for(const quote of Array.from(doc.body.querySelectorAll('.gmail_quote, .yahoo_quoted, blockquote[type="cite"]'))) {
        if(!doc.body.contains(quote))continue;
        const range=doc.createRange();range.selectNodeContents(doc.body);range.setEndBefore(quote);
        if(!range.toString().trim())continue;
        const attribution=quote.previousElementSibling;
        if(attribution&&(attribution.matches('.gmail_attr')||/^On\s+[\s\S]{0,500}wrote\s*:\s*$/i.test(attribution.textContent||'')))attribution.remove();
        quote.remove();changed=true;
    }
    for(const pre of Array.from(doc.body.querySelectorAll('pre'))) {
        const text=pre.textContent||'';const clean=replyPreview(text);
        if(clean!==text){pre.textContent=clean;changed=true;}
    }
    if(changed) {
        // Only remove empty boundary spacing, never blank lines inside a reply
        // or blocks containing images/attachments. Detached documents have no window.
        const isEmpty=(node:Node)=>node.nodeType===3?!node.textContent?.replace(/\u00a0/g,' ').trim():node.nodeType===1&&/^(BR|DIV|P|SPAN)$/.test((node as Element).tagName)&&!node.textContent?.replace(/\u00a0/g,' ').trim()&&!(node as Element).querySelector('img,svg,video,audio,table,hr,input');
        const trim=(element:Element,depth=0)=>{
            if(depth>20)return;
            while(element.firstChild&&isEmpty(element.firstChild))element.firstChild.remove();
            while(element.lastChild&&isEmpty(element.lastChild))element.lastChild.remove();
            const first=element.firstElementChild,last=element.lastElementChild;
            if(first&&/^(DIV|P|SPAN)$/.test(first.tagName))trim(first,depth+1);
            if(last&&last!==first&&/^(DIV|P|SPAN)$/.test(last.tagName))trim(last,depth+1);
        };
        trim(doc.body);
    }
    return {html:changed?doc.documentElement.outerHTML:html,hasQuoted:changed};
}
