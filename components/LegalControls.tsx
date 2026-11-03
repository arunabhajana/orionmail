"use client";
import Link from 'next/link';
import {X,ArrowLeft} from 'lucide-react';
export function LegalClose(){return <Link href="/settings" aria-label="Close document and return to Settings" className="absolute right-2 top-2 inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><X size={16}/></Link>;}
export function LegalBack(){return <Link href="/settings" className="inline-flex items-center gap-2 rounded-xl border border-border bg-foreground/[0.03] px-4 py-2.5 text-xs font-medium transition-colors hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><ArrowLeft size={14}/>Back to Settings</Link>;}
