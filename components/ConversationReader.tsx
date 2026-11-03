"use client";
import React from 'react';
import { useAccountInvoke } from '@/hooks/useAccountInvoke';
import {listen} from '@tauri-apps/api/event';
import EmailDetail from './EmailDetail';
import {useAuth} from './AuthContext';
import type {Email, NativeMessageHeader} from '@/lib/types';
import {dedupeMail} from '@/lib/mail-identity';
import {formatEmailTime} from '@/lib/utils';
import {useAppPreferences} from './AppPreferencesContext';

type Action = 'star' | 'read' | 'markRead' | 'delete' | 'restore';
type ConversationReaderProps = {accountBadge?:{label:string;color?:string};email?:Email|null;className?:string;onBack?:()=>void;onReply?:(email:Email)=>void;onReplyAll?:(email:Email)=>void;onForward?:(email:Email)=>void;onManageTags?:(email:Email)=>void;onSnooze?:(email:Email)=>void;isSnoozed?:(email:Email)=>boolean;onAction:(email:Email,action:Action)=>void};
export default function ConversationReader(props: ConversationReaderProps) {
    const {user} = useAuth();
    const {preferences} = useAppPreferences();
    const email = props.email;
    return <ConversationWorkspace key={JSON.stringify([user?.id,email?.id,email?.folder,email?.uidValidity,preferences.conversationView])} {...props}/>;
}
function ConversationWorkspace({accountBadge,email,className,onBack,onAction,onReply,onReplyAll,onForward,onManageTags,onSnooze,isSnoozed}: ConversationReaderProps) {
    const invoke = useAccountInvoke();
    const {user} = useAuth();
    const {preferences} = useAppPreferences();
    const [members,setMembers] = React.useState<Email[]>([]);
    const [activeId,setActiveId] = React.useState<string|null>(null);
    const [error,setError] = React.useState('');
    const accountId=user?.id, anchorId=email?.id, anchorThread=email?.threadId, folder=email?.folder, uid=email?.uid;
    React.useEffect(()=>{
        let active=true;
        if(!preferences.conversationView||!anchorId||!accountId||!folder||uid===undefined)return;
        let running=false;let again=false;
        const refresh=async()=>{
            if(!active)return;
            if(running){again=true;return;}
            running=true;
            try {
                const rows=await invoke<NativeMessageHeader[]>('get_conversation_messages',{accountId,folder,uid});
                if(!active)return;
                setMembers(dedupeMail(rows.map(msg=>({
                    id:`${msg.folder}-${msg.uid}`,accountId,uid:msg.uid,uidValidity:msg.uid_validity,messageId:msg.message_id??undefined,threadId:msg.thread_id??undefined,
                    sender:msg.from.split('<')[0].trim()||msg.from,senderEmail:msg.from,to:msg.to??undefined,subject:msg.subject,
                    preview:msg.snippet||'',date:new Date(msg.date*1000).toLocaleString(),time:formatEmailTime(msg.date*1000),timestamp:msg.date*1000,
                    unread:!msg.seen,starred:msg.flagged,folder:msg.folder,tags:msg.tags||[],attachments:[],
                }))));
                setError('');
            }catch {if(active)setError('Could not load conversation history. The selected message is still available.');}
            finally {running=false;if(again){again=false;void refresh();}}
        };
        void refresh();
        const stops=[listen<{account_id:string}>('mail:updated',event=>{if(event.payload.account_id===accountId)void refresh();}),listen<string>('mail:labels_changed',event=>{if(event.payload===accountId)void refresh();})];
        return()=>{active=false;for(const stop of stops)void stop.then(fn=>fn());};
    },[anchorId,anchorThread,folder,uid,accountId,preferences.conversationView,invoke]);
    const selected=(preferences.conversationView ? members.find(item=>item.id===(activeId||email?.id)) : undefined)||email;
    return <section className={className}>
        <EmailDetail accountBadge={accountBadge} className="flex min-h-0 flex-1 flex-col" email={selected} onBack={onBack}
            onSnooze={selected&&selected.folder==='inbox'&&onSnooze?()=>onSnooze(selected):undefined} isSnoozed={selected&&isSnoozed?isSnoozed(selected):false}
            onReplyAll={selected&&onReplyAll?()=>onReplyAll(selected):undefined} onForward={selected&&onForward?()=>onForward(selected):undefined} onManageTags={selected&&onManageTags&&selected.folder!=='trash'?()=>onManageTags(selected):undefined} onReply={selected&&onReply?()=>onReply(selected):undefined}
            conversation={preferences.conversationView&&members.length>1?[...members].sort((a,b)=>a.timestamp-b.timestamp):[]}
            onSelectConversation={setActiveId} conversationNotice={error}
            onToggleStar={()=>selected&&onAction(selected,'star')} onToggleRead={()=>selected&&onAction(selected,'read')}
            onMarkAsRead={()=>selected&&onAction(selected,'markRead')} onDeleteMessage={()=>selected&&onAction(selected,'delete')}
            onRestoreMessage={()=>selected&&onAction(selected,'restore')}/>
    </section>;
}
