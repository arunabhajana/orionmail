"use client";

import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowRight, Check, CheckCheck, LoaderCircle, Sparkles, X } from 'lucide-react';
import { currentRelease } from '@/lib/generated/releases';
import type { Release } from '@/lib/release-types';
import { SettingGroup, SettingRow, settingButton } from './SettingsControls';
import { WhatsNewModal } from './ReleaseNotes';

// Presentation-only content: never change the installed version or release files.
const [major, minor, patch] = currentRelease.version.split('.').map(Number);
const demoRelease: Release = { ...currentRelease, version: `${major}.${minor}.${patch + 1}`, status: 'draft', sample: true, date: null };
const primaryButton = settingButton + ' !border-primary !bg-primary !text-white hover:!bg-primary/90';

export function UpdatePreviewModal({ onClose, onHighlights }: { onClose: () => void; onHighlights: () => void }) {
    const dialog = useRef<HTMLDialogElement>(null);
    const [progress, setProgress] = useState<number | null>(null);
    const complete = progress === 100;
    const updating = progress !== null && !complete;
    const stage = progress === null || progress < 70 ? 0 : progress < 94 ? 1 : 2;
    const stages = ['Downloading update', 'Preparing installation', 'Finishing up'];

    useEffect(() => {
        const element = dialog.current;
        const previous = document.activeElement as HTMLElement | null;
        element?.showModal();
        return () => { element?.close(); if (previous?.isConnected) previous.focus(); };
    }, []);

    useEffect(() => {
        if (!updating) return;
        const timer = window.setInterval(() => setProgress(value => Math.min(100, (value ?? 0) + 2)), 120);
        return () => window.clearInterval(timer);
    }, [updating]);

    const title = complete ? 'You’re all set' : updating ? 'A little refresh is on its way' : 'An update is ready';
    return <dialog ref={dialog} aria-labelledby="update-preview-title" aria-describedby="update-preview-description"
        onCancel={event => { event.preventDefault(); onClose(); }} onKeyDown={event => event.stopPropagation()}
        className="settings-dialog-enter m-auto max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] max-w-[460px] overflow-y-auto rounded-3xl border border-white/70 bg-white/95 p-0 text-foreground shadow-2xl backdrop-blur-2xl backdrop:bg-black/45 backdrop:backdrop-blur-md dark:border-white/15 dark:bg-[#191c24]/95">
        <header className="flex items-center justify-between gap-3 px-6 pt-5">
            <span className="rounded-full border border-primary/15 bg-primary/[0.07] px-2.5 py-1 text-[10px] font-medium text-primary">Update preview · Demo</span>
            <button type="button" autoFocus aria-label="Close update preview" onClick={onClose} className={settingButton + ' !rounded-full !p-2'}><X size={16} /></button>
        </header>
        <div className="px-6 pb-6 pt-4 sm:px-7">
            <div className="mb-5 flex size-12 items-center justify-center rounded-2xl border border-primary/15 bg-primary/10 text-primary">
                {complete ? <CheckCheck size={24} /> : updating ? <LoaderCircle size={24} className="animate-spin motion-reduce:animate-none" /> : <ArrowDownToLine size={24} />}
            </div>
            <h2 id="update-preview-title" className="text-[23px] font-semibold leading-tight tracking-tight">{title}</h2>
            <p id="update-preview-description" className="mt-2 text-xs leading-relaxed text-muted-foreground">{complete ? 'The demo is complete. Your installed app and mailbox are unchanged.' : updating ? 'Just a moment. You can cancel this preview at any time.' : 'A fresh OrionMail experience, with a few more thoughtful touches.'}</p>
            <div className="mt-5 min-h-[176px]">
                {progress === null ? <div className="settings-section-enter">
                    <div className="flex items-center justify-between gap-3 rounded-xl border border-black/[0.06] bg-black/[0.025] px-4 py-3 text-xs dark:border-white/[0.07] dark:bg-white/[0.025]">
                        <span className="text-muted-foreground">{currentRelease.version} <ArrowRight aria-hidden="true" size={12} className="mx-2 inline" /><strong className="font-medium text-foreground">{demoRelease.version}</strong></span><span className="text-[10px] text-primary">Demo release</span>
                    </div>
                    <p className="mb-2 mt-4 text-[11px] font-medium">A look at what’s new</p>
                    <ul className="space-y-2">{demoRelease.whatsNew.slice(0, 2).map(slide => <li key={slide.id} className="flex items-start gap-2 text-xs text-muted-foreground"><Sparkles aria-hidden="true" size={13} className="mt-0.5 shrink-0 text-primary" />{slide.title}</li>)}</ul>
                </div> : complete ? <div className="settings-section-enter rounded-2xl border border-primary/15 bg-primary/[0.05] p-4">
                    <p className="flex items-center gap-2 text-sm font-medium"><Check size={16} className="text-primary" />Preview complete</p>
                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">Take a quick tour of the sample release, or head back to Settings.</p>
                    <p className="mt-4 text-[11px] text-muted-foreground">No restart needed for this demo.</p>
                </div> : <div className="settings-section-enter">
                    <div role="status" aria-live="polite" className="mb-3 flex items-center justify-between gap-3 text-xs"><span className="font-medium">{stages[stage]}</span><span aria-hidden="true" className="tabular-nums text-muted-foreground">{progress}%</span></div>
                    <div role="progressbar" aria-label="Demo update progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-valuetext={`${progress}% — ${stages[stage]}`} className="h-1.5 overflow-hidden rounded-full bg-primary/10">
                        <div className="h-full rounded-full bg-primary transition-[width] duration-150 ease-linear motion-reduce:transition-none" style={{ width: `${progress}%` }} />
                    </div>
                    <ol className="mt-5 space-y-3">{stages.map((label, index) => <li key={label} aria-current={stage === index ? 'step' : undefined} className={'flex items-center gap-2.5 text-xs ' + (stage >= index ? 'text-foreground' : 'text-muted-foreground/60')}>
                        <span className={'flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] ' + (stage >= index ? 'bg-primary/10 text-primary' : 'bg-black/5 dark:bg-white/5')}>{stage > index ? <Check size={12} /> : index + 1}</span>{label}
                    </li>)}</ol>
                </div>}
            </div>
            <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">This is a simulation. Nothing is downloaded or installed.</p>
        </div>
        <footer className="flex items-center justify-end gap-2 border-t border-black/[0.06] px-6 py-4 dark:border-white/[0.07]">
            <button type="button" onClick={onClose} className={settingButton}>{complete ? 'Back to Settings' : updating ? 'Cancel preview' : 'Later'}</button>
            {!updating && <button type="button" onClick={complete ? onHighlights : () => setProgress(0)} className={primaryButton}>{complete ? 'See what’s new' : 'Update now'}{complete ? <ArrowRight size={14} /> : <ArrowDownToLine size={14} />}</button>}
        </footer>
    </dialog>;
}

export function UpdatePreviewCard() {
    const [view, setView] = useState<'update' | 'highlights' | null>(null);
    return <>
        <SettingGroup title="App updates">
            <SettingRow id="about.updates" title="Try the update experience" description="Preview an available update, its progress, and the finish screen.">
                <button type="button" onClick={() => setView('update')} className={settingButton}><ArrowDownToLine size={14} />Preview update</button>
            </SettingRow>
        </SettingGroup>
        {view === 'update' && <UpdatePreviewModal onClose={() => setView(null)} onHighlights={() => setView('highlights')} />}
        {view === 'highlights' && <WhatsNewModal release={demoRelease} onClose={() => setView(null)} />}
    </>;
}
