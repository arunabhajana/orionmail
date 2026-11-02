"use client";

import React from 'react';
import { Reply, ReplyAll, Forward, Send, Trash2, Mail, MailOpen, Pin, Clock, Tag, Undo2 } from 'lucide-react';
import { ContextMenu, ContextMenuAction } from '@/components/ui/ContextMenu';

export interface EmailContextMenuState {
    x: number;
    y: number;
    emailId: string;
    unread: boolean;
    pinned?:boolean;
    snoozedUntil?:number;
    canSnooze?:boolean;
}

export function EmailContextMenu({ contextMenu, onClose, onTogglePin, onNewToSender, onSnooze, onUnsnooze, onReply, onReplyAll, onForward, onToggleRead, onAddTags, isTrash, onRestore, onDelete }: {
    contextMenu: EmailContextMenuState | null;
    onClose: () => void;
    onReply?: (id:string)=>void;
    onTogglePin?:(id:string)=>void;
    onNewToSender?:(id:string)=>void;
    onSnooze?:(id:string)=>void;
    onUnsnooze?:(id:string)=>void;
    onReplyAll?: (id:string)=>void;
    onForward?: (id:string)=>void;
    onToggleRead?: (id: string) => void;
    onAddTags?: (id: string) => void;
    isTrash?: boolean;
    onRestore?: (id: string) => void;
    onDelete?: (id: string) => void;
}) {
    const items: ContextMenuAction[] = isTrash ? [
        { id: 'restore', label: 'Restore to Inbox', icon: <Undo2 size={16} />, disabled: !onRestore, onSelect: () => { if (contextMenu) onRestore?.(contextMenu.emailId); } },
        { id: 'delete-forever', label: 'Delete forever', icon: <Trash2 size={16} />, destructive: true, disabled: !onDelete, onSelect: () => { if (contextMenu) onDelete?.(contextMenu.emailId); } },
        { id: 'read', label: contextMenu?.unread ? 'Mark as read' : 'Mark as unread', icon: <Mail size={16} />, disabled: !onToggleRead, onSelect: () => { if (contextMenu) onToggleRead?.(contextMenu.emailId); } },
    ] : [
        { id: 'reply', label: 'Reply', icon: <Reply size={16} />, disabled:!onReply, onSelect:()=>{if(contextMenu)onReply?.(contextMenu.emailId);} },
        { id: 'reply-all', label: 'Reply all', icon: <ReplyAll size={16} />,disabled:!onReplyAll,onSelect:()=>{if(contextMenu)onReplyAll?.(contextMenu.emailId);} },
        { id: 'forward', label: 'Forward', icon: <Forward size={16} />,disabled:!onForward,onSelect:()=>{if(contextMenu)onForward?.(contextMenu.emailId);} },
        { id: 'new-to-sender', label: 'Email sender', icon: <Send size={16} />, separatorBefore: true,disabled:!onNewToSender,onSelect:()=>{if(contextMenu)onNewToSender?.(contextMenu.emailId);} },
        { id: 'delete', label: 'Move to Trash', icon: <Trash2 size={16} />, destructive: true, disabled: !onDelete, onSelect: () => { if (contextMenu) onDelete?.(contextMenu.emailId); } },
        { id: 'read', label: contextMenu?.unread ? 'Mark as Read' : 'Mark as Unread',
          icon: contextMenu?.unread ? <MailOpen size={16} /> : <Mail size={16} />,
          disabled: !onToggleRead,
          onSelect: () => { if (contextMenu) onToggleRead?.(contextMenu.emailId); } },
        { id: 'pin', label: contextMenu?.pinned?'Unpin message':'Pin to top', icon: <Pin size={16} />, separatorBefore: true,disabled:!onTogglePin,onSelect:()=>{if(contextMenu)onTogglePin?.(contextMenu.emailId);} },
        { id: 'snooze', label: contextMenu?.snoozedUntil?'Reschedule snooze':contextMenu?.canSnooze?'Snooze':'Snooze (Inbox only)', icon: <Clock size={16} />,disabled:!onSnooze||!contextMenu?.canSnooze,onSelect:()=>{if(contextMenu)onSnooze?.(contextMenu.emailId);} },
        ...(contextMenu?.snoozedUntil?[{id:'unsnooze',label:'Unsnooze',icon:<Undo2 size={16}/>,onSelect:()=>onUnsnooze?.(contextMenu.emailId)}]:[]),
        { id: 'tags', label: 'Manage tags', icon: <Tag size={16} />, disabled: !onAddTags,
          onSelect: () => { if (contextMenu) onAddTags?.(contextMenu.emailId); } },
    ];
    return <ContextMenu position={contextMenu} items={items} onClose={onClose} label="Message actions" />;
}
