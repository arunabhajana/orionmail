"use client";
import React from 'react';
import { useAccountInvoke } from '@/hooks/useAccountInvoke';
import {listen} from '@tauri-apps/api/event';
import EmailDetail from './EmailDetail';
import {useAuth} from './AuthContext';
import type {Email, NativeMessageHeader} from '@/lib/types';
import {dedupeMail,sameMail} from '@/lib/mail-identity';
import {subscribeUnreadChanges,optimisticUnread,unreadRevision} from '@/lib/unread-changes';
import {formatEmailTime} from '@/lib/utils';
import {useAppPreferences} from './AppPreferencesContext';
import {useMailboxCommands} from './CommandPalette';
import {usePathname} from 'next/navigation';
import {Reply,ReplyAll,Forward,Star,Mail,Tags,Clock,Trash2,Inbox} from 'lucide-react';
import {mailIdentity} from '@/lib/mail-identity';
import type {MailCommand} from '@/lib/commands';

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
    React.useEffect(()=>subscribeUnreadChanges(change=>{
        if(change.accountId===accountId)setMembers(previous=>previous.map(member=>sameMail(member,change.email)?{...member,unread:change.unread}:member));
    }),[accountId]);
    React.useEffect(()=>{
        let active=true;
        if(!preferences.conversationView||!anchorId||!accountId||!folder||uid===undefined)return;
        let running=false;let again=false;
        const refresh=async()=>{
            if(!active)return;
            if(running){again=true;return;}
            running=true;
            try {
                const revision=unreadRevision();
                const rows=await invoke<NativeMessageHeader[]>('get_conversation_messages',{accountId,folder,uid});
                if(!active)return;
                if(revision!==unreadRevision()){again=true;return;}
                setMembers(dedupeMail(rows.map(msg=>({
                    id:`${msg.folder}-${msg.uid}`,accountId,uid:msg.uid,uidValidity:msg.uid_validity,messageId:msg.message_id??undefined,threadId:msg.thread_id??undefined,
                    sender:msg.from.split('<')[0].trim()||msg.from,senderEmail:msg.from,to:msg.to??undefined,subject:msg.subject,
                    preview:msg.snippet||'',date:new Date(msg.date*1000).toLocaleString(),time:formatEmailTime(msg.date*1000),timestamp:msg.date*1000,
                    unread:!msg.seen,starred:msg.flagged,folder:msg.folder,tags:msg.tags||[],attachments:[],
                })).map(member=>({...member,unread:optimisticUnread(member)??member.unread}))));
                setError('');
            }catch {if(active)setError('Could not load conversation history. The selected message is still available.');}
            finally {running=false;if(again){again=false;void refresh();}}
        };
        void refresh();
        const stops=[listen<{account_id:string}>('mail:updated',event=>{if(event.payload.account_id===accountId)void refresh();}),listen<string>('mail:labels_changed',event=>{if(event.payload===accountId)void refresh();})];
        return()=>{active=false;for(const stop of stops)void stop.then(fn=>fn());};
    },[anchorId,anchorThread,folder,uid,accountId,preferences.conversationView,invoke]);
    const selected=(preferences.conversationView ? members.find(item=>item.id===(activeId||email?.id)) : undefined)||email;
    const pathname=usePathname();
    useMailboxCommands(()=>{
        if(!selected||pathname!=='/inbox')return [];
        const key='message.'+mailIdentity(selected)+'.';
        const commands:MailCommand[]=[
            {id:key+(selected.unread?'markRead':'markUnread'),label:selected.unread?'Mark as read':'Mark as unread',group:'Selected message',icon:Mail,run:()=>onAction(selected,selected.unread?'markRead':'read')},
            {id:key+(selected.starred?'unstar':'star'),label:selected.starred?'Remove star':'Star message',group:'Selected message',icon:Star,run:()=>onAction(selected,'star')},
        ];
        if(onReply)commands.push({id:key+'reply',label:'Reply',group:'Selected message',icon:Reply,run:()=>onReply(selected)});
        if(onReplyAll)commands.push({id:key+'replyAll',label:'Reply all',group:'Selected message',icon:ReplyAll,run:()=>onReplyAll(selected)});
        if(onForward)commands.push({id:key+'forward',label:'Forward message',group:'Selected message',icon:Forward,run:()=>onForward(selected)});
        if(selected.folder==='trash')commands.push({id:key+'restore',label:'Restore to Inbox',group:'Selected message',icon:Inbox,run:()=>onAction(selected,'restore')});
        else {
            commands.push({id:key+'trash',label:'Move to Trash',group:'Selected message',keywords:'delete',icon:Trash2,run:()=>onAction(selected,'delete')});
            if(onManageTags)commands.push({id:key+'tags',label:'Manage message tags',group:'Selected message',icon:Tags,run:()=>onManageTags(selected)});
            if(onSnooze&&selected.folder==='inbox')commands.push({id:key+'snooze',label:'Snooze message',group:'Selected message',icon:Clock,run:()=>onSnooze(selected)});
        }
        return commands;
    });
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
