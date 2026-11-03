"use client";
import {cloneElement,type ReactElement,type HTMLAttributes} from 'react';
import {ActionTooltip} from '../ui/ActionTooltip';
export function SidebarHint({label,children,className=''}:{label:string;children:ReactElement<HTMLAttributes<HTMLElement>>;className?:string}){
 return <ActionTooltip label={label} side="right" className={className}>{description=>cloneElement(children,{title:undefined,'aria-describedby':description})}</ActionTooltip>;
}
