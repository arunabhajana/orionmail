"use client";

import React from 'react';
import { Reply, ReplyAll, Forward, Archive, Trash2, Mail, MailOpen, Pin, Clock, Tag, Undo2 } from 'lucide-react';
import { ContextMenu, ContextMenuAction } from '@/components/ui/ContextMenu';

export interface EmailContextMenuState {
    x: number;
    y: number;
    emailId: string;
    unread: boolean;
}

export function EmailContextMenu({ contextMenu, onClose, onToggleRead, onAddTags, isTrash, onRestore, onDelete }: {
    contextMenu: EmailContextMenuState | null;
    onClose: () => void;
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
        { id: 'reply', label: 'Reply', icon: <Reply size={16} /> },
        { id: 'reply-all', label: 'Reply All', icon: <ReplyAll size={16} /> },
        { id: 'forward', label: 'Forward', icon: <Forward size={16} /> },
        { id: 'archive', label: 'Archive', icon: <Archive size={16} />, separatorBefore: true },
        { id: 'delete', label: 'Move to Trash', icon: <Trash2 size={16} />, destructive: true, disabled: !onDelete, onSelect: () => { if (contextMenu) onDelete?.(contextMenu.emailId); } },
        { id: 'read', label: contextMenu?.unread ? 'Mark as Read' : 'Mark as Unread',
          icon: contextMenu?.unread ? <MailOpen size={16} /> : <Mail size={16} />,
          disabled: !onToggleRead,
          onSelect: () => { if (contextMenu) onToggleRead?.(contextMenu.emailId); } },
        { id: 'pin', label: 'Pin email', icon: <Pin size={16} />, separatorBefore: true },
        { id: 'snooze', label: 'Snooze', icon: <Clock size={16} /> },
        { id: 'tags', label: 'Manage tags', icon: <Tag size={16} />, disabled: !onAddTags,
          onSelect: () => { if (contextMenu) onAddTags?.(contextMenu.emailId); } },
    ];
    return <ContextMenu position={contextMenu} items={items} onClose={onClose} label="Message actions" />;
}
