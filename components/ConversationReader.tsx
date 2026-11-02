"use client";
import React from 'react';
import {invoke} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';
import EmailDetail from './EmailDetail';
import {useAuth} from './AuthContext';
import type {Email} from '@/lib/types';
import {dedupeMail} from '@/lib/mail-identity';
import {formatEmailTime} from '@/lib/utils';
import {useAppPreferences} from './AppPreferencesContext';

type Action = 'star' | 'read' | 'markRead' | 'delete' | 'restore';
export default function ConversationReader({email,className,onBack,onAction}: {email?:Email|null;className?:string;onBack?:()=>void;onAction:(email:Email,action:Action)=>void}) {
    const {user} = useAuth();
    const {preferences} = useAppPreferences();
    const [members,setMembers] = React.useState<Email[]>([]);
    const [activeId,setActiveId] = React.useState<string|null>(null);
    const [error,setError] = React.useState('');
    React.useEffect(()=>{
        let active=true;
        setMembers([]);setActiveId(null);setError('');
        if(!preferences.conversationView||!email||!user?.id)return;
        let running=false;let again=false;
        const refresh=async()=>{
            if(!active)return;
            if(running){again=true;return;}
            running=true;
            try {
                const rows=await invoke<any[]>('get_conversation_messages',{accountId:user.id,folder:email.folder,uid:email.uid});
                if(!active)return;
                setMembers(dedupeMail(rows.map(msg=>({
                    id:`${msg.folder}-${msg.uid}`,uid:msg.uid,uidValidity:msg.uid_validity,messageId:msg.message_id,threadId:msg.thread_id,
                    sender:msg.from.split('<')[0].trim()||msg.from,senderEmail:msg.from,to:msg.to,subject:msg.subject,
                    preview:msg.snippet||'',date:new Date(msg.date*1000).toLocaleString(),time:formatEmailTime(msg.date*1000),timestamp:msg.date*1000,
                    unread:!msg.seen,starred:msg.flagged,folder:msg.folder,tags:msg.tags||[],attachments:[],
                }))));
                setError('');
            }catch {if(active)setError('Could not load conversation history. The selected message is still available.');}
            finally {running=false;if(again){again=false;void refresh();}}
        };
        void refresh();
        const stops=[listen<{account_id:string}>('mail:updated',event=>{if(event.payload.account_id===user.id)void refresh();}),listen<string>('mail:labels_changed',event=>{if(event.payload===user.id)void refresh();})];
        return()=>{active=false;for(const stop of stops)void stop.then(fn=>fn());};
    },[email?.id,email?.threadId,user?.id,preferences.conversationView]);
    const selected=(preferences.conversationView ? members.find(item=>item.id===(activeId||email?.id)) : undefined)||email;
    return <section className={className}>
        <EmailDetail className="flex min-h-0 flex-1 flex-col" email={selected} onBack={onBack}
            conversation={preferences.conversationView&&members.length>1?[...members].sort((a,b)=>a.timestamp-b.timestamp):[]}
            onSelectConversation={setActiveId} conversationNotice={error}
            onToggleStar={()=>selected&&onAction(selected,'star')} onToggleRead={()=>selected&&onAction(selected,'read')}
            onMarkAsRead={()=>selected&&onAction(selected,'markRead')} onDeleteMessage={()=>selected&&onAction(selected,'delete')}
            onRestoreMessage={()=>selected&&onAction(selected,'restore')}/>
    </section>;
}
