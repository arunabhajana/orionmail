"use client";

import React, { useSyncExternalStore } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useTheme } from 'next-themes';
import {useAppPreferences} from '../AppPreferencesContext';
import {toast} from 'sonner';
import { colorMap, useAccentColor } from '@/components/AccentColorProvider';


function LayoutPreview({mode}:{mode:'right'|'bottom'|'minimal'}) {
    const list=mode==='minimal'?{x:86,y:48,w:116,h:104}:mode==='bottom'?{x:86,y:48,w:116,h:44}:{x:86,y:48,w:46,h:104};
    const reader=mode==='bottom'?{x:86,y:98,w:116,h:54}:{x:138,y:48,w:64,h:104};
    return <svg aria-hidden="true" viewBox="0 0 220 165" className="absolute inset-0 h-full w-full">
        <rect width="220" height="165" className="fill-[#c9c9c9] dark:fill-[#171717]"/>
        <rect x="18" y="28" width="204" height="146" rx="12" className="fill-[#fafafa] stroke-white dark:fill-[#111111] dark:stroke-[#383838]" strokeWidth="2"/>
        <path d="M30 29h48v136H19V40q0-11 11-11" className="fill-[#eee] dark:fill-[#202020]"/>
        {[29,36,43].map(x=><circle key={x} cx={x} cy="38" r="1.7" className="fill-black/25 dark:fill-white/25"/>)}
        <rect x="27" y="53" width="42" height="10" rx="4" className="fill-primary/25"/>
        {[75,87,99,111].map((y,i)=><rect key={y} x="28" y={y} width={i%2?23:32} height="4" rx="2" className="fill-black/20 dark:fill-white/20"/>)}
        <rect {...list} rx="5" className="fill-black/[0.025] dark:fill-white/[0.025]"/>
        {[0,1,2].map(i=><g key={i}><rect x={list.x+4} y={list.y+5+i*(mode==='bottom'?12:29)} width={list.w-8} height={mode==='bottom'?9:23} rx="3" className={i===0?'fill-primary/20':'fill-black/5 dark:fill-white/5'}/><rect x={list.x+8} y={list.y+9+i*(mode==='bottom'?12:29)} width={(list.w-16)*.65} height="3" rx="1.5" className="fill-black/25 dark:fill-white/25"/></g>)}
        {mode!=='minimal'&&<g><rect {...reader} rx="5" className="fill-primary/[0.07]"/><rect x={reader.x+6} y={reader.y+8} width={reader.w-18} height="5" rx="2" className="fill-black/30 dark:fill-white/30"/>{[0,1,2].map(i=><rect key={i} x={reader.x+6} y={reader.y+23+i*7} width={reader.w-(i===2?25:12)} height="3" rx="1.5" className="fill-black/15 dark:fill-white/15"/>)}</g>}
    </svg>;
}

function ThemePreview({ mode }: { mode: 'light' | 'dark' | 'system' }) {
    const scene = (dark: boolean, split = false) => {
        const background = dark ? '#171717' : '#c9c9c9';
        const panel = dark ? '#111111' : '#fafafa';
        const sidebar = dark ? '#202020' : '#eeeeee';
        const line = dark ? '#545454' : '#d7d7d7';
        const block = dark ? '#303030' : '#eeeeee';
        return <svg key={dark ? 'dark' : 'light'} aria-hidden="true" viewBox="0 0 220 165" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full" style={split ? { clipPath: dark ? 'inset(0 50% 0 0)' : 'inset(0 0 0 50%)' } : undefined}>
            <rect width="220" height="165" fill={background} />
            <rect x="33" y="34" width="220" height="155" rx="12" fill={panel} stroke={dark ? '#383838' : '#ffffff'} strokeWidth="2" />
            <path d="M45 35h44v130H34V46q0-11 11-11" fill={sidebar} />
            {[43, 51, 59].map(x => <circle key={x} cx={x} cy="44" r="2" fill={line} />)}
            <rect x="42" y="61" width="23" height="4" rx="2" fill={line} />
            <rect x="42" y="70" width="33" height="4" rx="2" fill={line} />
            <rect x="42" y="79" width="26" height="4" rx="2" fill={line} />
            <rect x="42" y="88" width="14" height="4" rx="2" fill={line} />
            <rect x="105" y="61" width="24" height="4" rx="2" fill={line} />
            <rect x="105" y="72" width="49" height="4" rx="2" fill={line} />
            {[105, 153, 201].map(x => <rect key={x} x={x} y="91" width="40" height="33" rx="5" fill={block} />)}
            <rect x="105" y="140" width="27" height="4" rx="2" fill={line} />
            <circle cx="46" cy="143" r="6" fill={line} />
            <rect x="57" y="140" width="22" height="4" rx="2" fill={line} />
        </svg>;
    };
    return mode === 'system' ? <>{scene(true, true)}{scene(false, true)}</> : scene(mode === 'dark');
}

const subscribe = () => () => {};
export const AppearanceSection = () => {
    const {preferences,updatePreferences}=useAppPreferences();
    const { theme, resolvedTheme, setTheme } = useTheme();
    const { accentColor, setAccentColor } = useAccentColor();
    const mounted = useSyncExternalStore(subscribe, () => true, () => false);

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-8"
        >
            <div className="settings-group p-6" data-setting-id="appearance.layout">
                <h3 className="text-sm font-semibold">Mailbox layout</h3>
                <p className="mt-1 text-xs text-muted-foreground">Choose how your message list and reading pane share the window.</p>
                <div role="group" aria-label="Mailbox layout" className="mt-5 grid grid-cols-3 gap-3 sm:gap-4">
                    {([['right','Side by side','List and message together.'],['bottom','Stacked','Read below your list.'],['minimal','Minimal','Open messages in the full second pane.']] as const).map(([value,label,description])=><button key={value} type="button" aria-pressed={preferences.readingPane===value} onClick={()=>{void updatePreferences({readingPane:value}).catch(()=>toast.error('Could not save layout'));}} className="group min-w-0 rounded-2xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-4 focus-visible:ring-offset-background">
                        <div className={cn('relative aspect-[4/3] overflow-hidden rounded-2xl border border-black/10 transition-[box-shadow,border-color] duration-150 dark:border-white/10',preferences.readingPane===value?'ring-1 ring-foreground ring-offset-[3px] ring-offset-background':'group-hover:border-foreground/30')}><LayoutPreview mode={value}/></div><span className="mt-3 block text-sm font-medium">{label}</span><span className="mt-1 block text-[11px] leading-relaxed text-muted-foreground">{description}</span>
                    </button>)}
                </div>
            </div>
            {/* Theme Selection */}
            <div className="settings-group p-6">
                <h3 className="text-sm font-semibold">Interface theme</h3>
                <p className="mt-1 text-xs text-muted-foreground">Choose your look, or follow your system.</p>
                <div className="mt-5 grid grid-cols-3 gap-3 sm:gap-4" role="group" aria-label="Interface theme">
                    {([{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }, { value: 'system', label: 'System' }] as const).map(option => {
                        const selected = mounted && theme === option.value;
                        return <button key={option.value} type="button" data-setting-id={'appearance.' + option.value} aria-pressed={selected} onClick={() => setTheme(option.value)}
                            className="group min-w-0 rounded-2xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-4 focus-visible:ring-offset-background">
                            <div className={cn('relative aspect-[4/3] overflow-hidden rounded-2xl border border-black/10 transition-[box-shadow,border-color] duration-150 dark:border-white/10', selected ? 'ring-1 ring-foreground ring-offset-[3px] ring-offset-background' : 'group-hover:border-foreground/30')}>
                                <ThemePreview mode={option.value} />
                            </div>
                            <span className={cn('mt-3 block text-xs sm:text-sm', selected ? 'font-semibold text-foreground' : 'font-medium text-muted-foreground group-hover:text-foreground')}>{option.label}</span>
                        </button>;
                    })}
                </div>

                <div data-setting-id="appearance.accent" className="mt-9 border-t border-black/[0.06] pt-6 dark:border-white/[0.07]">
                    <h4 className="text-sm font-semibold">Accent color</h4>
                    <p className="mt-1 text-xs text-muted-foreground">A touch of color for buttons, highlights, and selections.</p>
                    <div className="mt-5 grid grid-cols-3 gap-3 sm:grid-cols-5 sm:gap-4" role="group" aria-label="Accent color">
                        {(['blue', 'purple', 'rose', 'emerald', 'orange'] as const).map(name => {
                            const selected = mounted && accentColor === name;
                            const hex = colorMap[name][mounted && resolvedTheme === 'dark' ? 'dark' : 'light'];
                            return <button key={name} type="button" aria-label={`${name} accent`} aria-pressed={selected} onClick={() => setAccentColor(name)}
                                className="group min-w-0 rounded-2xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-4 focus-visible:ring-offset-background">
                                <div className={cn('relative aspect-[4/3] overflow-hidden rounded-2xl border border-black/10 bg-[#f0f0f0] transition-[box-shadow,border-color] duration-150 dark:border-white/10 dark:bg-[#171717]', selected ? 'ring-1 ring-foreground ring-offset-[3px] ring-offset-background' : 'group-hover:border-foreground/30')} style={{ color: hex }}>
                                    <svg aria-hidden="true" viewBox="0 0 140 105" className="absolute inset-0 h-full w-full">
                                        <rect width="140" height="105" fill="currentColor" opacity=".055" />
                                        <rect x="19" y="20" width="140" height="100" rx="9" className="fill-white stroke-black/10 dark:fill-[#202020] dark:stroke-white/10" />
                                        <path d="M28 21h27v84H20V29q0-8 8-8" fill="currentColor" opacity=".08" />
                                        <rect x="26" y="36" width="22" height="8" rx="3" fill="currentColor" />
                                        <rect x="26" y="51" width="17" height="3" rx="1.5" fill="currentColor" opacity=".35" />
                                        <rect x="26" y="60" width="13" height="3" rx="1.5" className="fill-black/15 dark:fill-white/20" />
                                        <rect x="65" y="36" width="29" height="4" rx="2" className="fill-black/20 dark:fill-white/25" />
                                        <rect x="65" y="49" width="61" height="22" rx="5" fill="currentColor" opacity=".12" />
                                        <path d="m71 60 3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                        <rect x="86" y="58" width="30" height="3" rx="1.5" fill="currentColor" opacity=".7" />
                                        <rect x="65" y="81" width="37" height="12" rx="4" fill="currentColor" />
                                    </svg>
                                </div>
                                <span className={cn('mt-3 block text-xs capitalize sm:text-sm', selected ? 'font-semibold text-foreground' : 'font-medium text-muted-foreground group-hover:text-foreground')}>{name}</span>
                            </button>;
                        })}
                    </div>
                </div>
            </div>
        </motion.div>
    );
};
AppearanceSection.displayName = "AppearanceSection";
