"use client";
import {useEffect,useState} from 'react';
import {isTauri} from '@tauri-apps/api/core';
import {getVersion} from '@tauri-apps/api/app';
import packageInfo from '@/package.json';
export function useInstalledVersion(){
 const [version,setVersion]=useState(packageInfo.version);
 useEffect(()=>{let active=true;if(isTauri())void getVersion().then(value=>{if(active)setVersion(value);}).catch(()=>{});return()=>{active=false;};},[]);
 return version;
}
