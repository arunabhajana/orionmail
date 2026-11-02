"use client";
import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useAuth } from './AuthContext';

export function MailtoNavigation() {
    const {user,appLockStatus}=useAuth();
    const pathname=usePathname();const router=useRouter();
    useEffect(()=>{
        if(!user||appLockStatus!=='unlocked'||pathname==='/inbox')return;
        let active=true;let stop:(()=>void)|undefined;
        const check=async()=>{try{const pending=await invoke('pending_mailto');if(!active||!pending)return;if(pathname==='/settings')window.dispatchEvent(new Event('orion:mailto-navigation'));else router.push('/inbox');}catch{/* Unlock/sign-in will retry on mount. */}};
        void listen('mailto:pending',()=>{void check();}).then(fn=>{if(active){stop=fn;void check();}else fn();});
        return()=>{active=false;stop?.();};
    },[user,appLockStatus,pathname,router]);
    return null;
}
