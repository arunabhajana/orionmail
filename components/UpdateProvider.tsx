"use client";
import {createContext,useContext,useEffect,useRef,useState,useCallback,type ReactNode} from 'react';
import {usePathname} from 'next/navigation';
import {isPublicDocument} from './PublicPageBoundary';
import {isTauri} from '@tauri-apps/api/core';
import {check,type Update} from '@tauri-apps/plugin-updater';
import {isPermissionGranted,requestPermission,sendNotification} from '@tauri-apps/plugin-notification';
import {useAuth} from './AuthContext';
import {currentRelease} from '@/lib/generated/releases';
import {WhatsNewModal} from './settings/ReleaseNotes';
import {settingButton} from './settings/SettingsControls';
import {toast} from 'sonner';
const HOUR=60*60*1000;
const Context=createContext({checkNow:async()=>{},status:'Automatic update checks run on launch and hourly.',busy:false});
export const useUpdates=()=>useContext(Context);
export function UpdateProvider({children}:{children:ReactNode}){
 const {prepareForUpdate}=useAuth();
 const publicDocument=isPublicDocument(usePathname());
 const [update,setUpdate]=useState<Update|null>(null),[open,setOpen]=useState(false),[installing,setInstalling]=useState(false),[progress,setProgress]=useState<number|null>(null),[error,setError]=useState(''),[status,setStatus]=useState('Automatic update checks run on launch and hourly.'),[highlights,setHighlights]=useState(false);
 const held=useRef<Update|null>(null),checking=useRef(false),installLock=useRef(false),alive=useRef(false),announced=useRef(new Set<string>()),deferred=useRef(new Set<string>());
 const dialog=useRef<HTMLDialogElement>(null);
 const checkNow=useCallback(async(manual=true)=>{
  if(!isTauri()||process.env.NODE_ENV!=='production'){if(manual)toast.info('Update checks are available in installed production builds.');return;}
  if(checking.current||installLock.current)return;checking.current=true;
  try{
   const next=await check({timeout:15000});
   if(!alive.current||installLock.current){await next?.close();return;}
   if(!next){setStatus('You’re up to date.');if(manual)toast.success('You’re up to date.');return;}
   const previous=held.current;held.current=next;setUpdate(next);if(previous)await previous.close();
   setStatus(`Version ${next.version} is available.`);
   if(manual)deferred.current.delete(next.version);
   if(document.visibilityState==='visible'&&!deferred.current.has(next.version))setOpen(true);
   if(!announced.current.has(next.version)){
    announced.current.add(next.version);
    try{const allowed=await isPermissionGranted()||await requestPermission()==='granted';if(allowed&&alive.current)sendNotification({title:'OrionMail update available',body:`Version ${next.version} is ready. Open OrionMail to update now or later.`});}catch{/* Notification denial never prevents updates. */}
   }
  }catch{if(alive.current){setStatus('Could not check for updates. We’ll retry automatically.');if(manual)toast.error('Could not check for updates. Try again later.');}}
  finally{checking.current=false;}
 },[]);
 useEffect(()=>{
  alive.current=true;
  try{
   const last=localStorage.getItem('orion_installed_version'),pending=localStorage.getItem('orion_pending_update');
   if((!last||last!==currentRelease.version||pending===currentRelease.version)&&!currentRelease.sample&&currentRelease.whatsNew.length)queueMicrotask(()=>{if(alive.current)setHighlights(true);});
   else localStorage.setItem('orion_installed_version',currentRelease.version);
  }catch{/* The update service remains usable when storage is unavailable. */}
  queueMicrotask(()=>{if(alive.current)void checkNow(false);});const timer=setInterval(()=>{void checkNow(false);},HOUR);
  const visible=()=>{const next=held.current;if(document.visibilityState==='visible'&&next&&!deferred.current.has(next.version))setOpen(true);};
  document.addEventListener('visibilitychange',visible);
  return()=>{alive.current=false;clearInterval(timer);document.removeEventListener('visibilitychange',visible);const next=held.current;held.current=null;void next?.close().catch(()=>{});};
 },[checkNow]);
 useEffect(()=>{if(!open||publicDocument)return;const element=dialog.current;element?.showModal();return()=>element?.close();},[open,publicDocument]);
 const later=()=>{if(installLock.current)return;if(update)deferred.current.add(update.version);setOpen(false);setError('');};
 const install=async()=>{
  const next=held.current;if(!next||installLock.current)return;installLock.current=true;setInstalling(true);setError('');setProgress(null);
  let received=0,total=0;
  try{
   await prepareForUpdate();
   localStorage.setItem('orion_pending_update',next.version);
   await next.downloadAndInstall(event=>{
    if(event.event==='Started'){total=event.data.contentLength||0;received=0;}
    if(event.event==='Progress'){received+=event.data.chunkLength;setProgress(total?Math.min(100,Math.round(received/total*100)):null);}
    if(event.event==='Finished'){setProgress(100);setStatus('Installing update… OrionMail will restart.');}
   });
  }catch(reason){setError(reason instanceof Error?reason.message:String(reason));setStatus('Update was not installed. You can retry.');}
  finally{installLock.current=false;setInstalling(false);}
 };
 const dismissHighlights=()=>{try{localStorage.setItem('orion_installed_version',currentRelease.version);localStorage.removeItem('orion_pending_update');}catch{}setHighlights(false);};
 return <Context.Provider value={{checkNow:()=>checkNow(true),status,busy:installing}}>{children}
  {open&&update&&<dialog ref={dialog} aria-labelledby="app-update-title" onCancel={event=>{event.preventDefault();later();}} onKeyDown={event=>event.stopPropagation()} className="m-auto w-[calc(100%_-_2rem)] max-w-md rounded-3xl border border-border bg-background/95 p-6 text-foreground shadow-2xl backdrop-blur-2xl backdrop:bg-black/50">
   <p className="text-xs font-medium text-primary">OrionMail · Version {update.version}</p><h2 id="app-update-title" className="mt-3 text-2xl font-semibold">{installing?'Updating OrionMail':'An update is ready'}</h2>
   <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{installing?'Keep OrionMail open while the update downloads and installs. The app will restart.':'Install the latest improvements now, or keep working and update later. Your draft must save successfully before installation.'}</p>
   {installing&&<progress aria-label="Update download" max={100} value={progress??undefined} className="mt-5 w-full accent-primary"/>}
   {error&&<p role="alert" className="mt-4 text-sm text-red-500">{error}</p>}
   <div className="mt-6 flex justify-end gap-2"><button disabled={installing} className={settingButton} onClick={later}>Later</button><button disabled={installing} className={settingButton+' !bg-primary !text-white'} onClick={()=>{void install();}}>{installing?'Updating…':error?'Retry update':'Update now'}</button></div>
  </dialog>}
  {highlights&&!open&&!publicDocument&&<WhatsNewModal onClose={dismissHighlights}/>}
 </Context.Provider>;
}
