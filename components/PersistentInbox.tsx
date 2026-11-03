"use client";
import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from './AuthContext';
import {useMailboxView} from './MailboxViewContext';
import UnifiedInbox from './UnifiedInbox';
import InboxWorkspace from './InboxWorkspace';
export function PersistentInbox() {
 const view=useMailboxView();
 const {user,accountBusy}=useAuth();const path=usePathname();const [account,setAccount]=useState<string|null>(null);
 if(!view.unified&&path==='/inbox'&&user&&user.id!==account)setAccount(user.id);
 if(!user)return null;
 if(view.unified)return <div hidden={path!=='/inbox'} inert={path!=='/inbox'||accountBusy} className={path==='/inbox'?'h-full min-h-0 w-full':'hidden'}><UnifiedInbox/></div>;
 if(account!==user.id)return null;
 return <div hidden={path!=='/inbox'} inert={path!=='/inbox'||accountBusy} aria-busy={accountBusy || undefined} className={path==='/inbox'?'h-full min-h-0 w-full':'hidden'}><InboxWorkspace key={account} /></div>;
}
