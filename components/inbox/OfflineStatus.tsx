"use client";
import {WifiOff} from 'lucide-react';
import {useNetworkStatus} from '@/hooks/useNetworkStatus';
export function OfflineStatus(){
 const online=useNetworkStatus();
 return online?null:<div role="status" className="flex gap-2.5 border-b border-border/60 bg-primary/[0.04] px-4 py-3"><WifiOff aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"/><div><p className="text-xs font-medium">You’re offline</p><p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">Downloaded mail is available. Outgoing messages and pending changes stay saved on this device.</p></div></div>;
}
