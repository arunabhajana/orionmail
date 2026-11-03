"use client";
import {useCallback,useEffect,useRef,useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';
import type { NativeMessageHeader } from '@/lib/types';
export interface SnoozeRecord {key:string;until:number;message:NativeMessageHeader}
export function useSnoozedMail(accountId:string|undefined){
 const [state,setState]=useState<{accountId?:string;active:SnoozeRecord[];returned:SnoozeRecord[]}>({active:[],returned:[]});const generation=useRef(0);const alive=useRef(false);
 const refresh=useCallback(async()=>{if(!accountId)return;const version=++generation.current;const result=await invoke<{active:SnoozeRecord[];returned:SnoozeRecord[]}>('list_snoozed_mail',{accountId});if(alive.current&&version===generation.current)setState(previous=>{const next={accountId,...result};return JSON.stringify(previous)===JSON.stringify(next)?previous:next;});},[accountId]);
 useEffect(()=>{alive.current=true;let active=true;let timer:ReturnType<typeof setTimeout>|undefined;const stops:(()=>void)[]=[];
 const update=()=>{if(timer)return;timer=setTimeout(()=>{timer=undefined;void refresh().catch(console.error);},1500);};
 if(accountId){queueMicrotask(()=>{if(active)void refresh().catch(console.error);});for(const event of ['mail:snoozes_changed','mail:updated'])void listen<string|{account_id:string}>(event,({payload})=>{if((typeof payload==='string'?payload:payload.account_id)===accountId)update();}).then(stop=>{if(active)stops.push(stop);else stop();});}
 const focus=()=>{if(document.visibilityState==='visible')update();};window.addEventListener('focus',focus);document.addEventListener('visibilitychange',focus);
 return()=>{active=false;alive.current=false;clearTimeout(timer);stops.forEach(stop=>stop());window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',focus);};
 },[accountId,refresh]);
 useEffect(()=>{if(state.accountId!==accountId||!state.active.length)return;const next=Math.min(...state.active.map(item=>item.until))*1000;let timer:ReturnType<typeof setTimeout>;const arm=()=>{const delay=next-Date.now()+100;timer=setTimeout(()=>{if(delay>2147483647)arm();else void refresh().catch(console.error);},Math.max(100,Math.min(delay,2147483647)));};arm();return()=>clearTimeout(timer);},[state,accountId,refresh]);
 return {active:state.accountId===accountId?state.active:[],returned:state.accountId===accountId?state.returned:[],refresh};
}
