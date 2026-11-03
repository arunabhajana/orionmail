"use client";
import {useCallback,useRef,useState} from 'react';
import {useRouter,usePathname} from 'next/navigation';
import {Layers,LoaderCircle,Inbox,Send,File,Trash2,Settings,LogOut} from 'lucide-react';
import Image from 'next/image';
import {useAccountIdentities} from './AccountIdentityControls';
import {useAccountUnreadOverview} from '@/hooks/useAccountUnreadOverview';
import {SidebarHint} from '../sidebar/SidebarHint';
import {ContextMenu,type ContextMenuAction} from '../ui/ContextMenu';
import {useMailboxView} from '../MailboxViewContext';
import {useAuth} from '@/components/AuthContext';
import {mailInitials} from '@/lib/mail-display';
import {toast} from 'sonner';
export function AccountList({onSelected,variant='menu'}:{onSelected?:()=>void;variant?:'menu'|'sidebar'}){
 const {user,accounts,accountBusy,switchAccount,logout}=useAuth();const router=useRouter();
 const pathname=usePathname();
 const overview=useAccountUnreadOverview(variant!=='sidebar'||pathname==='/inbox'),view=useMailboxView(),identities=useAccountIdentities();
 const [menu,setMenu]=useState<{owner:string;x:number;y:number}|null>(null);const close=useCallback(()=>setMenu(null),[]);const switching=useRef(false);
 const profiles=accounts?.length?accounts:user?[user]:[];
 const choose=async(owner:string,folder?:string,settings=false)=>{
  if(switching.current||accountBusy)return;switching.current=true;
  const token=view.requestNavigation(owner,folder);
  try{await switchAccount(owner,true);if(token)view.authorizeNavigation(token);view.setFolder('');view.setUnified(false);if(settings)router.push('/settings');onSelected?.();}
  catch(error){if(token)view.completeNavigation(token);toast.error('Could not switch accounts',{description:String(error)});}
  finally{switching.current=false;}
 };
 const chooseAll=async()=>{
  if(!user||switching.current||accountBusy)return;switching.current=true;
  try{await switchAccount(user.id,true);view.requestNavigation(user.id);view.setUnified(true);onSelected?.();}
  catch(error){toast.error('Could not open all inboxes',{description:String(error)});}
  finally{switching.current=false;}
 };
 const owner=profiles.find(account=>account.id===menu?.owner);
 const items:ContextMenuAction[]=owner?[
  {id:'inbox',label:'Open Inbox',icon:<Inbox size={15}/>,disabled:accountBusy,onSelect:()=>{void choose(owner.id,'inbox');}},
  {id:'sent',label:'Open Sent',icon:<Send size={15}/>,disabled:accountBusy,onSelect:()=>{void choose(owner.id,'sent');}},
  {id:'drafts',label:'Open Drafts',icon:<File size={15}/>,disabled:accountBusy,onSelect:()=>{void choose(owner.id,'drafts');}},
  {id:'trash',label:'Open Trash',icon:<Trash2 size={15}/>,disabled:accountBusy,onSelect:()=>{void choose(owner.id,'trash');}},
  {id:'settings',label:'Account settings',icon:<Settings size={15}/>,separatorBefore:true,disabled:accountBusy,onSelect:()=>{void choose(owner.id,undefined,true);}},
  {id:'signout',label:'Sign out of this account',icon:<LogOut size={15}/>,separatorBefore:true,destructive:true,disabled:accountBusy,onSelect:()=>{void logout(owner.id).catch(error=>toast.error('Could not sign out',{description:String(error)}));}}
 ]:[];
 return <>
  {(profiles.length>1||view.unified)&&<SidebarHint label="Inbox mail from every connected account" className="w-full"><button type="button" disabled={accountBusy} aria-current={view.unified?'page':undefined} onClick={()=>{void chooseAll();}} className={'mail-profile-action mail-account-all mb-2 '+(view.unified?'is-active bg-primary/10 text-primary':'')}><Layers className="size-[18px] shrink-0"/><span className="mail-account-copy flex-1 text-left">All inboxes</span></button></SidebarHint>}
  {variant!=='sidebar'&&<p className="mail-account-overview mb-2 px-3 text-[10px] text-muted-foreground" role="status">All accounts · {overview.total===null?'Unread count unavailable':`${overview.total.toLocaleString()} unread`}</p>}
  <ul aria-label="Connected accounts" className={variant==='sidebar'?'mail-account-list space-y-1':'max-h-64 space-y-1 overflow-y-auto custom-scrollbar'}>
   {[...profiles].sort((a,b)=>(identities.accounts?.[a.id]?.rank??999)-(identities.accounts?.[b.id]?.rank??999)).map(account=><li key={account.id}
    onContextMenu={variant==='sidebar'?event=>{event.preventDefault();event.stopPropagation();setMenu({owner:account.id,x:event.clientX,y:event.clientY});}:undefined}
    onKeyDown={variant==='sidebar'?event=>{if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10'){event.preventDefault();event.stopPropagation();const rect=event.currentTarget.getBoundingClientRect();setMenu({owner:account.id,x:rect.left+12,y:rect.bottom});}}:undefined}>
    <SidebarHint label={`${account.name||account.email} · ${account.email}${variant==='sidebar'?` · ${overview.counts[account.id]??'Unknown'} unread · Right-click for views and account options`:''}`} className="w-full"><button type="button" disabled={accountBusy} aria-current={!view.unified&&user?.id===account.id?'true':undefined}
     aria-label={`${account.name||account.email}, ${account.email}${!view.unified&&user?.id===account.id?', active account':''}${account.needs_reauth?', reconnect required':''}${variant==='sidebar'?`, ${overview.counts[account.id]??'Unknown'} unread`:''}`} onClick={()=>{void choose(account.id);}}
     className={'mail-account-choice flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-wait disabled:opacity-60 '+(!view.unified&&user?.id===account.id?'is-active bg-primary/[0.08]':'hover:bg-black/[0.04] dark:hover:bg-white/[0.05]')}>
     <span className="relative size-[30px] shrink-0">{account.picture?<Image src={account.picture} alt="" width={30} height={30} unoptimized referrerPolicy="no-referrer" className="size-[30px] rounded-full object-cover"/>:<span className="flex size-[30px] items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">{mailInitials(account.name||account.email)}</span>}<span aria-hidden="true" className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-background" style={{backgroundColor:identities.accounts?.[account.id]?.color||'#3b82f6'}}/></span>
     <span className="mail-account-copy min-w-0 flex-1"><span className="block truncate text-xs font-medium">{variant==='sidebar'?account.email:account.name||account.email}</span>{variant!=='sidebar'&&<span className="mt-0.5 block truncate text-[10px] text-muted-foreground">{account.email}</span>}{account.needs_reauth&&<span className="mt-1 block text-[10px] text-amber-600 dark:text-amber-400">Reconnect required</span>}</span>
     <span className="mail-account-unread shrink-0 rounded-md bg-foreground/5 px-1.5 py-1 text-[10px] tabular-nums text-muted-foreground" aria-label={`${overview.counts[account.id]??'Unknown'} unread`}>{overview.counts[account.id]===undefined?'—':overview.counts[account.id]>999?'999+':overview.counts[account.id]}</span>
     {user?.id===account.id&&accountBusy&&<LoaderCircle aria-hidden="true" size={13} className="mail-account-busy shrink-0 animate-spin text-primary motion-reduce:animate-none"/>}
    </button></SidebarHint>
   </li>)}
  </ul>
  <ContextMenu position={owner&&menu?menu:null} items={items} onClose={close} caption={owner?.email} label={`${owner?.email||'Account'} views`}/>
 </>;
}
