"use client";
import {useState} from 'react';
import {useRouter} from 'next/navigation';
import {invoke} from '@tauri-apps/api/core';
import {useAuth} from './AuthContext';

export function RequestAccess({navigate}:{navigate?:(action:()=>void)=>void}) {
 const {user,prepareForUpdate}=useAuth();const router=useRouter();
 const [email,setEmail]=useState(''),[busy,setBusy]=useState(false),[status,setStatus]=useState('');
 const open=async()=>{setBusy(true);setStatus('');try{
  const subject='OrionMail testing access request';const body=`Hello, please approve this Google account for OrionMail testing: ${email.trim()}. Thank you!`;
  const params=new URLSearchParams({subject,body});
  if(user){await prepareForUpdate();await invoke('open_url',{url:`mailto:arunabhajana@gmail.com?${params.toString().replaceAll('+','%20')}`});router.push('/inbox');}
  else {const gmail=new URLSearchParams({view:'cm',fs:'1',to:'arunabhajana@gmail.com',su:subject,body});await invoke('open_url',{url:`https://mail.google.com/mail/?${gmail}`});setStatus('Gmail opened with your request. Review the message and send it to request access.');}
 }catch{setStatus('Could not open your request. Please email arunabhajana@gmail.com with the Google address you want approved.');}finally{setBusy(false);}};
 return <details className="mt-4 rounded-xl border border-primary/15 bg-primary/[0.035] p-4"><summary className="cursor-pointer text-xs font-medium text-primary">Need access? Request an invitation</summary><p className="mt-3 text-xs leading-relaxed text-muted-foreground">OrionMail’s Google sign-in is currently in testing. Request approval for the Google account you want to connect. Approval is manual; submitting a request does not grant immediate access.</p><form className="mt-3 space-y-3" onSubmit={event=>{event.preventDefault();if(navigate)navigate(()=>{void open();});else void open();}}><label className="block text-xs font-medium">Google account email<input type="email" required maxLength={254} autoComplete="email" value={email} onChange={event=>setEmail(event.target.value)} placeholder="you@gmail.com" className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"/></label><button disabled={busy} type="submit" className="rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50">{busy?'Opening…':user?'Write access request':'Request access via Gmail'}</button><p className="text-[11px] leading-relaxed text-muted-foreground">{user?'Opens a draft in OrionMail. Review and send it yourself.':'Opens Gmail in your browser. You may need to sign in before sending.'}</p>{status&&<p role="status" className="text-xs leading-relaxed text-muted-foreground">{status}</p>}</form></details>;
}
