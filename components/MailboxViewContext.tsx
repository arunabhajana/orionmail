"use client";
import {createContext,useCallback,useContext,useEffect,useEffectEvent,useState,type ReactNode} from 'react';
import {useAuth} from './AuthContext';
export type MailboxNavigation={owner:string;folder:string;token:string;ready:boolean};
type View={unified:boolean;setUnified:(value:boolean)=>void;folder:string;setFolder:(folder:string)=>void;navigation:MailboxNavigation|null;requestNavigation:(owner:string,folder?:string)=>string|null;authorizeNavigation:(token:string)=>void;completeNavigation:(token:string)=>void};
const Context=createContext<View>({unified:false,setUnified:()=>{},folder:'',setFolder:()=>{},navigation:null,requestNavigation:()=>null,authorizeNavigation:()=>{},completeNavigation:()=>{}});
export function MailboxViewProvider({children}:{children:ReactNode}){
 const {user}=useAuth();const [unified,setUnified]=useState(false);const [folder,setFolder]=useState('');const [navigation,setNavigation]=useState<MailboxNavigation|null>(null);
 const requestNavigation=useCallback((owner:string,folder?:string)=>{const token=folder?crypto.randomUUID():null;setNavigation(token&&folder?{owner,folder,token,ready:false}:null);return token;},[]);
 const authorizeNavigation=useCallback((token:string)=>setNavigation(previous=>previous?.token===token?{...previous,ready:true}:previous),[]);
 const completeNavigation=useCallback((token:string)=>setNavigation(previous=>previous?.token===token?null:previous),[]);
 if(!user){if(unified)setUnified(false);if(folder)setFolder('');if(navigation)setNavigation(null);}
 return <Context.Provider value={{unified,setUnified,folder,setFolder,navigation,requestNavigation,authorizeNavigation,completeNavigation}}>{children}</Context.Provider>;
}
export const useMailboxView=()=>useContext(Context);
export function useMailboxNavigation(onNavigate:(folder:string)=>void){
 const view=useMailboxView();const {user,accountEpoch,isAccountCurrent}=useAuth();
 const apply=useEffectEvent((navigation:MailboxNavigation)=>{onNavigate(navigation.folder);view.completeNavigation(navigation.token);});
 useEffect(()=>{const navigation=view.navigation;if(!navigation?.ready||view.unified||navigation.owner!==user?.id)return;
  let active=true;queueMicrotask(()=>{if(active&&isAccountCurrent(navigation.owner,accountEpoch))apply(navigation);});return()=>{active=false;};
 },[view.navigation,view.unified,user?.id,accountEpoch,isAccountCurrent]);
}
