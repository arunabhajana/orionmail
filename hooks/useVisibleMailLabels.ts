"use client";
import {useEffect} from 'react';
import {invoke} from '@tauri-apps/api/core';
import type {Email} from '@/lib/types';

let refreshing=false;
export function useVisibleMailLabels(accountId:string|undefined,emails:Email[],enabled:boolean){
    const signature=JSON.stringify(emails.slice(0,100).map(email=>({folder:email.folder,uid:email.uid})));
    useEffect(()=>{
        if(!accountId||!enabled||signature==='[]')return;
        let disposed=false;
        const refresh=async()=>{
            if(disposed||refreshing||document.visibilityState!=='visible')return;
            refreshing=true;
            try{await invoke('refresh_message_labels',{accountId,requests:JSON.parse(signature)});}
            catch{/* Quiet background refresh; explicit edits report their failures. */}
            finally{refreshing=false;}
        };
        const timer=setTimeout(()=>{void refresh();},500);
        const interval=setInterval(()=>{void refresh();},10000);
        const focus=()=>{void refresh();};
        window.addEventListener('focus',focus);document.addEventListener('visibilitychange',focus);
        return()=>{disposed=true;clearTimeout(timer);clearInterval(interval);window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',focus);};
    },[accountId,enabled,signature]);
}
