"use client";
import {createContext,useCallback,useContext,useEffect,useLayoutEffect,useMemo,useRef,useState,useSyncExternalStore,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {AnimatePresence,motion,useReducedMotion} from 'framer-motion';
import {Search,Command,X,Inbox,Mail,Star,Send,File,Clock,Settings,Users,Sun,Moon,Monitor,Keyboard,ChevronRight} from 'lucide-react';
import {usePathname,useRouter} from 'next/navigation';
import {useTheme} from 'next-themes';
import {toast} from 'sonner';
import {useAuth} from './AuthContext';
import {useMailboxView} from './MailboxViewContext';
import {useAppPreferences} from './AppPreferencesContext';
import {rankCommands,type MailCommand} from '@/lib/commands';
import {cn} from '@/lib/utils';
const subscribeMounted=()=>()=>{};
type Registry={register:(get:()=>MailCommand[])=>()=>void;open:()=>void};
const Context=createContext<Registry|null>(null);
export function useMailboxCommands(get:()=>MailCommand[]){
 const context=useContext(Context);const latest=useRef(get);useLayoutEffect(()=>{latest.current=get;},[get]);
 const register=context?.register;useEffect(()=>register?.(()=>latest.current()),[register]);
}
export function CommandPaletteProvider({children}:{children:ReactNode}){
 const mounted=useSyncExternalStore(subscribeMounted,()=>true,()=>false);
 const auth=useAuth();const view=useMailboxView();const path=usePathname();const router=useRouter();const {preferences,devicePreferences}=useAppPreferences();const {setTheme}=useTheme();
 const registry=useRef(new Set<()=>MailCommand[]>());const [open,setOpen]=useState(false),[query,setQuery]=useState(''),[active,setActive]=useState(0),[snapshot,setSnapshot]=useState<MailCommand[]>([]);
 const [pendingSearch,setPendingSearch]=useState<{query?:string;token:number}|null>(null);const input=useRef<HTMLInputElement>(null);const dialog=useRef<HTMLDivElement>(null);const previousFocus=useRef<HTMLElement|null>(null);const reduced=useReducedMotion();
 const shortcuts=view.unified?devicePreferences.shortcutsEnabled:preferences.shortcutsEnabled;
 const navigate=async(folder:string,unified=false)=>{await auth.prepareForUpdate();if(!unified&&auth.user){const token=view.requestNavigation(auth.user.id,folder);if(token)view.authorizeNavigation(token);}view.setFolder(folder);view.setUnified(unified);router.push('/inbox');};
 const search=async(text?:string,all=false)=>{
  if(all||path!=='/inbox'||!document.querySelector('[data-mail-search]:not([disabled])'))await navigate('inbox',all||view.unified);
  setPendingSearch({query:text,token:Date.now()});
 };
 useEffect(()=>{if(!pendingSearch||path!=='/inbox')return;let frame=0,tries=0;const focus=()=>{const field=[...document.querySelectorAll<HTMLInputElement>('[data-mail-search]')].find(node=>!node.closest('[hidden],[inert]'));if(field){if(pendingSearch.query!==undefined)window.dispatchEvent(new CustomEvent('orion:search',{detail:{query:pendingSearch.query}}));field.focus();field.select();setPendingSearch(null);}else if(++tries<120)frame=requestAnimationFrame(focus);};frame=requestAnimationFrame(focus);return()=>cancelAnimationFrame(frame);},[pendingSearch,path,view.unified]);
 const commands=():MailCommand[]=>[
  {id:'search.focus',label:'Search mail',group:'Search',keywords:'find messages filter advanced',shortcut:'Ctrl S',icon:Search,run:()=>search()},
  {id:'search.all',label:'Search all connected mail',group:'Search',keywords:'all accounts unified inbox',icon:Users,run:()=>search('in:all',true)},
  {id:'search.unread',label:'Find unread mail',group:'Search',keywords:'unread filter',icon:Mail,run:()=>search('is:unread in:all')},
  {id:'search.attachments',label:'Find mail with attachments',group:'Search',keywords:'files documents pdf',icon:File,run:()=>search('has:attachment in:all')},
  ...([['inbox','Inbox',Inbox],['starred','Starred',Star],['sent','Sent',Send],['drafts','Drafts',File],['outbox','Outbox',Send],['snoozed','Snoozed',Clock],['trash','Trash',Mail]] as const).map(([folder,label,icon])=>({id:'go.'+folder,label:'Go to '+label,group:'Navigate',icon,run:()=>navigate(folder)})),
  ...(auth.accounts.length>1?[{id:'go.unified',label:'Go to All inboxes',group:'Navigate',icon:Users,run:()=>navigate('inbox',true)}]:[]),
  {id:'go.settings',label:'Open Settings',group:'Navigate',icon:Settings,run:async()=>{await auth.prepareForUpdate();router.push('/settings');}},
  {id:'help.shortcuts',label:'Show keyboard shortcuts',group:'Help',keywords:'help keys productivity',icon:Keyboard,run:()=>{toast.info('Keyboard shortcuts',{description:'Ctrl+K: command palette · Ctrl+S: search · Ctrl+N: compose · Ctrl+Shift+U: toggle read. In the editor, Ctrl+K inserts a link.',duration:8000});}},
  ...auth.accounts.map(account=>({id:'account.'+account.id,label:'Switch to '+(account.name||account.email),group:'Accounts',keywords:account.email,icon:Users,run:async()=>{await auth.switchAccount(account.id,true);const token=view.requestNavigation(account.id,'inbox');if(token)view.authorizeNavigation(token);view.setFolder('inbox');view.setUnified(false);}})),
  ...([['dark','Dark theme',Moon],['light','Light theme',Sun],['system','Follow system theme',Monitor]]as const).map(([theme,label,icon])=>({id:'theme.'+theme,label,group:'Appearance',icon,run:()=>setTheme(theme)})),
  ...(path==='/inbox'?[...registry.current].flatMap(get=>get()):[]),
 ];
 const show=()=>{if(!auth.user||auth.accountBusy)return;previousFocus.current=document.activeElement as HTMLElement;setSnapshot(commands());setQuery('');setActive(0);setOpen(true);};
 const showRef=useRef(show);useLayoutEffect(()=>{showRef.current=show;});
 const register=useCallback((get:()=>MailCommand[])=>{registry.current.add(get);return()=>{registry.current.delete(get);};},[]);
 const context=useMemo(()=>({register,open:()=>showRef.current()}),[register]);
 useEffect(()=>{
  const key=(event:KeyboardEvent)=>{
   if(event.defaultPrevented||!shortcuts||!auth.user||auth.accountBusy||!(event.ctrlKey||event.metaKey)||event.altKey||event.shiftKey)return;
   const target=event.target instanceof HTMLElement?event.target:document.body;
   if(target.closest('[contenteditable="true"],textarea,[role="dialog"]')||document.querySelector('[role="dialog"][aria-modal="true"]'))return;
   if(event.key.toLowerCase()==='k'){event.preventDefault();showRef.current();}
   if(event.key.toLowerCase()==='s'){event.preventDefault();void search().catch(error=>toast.error(String(error)));}
  };window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
 });
 useEffect(()=>{if(!open)return;input.current?.focus();return()=>{if(previousFocus.current?.isConnected)previousFocus.current.focus();};},[open]);
 const options=useMemo(()=>rankCommands(snapshot,query),[snapshot,query]);const results=query.trim()&&!query.startsWith('>')?[...options,{id:'search.query',label:`Search mail for “${query.trim()}”`,group:'Search',icon:Search,run:()=>search(query.trim())}]:options;
 const index=Math.min(active,Math.max(0,results.length-1));const current=results[index];
 useEffect(()=>{if(open)document.getElementById('command-option-'+index)?.scrollIntoView?.({block:'nearest'});},[index,open]);
 const run=(command:MailCommand)=>{setOpen(false);const fresh=command.id==='search.query'?command:commands().find(item=>item.id===command.id);if(!fresh){toast.info('That command is no longer available.');return;}void Promise.resolve().then(()=>fresh.run()).catch(error=>toast.error('Could not run command',{description:String(error)}));};
 return <Context.Provider value={context}>{children}{mounted&&createPortal(<AnimatePresence>{open&&<motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} transition={{duration:reduced?0:0.13}} className="fixed inset-0 z-[200] flex items-start justify-center bg-black/35 px-4 pt-[min(16vh,120px)] backdrop-blur-sm" onMouseDown={event=>{if(event.target===event.currentTarget)setOpen(false);}}>
  <motion.div ref={dialog} role="dialog" aria-modal="true" aria-label="Command palette" initial={{opacity:0,y:reduced?0:-8,scale:reduced?1:0.98}} animate={{opacity:1,y:0,scale:1}} transition={{duration:reduced?0:0.16}} className="w-full max-w-[620px] overflow-hidden rounded-2xl border border-border/80 bg-background/95 shadow-2xl backdrop-blur-2xl" onKeyDown={event=>{event.stopPropagation();if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();setOpen(false);}if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();setOpen(false);void search().catch(error=>toast.error(String(error)));}if(event.key==='Escape'){event.preventDefault();setOpen(false);}if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();setActive((index+(event.key==='ArrowDown'?1:-1)+results.length)%Math.max(1,results.length));}if(event.key==='Enter'&&current){event.preventDefault();run(current);}if(event.key==='Tab'){event.preventDefault();input.current?.focus();}}}>
   <div className="flex items-center gap-3 border-b border-border/60 px-4 py-4"><Command aria-hidden="true" className="size-4 shrink-0 text-primary"/><input ref={input} role="combobox" aria-label="Search commands or mail" aria-expanded="true" aria-autocomplete="list" aria-controls="command-results" aria-activedescendant={current?'command-option-'+index:undefined} maxLength={2048} value={query} onChange={event=>{setQuery(event.target.value);setActive(0);}} placeholder="Search mail, commands, accounts…" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"/><button type="button" onClick={()=>setOpen(false)} aria-label="Close command palette" className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"><X className="size-4"/></button></div>
   <div id="command-results" role="listbox" aria-label="Available commands" className="custom-scrollbar max-h-[min(52vh,420px)] overflow-y-auto overscroll-contain p-2">{results.length?results.map((command,i)=><div key={command.id}>{(i===0||results[i-1].group!==command.group)&&<p className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{command.group}</p>}<button id={'command-option-'+i} role="option" aria-selected={i===index} tabIndex={-1} type="button" onPointerMove={()=>setActive(i)} onClick={()=>run(command)} className={cn('flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13px] transition-colors',i===index?'bg-primary/10 text-primary':'text-foreground/85 hover:bg-foreground/5')}><command.icon aria-hidden="true" className="size-4 shrink-0"/><span className="min-w-0 flex-1 truncate">{command.label}</span>{command.shortcut&&<kbd className="text-[10px] text-muted-foreground">{command.shortcut}</kbd>}<ChevronRight aria-hidden="true" className={cn('size-3.5 shrink-0',i===index?'opacity-70':'opacity-0')}/></button></div>):<p className="px-4 py-8 text-center text-sm text-muted-foreground">No matching commands. Type a mail search or try “Inbox”.</p>}</div>
   <div className="flex items-center justify-between gap-3 border-t border-border/60 px-4 py-3 text-[10px] text-muted-foreground"><span className="flex items-center gap-2"><Keyboard className="size-3.5"/>↑↓ navigate · Enter run · Esc close</span><span className="hidden sm:inline">Type &gt; for commands only</span></div>
  </motion.div></motion.div>}</AnimatePresence>,document.body)}</Context.Provider>;
}
