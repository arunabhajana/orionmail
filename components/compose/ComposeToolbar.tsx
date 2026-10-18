"use client";
import React from 'react';
import type { Editor } from '@tiptap/core';
import { Bold, Italic, Underline, List, ListOrdered, AlignLeft, AlignCenter, AlignRight, Link, Undo2, Redo2 } from 'lucide-react';
import { cn } from '@/lib/utils';
interface Action { label: string; icon: React.ElementType; run: () => void; active?: boolean; disabled?: boolean; }
export function ComposeToolbar({ editor, onLink, disabled }: { editor: Editor | null; onLink: () => void; disabled: boolean }) {
    const groups: Action[][] = [
        [{ label: 'Bold (Ctrl+B)', icon: Bold, active: editor?.isActive('bold'), run: () => { editor?.chain().focus().toggleBold().run(); } },
         { label: 'Italic (Ctrl+I)', icon: Italic, active: editor?.isActive('italic'), run: () => { editor?.chain().focus().toggleItalic().run(); } },
         { label: 'Underline (Ctrl+U)', icon: Underline, active: editor?.isActive('underline'), run: () => { editor?.chain().focus().toggleUnderline().run(); } }],
        [{ label: 'Bullet list', icon: List, active: editor?.isActive('bulletList'), run: () => { editor?.chain().focus().toggleBulletList().run(); } },
         { label: 'Numbered list', icon: ListOrdered, active: editor?.isActive('orderedList'), run: () => { editor?.chain().focus().toggleOrderedList().run(); } }],
        [{ label: 'Align left', icon: AlignLeft, active: editor?.isActive('paragraph', { textAlign: 'left' }), run: () => { editor?.chain().focus().setTextAlign('left').run(); } },
         { label: 'Align center', icon: AlignCenter, active: editor?.isActive('paragraph', { textAlign: 'center' }), run: () => { editor?.chain().focus().setTextAlign('center').run(); } },
         { label: 'Align right', icon: AlignRight, active: editor?.isActive('paragraph', { textAlign: 'right' }), run: () => { editor?.chain().focus().setTextAlign('right').run(); } }],
        [{ label: 'Insert link (Ctrl+K)', icon: Link, active: editor?.isActive('link'), disabled: !editor || (editor.state.selection.empty && !editor.isActive('link')), run: onLink }],
        [{ label: 'Undo (Ctrl+Z)', icon: Undo2, disabled: !editor?.can().undo(), run: () => { editor?.chain().focus().undo().run(); } },
         { label: 'Redo (Ctrl+Shift+Z)', icon: Redo2, disabled: !editor?.can().redo(), run: () => { editor?.chain().focus().redo().run(); } }],
    ];
    return <div role="group" aria-label="Message formatting" className="compose-formatting">{groups.map((group, index) => <div key={index} className="compose-format-group">{group.map(action => <button key={action.label} type="button" title={action.label} aria-label={action.label} aria-pressed={action.active} disabled={disabled || !editor || action.disabled} onMouseDown={event => event.preventDefault()} onClick={action.run} className={cn('compose-tool', action.active && 'is-active')}><action.icon className="size-4" strokeWidth={1.7} /></button>)}</div>)}</div>;
}
