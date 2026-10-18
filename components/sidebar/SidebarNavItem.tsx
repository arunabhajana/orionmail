"use client";
import React, { memo } from 'react';
import { ChevronDown, Pencil, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { NavItemConfig, Tag } from '@/lib/types';
export const NavItem = memo(({ icon: Icon, label, id, badge, highlight, onClick }: NavItemConfig & { onClick?: () => void }) => <button type="button" data-context-menu={['inbox', 'sent', 'starred'].includes(id) ? 'folder' : undefined} aria-label={label} aria-current={highlight ? 'page' : undefined} title={label} onClick={onClick} className={cn('mail-nav-item', highlight && 'is-active')}>
    <Icon className="size-[18px] shrink-0" strokeWidth={1.7} /><span className="mail-nav-label min-w-0 flex-1 truncate text-left">{label}</span>{Boolean(badge && badge > 0) && <span className="mail-folder-count">{badge! > 999 ? '999+' : badge}</span>}
</button>);
NavItem.displayName = 'NavItem';
export const TagItem = memo(({ tag, basename, highlight, onClick, onEdit, onDelete, hasChildren, isCollapsed, onToggleCollapse }: {
    tag: Tag; basename?: string; highlight?: boolean; onClick?: () => void; onEdit?: (tag: Tag) => void; onDelete?: (tag: Tag) => void; hasChildren?: boolean; isCollapsed?: boolean; onToggleCollapse?: () => void;
}) => <div data-context-menu="tag" className={cn('mail-tag-row group', highlight && 'is-active')}>
    {hasChildren && <button type="button" aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${basename || tag.name}`} aria-expanded={!isCollapsed} onClick={onToggleCollapse} className="mail-tag-collapse"><ChevronDown className={cn('size-3', isCollapsed && '-rotate-90')} /></button>}
    <button type="button" onClick={onClick} aria-current={highlight ? 'page' : undefined} title={tag.name} className="mail-tag-select"><span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: tag.bg_color || '#94a3b8' }} /><span className="min-w-0 flex-1 truncate text-left">{basename || tag.name}</span></button>
    <div className="mail-tag-actions">{onEdit && <button type="button" aria-label={`Edit ${tag.name}`} title="Edit tag" onClick={() => onEdit(tag)}><Pencil className="size-3" /></button>}{onDelete && <button type="button" aria-label={`Delete ${tag.name}`} title="Delete tag" onClick={() => onDelete(tag)} className="hover:!text-red-500"><Trash2 className="size-3" /></button>}</div>
</div>);
TagItem.displayName = 'TagItem';
