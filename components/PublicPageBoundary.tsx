"use client";
import {useState,type ReactNode} from 'react';
import {usePathname} from 'next/navigation';
export function isPublicDocument(path:string){return ['/privacy','/terms','/license','/notices'].includes(path);}
/** Standalone legal pages never initialize auth; an existing desktop session stays mounted. */
export function PublicPageBoundary({children,desktop}:{children:ReactNode;desktop:ReactNode}){
 const legal=isPublicDocument(usePathname());
 const [started,setStarted]=useState(!legal);
 if(!legal&&!started)setStarted(true);
 return <><div hidden={legal} inert={legal} className={legal?'hidden':'h-full w-full'}>{started?desktop:null}</div>{legal?children:null}</>;
}
/** Keep route content out of the hidden desktop when a public document is shown separately. */
export function DesktopRouteContent({children}:{children:ReactNode}){return isPublicDocument(usePathname())?null:children;}
