"use client";
import {ChevronDown, ChevronUp} from 'lucide-react';
import {replyPreview} from '@/lib/reply-display';
import type {Email} from '@/lib/types';
import {contactFromHeader} from '@/lib/mail-display';

export function ConversationMessageRow({email,index,expanded=false,onSelect}: {email:Email;index:number;expanded?:boolean;onSelect:()=>void}) {
    const sender=contactFromHeader(email.senderEmail||email.sender);
    const date=new Date(email.timestamp);
    const timestamp=Number.isFinite(date.getTime())?date.toLocaleString(undefined,{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}):email.date;
    return <button type="button" onClick={onSelect} aria-expanded={expanded}
        aria-label={`${expanded?'Reading':'Open'} message ${index+1} from ${sender.name||email.sender}, ${email.date}`}
        className={`mail-conversation-row ${expanded?'is-expanded':''}`}>
        <span className="mail-conversation-number" aria-hidden="true">{index+1}</span>
        <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-2"><span className="truncate text-[13px] font-semibold text-foreground">{sender.name||email.sender}</span>{email.unread&&<span className="size-1.5 shrink-0 rounded-full bg-primary" title="Unread"/>}<span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{email.folder==='sent'?'Sent':'Received'}</span></span>
            <time title={email.date} className="mt-0.5 block text-[11px] text-muted-foreground">{timestamp}</time>
            {!expanded&&<span className="mt-1.5 block truncate text-xs text-muted-foreground">{replyPreview(email.preview)||email.subject||'Open to read this message'}</span>}
        </span>
        {expanded?<ChevronUp aria-hidden="true" className="size-4 shrink-0 text-primary"/>:<ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground"/>}
    </button>;
}
