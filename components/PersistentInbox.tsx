"use client";
import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from './AuthContext';
import InboxWorkspace from './InboxWorkspace';
export function PersistentInbox() {
 const {user,accountBusy}=useAuth();const path=usePathname();const [account,setAccount]=useState<string|null>(null);
 if(path==='/inbox'&&user&&user.id!==account)setAccount(user.id);
 if(!user||account!==user.id)return null;
 return <div hidden={path!=='/inbox'} inert={path!=='/inbox'||accountBusy} aria-busy={accountBusy || undefined} className={path==='/inbox'?'h-full min-h-0 w-full':'hidden'}><InboxWorkspace key={account} /></div>;
}
