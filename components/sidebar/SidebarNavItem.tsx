"use client";
import React, {memo,useCallback,useState} from 'react';
import {ChevronDown,Pencil,Trash2,FolderOpen} from 'lucide-react';
import {cn} from '@/lib/utils';
import {NavItemConfig,Tag} from '@/lib/types';
import {ActionTooltip} from '../ui/ActionTooltip';
import {ContextMenu,type ContextMenuAction} from '../ui/ContextMenu';
export const NavItem=memo(({icon:Icon,label,id,badge,highlight,onClick,hint}:NavItemConfig&{onClick?:()=>void;hint?:string})=><ActionTooltip label={hint||label} side="right" className="w-full">{description=><button type="button" data-context-menu={['inbox','sent','starred'].includes(id)?'folder':undefined} aria-label={hint||label} aria-describedby={description} aria-current={highlight?'page':undefined} onClick={onClick} className={cn('mail-nav-item',highlight&&'is-active')}><Icon className="size-[18px] shrink-0" strokeWidth={1.7}/><span className="mail-nav-label min-w-0 flex-1 truncate text-left">{label}</span>{Boolean(badge&&badge>0)&&<span className="mail-folder-count">{badge!>999?'999+':badge}</span>}</button>}</ActionTooltip>);
NavItem.displayName='NavItem';
export const TagItem=memo(({tag,basename,highlight,onClick,onEdit,onDelete,hasChildren,isCollapsed,onToggleCollapse}:{tag:Tag;basename?:string;highlight?:boolean;onClick?:()=>void;onEdit?:(tag:Tag)=>void;onDelete?:(tag:Tag)=>void;hasChildren?:boolean;isCollapsed?:boolean;onToggleCollapse?:()=>void})=>{
 const [position,setPosition]=useState<{x:number;y:number}|null>(null);
 const close=useCallback(()=>setPosition(null),[]);
 const items:ContextMenuAction[]=[{id:'open',label:'Open tag',icon:<FolderOpen size={15}/>,onSelect:onClick,disabled:!onClick},
 ...(onEdit?[{id:'edit',label:'Edit name & colour',icon:<Pencil size={15}/>,onSelect:()=>onEdit(tag)}]:[]),
 ...(hasChildren&&onToggleCollapse?[{id:'expand',label:isCollapsed?'Expand subtags':'Collapse subtags',icon:<ChevronDown size={15}/>,onSelect:onToggleCollapse}]:[]),
 ...(onDelete?[{id:'delete',label:'Delete tag',icon:<Trash2 size={15}/>,onSelect:()=>onDelete(tag),destructive:true,separatorBefore:true}]:[])];
 return <div className={cn('mail-tag-row group',highlight&&'is-active')} onContextMenu={event=>{event.preventDefault();event.stopPropagation();setPosition({x:event.clientX,y:event.clientY});}} onKeyDown={event=>{if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10'){event.preventDefault();event.stopPropagation();const rect=event.currentTarget.getBoundingClientRect();setPosition({x:rect.left+12,y:rect.bottom});}}}>
 {hasChildren&&<ActionTooltip label={`${isCollapsed?'Expand':'Collapse'} ${basename||tag.name}`} side="right">{description=><button type="button" aria-label={`${isCollapsed?'Expand':'Collapse'} ${basename||tag.name}`} aria-describedby={description} aria-expanded={!isCollapsed} onClick={onToggleCollapse} className="mail-tag-collapse"><ChevronDown className={cn('size-3',isCollapsed&&'-rotate-90')}/></button>}</ActionTooltip>}
 <ActionTooltip label={tag.name} side="right" className="min-w-0 flex-1">{description=><button type="button" onClick={onClick} aria-describedby={description} aria-current={highlight?'page':undefined} className="mail-tag-select w-full"><span className="size-2 shrink-0 rounded-full" style={{backgroundColor:tag.bg_color||'#94a3b8'}}/><span className="min-w-0 flex-1 truncate text-left">{basename||tag.name}</span></button>}</ActionTooltip>
 <div className="mail-tag-actions">{onEdit&&<ActionTooltip label="Edit tag" side="right">{description=><button type="button" aria-label={`Edit ${tag.name}`} aria-describedby={description} onClick={()=>onEdit(tag)}><Pencil className="size-3"/></button>}</ActionTooltip>}{onDelete&&<ActionTooltip label="Delete tag" side="right">{description=><button type="button" aria-label={`Delete ${tag.name}`} aria-describedby={description} onClick={()=>onDelete(tag)} className="hover:!text-red-500"><Trash2 className="size-3"/></button>}</ActionTooltip>}</div>
 <ContextMenu position={position} items={items} onClose={close} label={`${tag.name} actions`}/>
 </div>;
});
TagItem.displayName='TagItem';
