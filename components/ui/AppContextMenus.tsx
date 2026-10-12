"use client";

import React, { useCallback, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Archive, CheckCheck, Clock, Download, Edit2, Forward, FolderOpen, Pin, Reply, Tag, Trash2 } from 'lucide-react';
import { ContextMenu, ContextMenuAction } from './ContextMenu';

const presets: Record<string, ContextMenuAction[]> = {
    folder: [
        { id: 'open', label: 'Open folder', icon: <FolderOpen size={16} /> },
        { id: 'read-all', label: 'Mark all as read', icon: <CheckCheck size={16} /> },
        { id: 'pin', label: 'Pin folder', icon: <Pin size={16} /> },
    ],
    tag: [
        { id: 'open', label: 'Open tag', icon: <Tag size={16} /> },
        { id: 'edit', label: 'Edit tag', icon: <Edit2 size={16} /> },
        { id: 'read-all', label: 'Mark all as read', icon: <CheckCheck size={16} /> },
        { id: 'delete', label: 'Delete tag', icon: <Trash2 size={16} />, destructive: true, separatorBefore: true },
    ],
    message: [
        { id: 'reply', label: 'Reply', icon: <Reply size={16} /> },
        { id: 'forward', label: 'Forward', icon: <Forward size={16} /> },
        { id: 'archive', label: 'Archive', icon: <Archive size={16} />, separatorBefore: true },
        { id: 'snooze', label: 'Snooze', icon: <Clock size={16} /> },
        { id: 'tags', label: 'Add tags', icon: <Tag size={16} /> },
    ],
    attachment: [
        { id: 'download', label: 'Download attachment', icon: <Download size={16} /> },
        { id: 'save', label: 'Save attachment as…', icon: <FolderOpen size={16} /> },
    ],
};

export function AppContextMenus({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const [menu, setMenu] = useState<{ x: number; y: number; scope: string; pathname: string } | null>(null);
    if (menu && menu.pathname !== pathname) setMenu(null);
    const close = useCallback(() => setMenu(null), []);
    return <div className="contents" onContextMenu={event => {
        if (!(event.target instanceof Element)) return;
        // Keep native editing tools in compose, search and other editable controls.
        if (event.target.closest('input, textarea, [contenteditable="true"], [data-native-context-menu]')) {
            close();
            return;
        }
        event.preventDefault();
        const control = event.target.closest('button, a');
        if (control && !control.hasAttribute('data-context-menu')) { close(); return; }
        const scope = event.target.closest('[data-context-menu]')?.getAttribute('data-context-menu');
        if (scope && presets[scope]) setMenu({ x: event.clientX, y: event.clientY, scope, pathname });
        else close();
    }}>
        {children}
        <ContextMenu position={menu?.pathname === pathname ? menu : null}
            items={menu ? presets[menu.scope] : []} onClose={close} label={`${menu?.scope || 'App'} actions`} />
    </div>;
}
