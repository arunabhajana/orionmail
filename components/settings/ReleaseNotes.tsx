"use client";
import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { ArrowLeft, ArrowRight, ChevronDown, X } from 'lucide-react';
import type { Release } from '@/lib/release-types';
import { currentRelease, releases } from '@/lib/generated/releases';
import { settingButton } from './SettingsControls';

/** Mounted explicitly today; an updater can open the same component later. */
export function WhatsNewModal({ onClose, release = currentRelease }: { onClose: () => void; release?: Release }) {
    const dialog = useRef<HTMLDialogElement>(null);
    const [page, setPage] = useState(0);
    const slides = release.whatsNew;
    const slide = slides[page];
    useEffect(() => {
        const element = dialog.current;
        const previous = document.activeElement as HTMLElement | null;
        element?.showModal();
        return () => { element?.close(); if (previous?.isConnected) previous.focus(); };
    }, []);
    return <dialog ref={dialog} aria-labelledby="whats-new-title" aria-describedby="whats-new-description" onCancel={event => { event.preventDefault(); onClose(); }} onKeyDown={event => {
        event.stopPropagation();
        if (event.key === 'ArrowRight') { event.preventDefault(); setPage(value => Math.min(value + 1, slides.length - 1)); }
        if (event.key === 'ArrowLeft') { event.preventDefault(); setPage(value => Math.max(value - 1, 0)); }
    }} className="m-auto max-h-[calc(100dvh_-_3rem)] w-[calc(100%_-_2rem)] max-w-[540px] overflow-y-auto rounded-3xl border border-white/70 bg-white/90 p-0 text-foreground shadow-2xl backdrop-blur-2xl backdrop:bg-black/45 backdrop:backdrop-blur-md dark:border-white/15 dark:bg-[#191c24]/90">
        <header className="flex items-center justify-between gap-3 px-6 pb-4 pt-5"><div><p className="text-sm font-semibold">What’s new in OrionMail</p><p className="mt-1 text-[11px] text-muted-foreground">Version {release.version}{release.status === 'draft' ? ' · Draft preview' : ''}</p></div><button type="button" autoFocus onClick={onClose} aria-label="Close What’s new" className={settingButton + ' !rounded-full !p-2'}><X size={16} /></button></header>
        <div className="px-6">
            <div className="relative h-56 overflow-hidden rounded-2xl border border-black/[0.05] bg-primary/[0.04] dark:border-white/[0.06] sm:h-64"><Image key={slide.id} src={slide.image.src} alt={slide.image.alt} fill unoptimized sizes="(max-width: 540px) 90vw, 492px" className="object-contain" /></div>
            <div className="min-h-44 pb-5 pt-6" aria-live="polite" aria-atomic="true"><p className="text-[11px] font-medium text-primary">{slide.eyebrow}</p><h2 id="whats-new-title" className="mt-2 text-2xl font-semibold tracking-tight">{slide.title}</h2><p id="whats-new-description" className="mt-3 text-sm leading-relaxed text-muted-foreground">{slide.text}</p></div>
        </div>
        <footer className="flex items-center justify-between gap-4 border-t border-black/[0.06] px-6 py-5 dark:border-white/[0.07]">
            <div className="flex items-center gap-1" role="group" aria-label="Feature slides">{slides.map((item, index) => <button key={item.id} type="button" onClick={() => setPage(index)} aria-label={`Slide ${index + 1}: ${item.title}`} aria-current={index === page ? 'step' : undefined} className="flex size-7 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><span className={'h-1.5 rounded-full transition-[width,background-color] motion-reduce:transition-none ' + (index === page ? 'w-5 bg-primary' : 'w-1.5 bg-black/20 dark:bg-white/25')} /></button>)}</div>
            <div className="flex gap-2"><button type="button" onClick={() => setPage(value => Math.max(0, value - 1))} disabled={page === 0} aria-label="Previous feature" className={settingButton + ' !p-2.5'}><ArrowLeft size={15} /></button><button type="button" onClick={() => page === slides.length - 1 ? onClose() : setPage(value => value + 1)} className={settingButton + ' !border-primary !bg-primary !text-white hover:!bg-primary/90'}>{page === slides.length - 1 ? 'Done' : 'Next'}{page < slides.length - 1 && <ArrowRight size={14} />}</button></div>
        </footer>
    </dialog>;
}
function ReleaseEntry({ release }: { release: Release }) {
    return <article className="p-5 sm:p-6" aria-label={`Version ${release.version} release notes`}>
        <div className="flex flex-wrap items-center gap-2"><h3 className="text-lg font-semibold tracking-tight">{release.title}</h3><span className="rounded-full border border-primary/15 bg-primary/[0.07] px-2 py-1 text-[10px] font-medium text-primary">{release.status === 'draft' ? release.sample ? 'Sample · Draft' : 'Draft' : release.status === 'ready' ? 'Release candidate' : 'Released'}</span></div>
        <p className="mt-2 text-xs text-muted-foreground">Version {release.version}{release.date ? ` · ${release.date}` : ' · Not published yet'}</p><p className="mt-3 text-xs leading-relaxed text-muted-foreground">{release.summary}</p>
        <div className="mt-6 space-y-6">{release.sections.map(section => <section key={section.category} aria-label={section.category}><h4 className="mb-3 text-xs font-semibold">{section.category}</h4><ul className="space-y-3 border-l border-black/[0.06] pl-4 dark:border-white/[0.08]">{section.items.map(item => <li key={item.title}><p className="text-xs font-medium">{item.title}</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.text}</p></li>)}</ul></section>)}</div>
    </article>;
}
export function ReleaseNotesPanel({installedVersion=currentRelease.version}:{installedVersion?:string}) {
    const installedRelease=releases.find(release=>release.version===installedVersion);
    return <details data-setting-id="about.changelog" className="settings-group group/release-notes overflow-hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-[19px] p-5 transition-colors hover:bg-primary/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary [&::-webkit-details-marker]:hidden">
            <div><h2 className="text-sm font-semibold">Release notes</h2><p className="mt-1 text-xs text-muted-foreground">Version {installedVersion} · Changes, improvements, and fixes.</p></div>
            <ChevronDown aria-hidden="true" size={17} className="shrink-0 text-muted-foreground transition-transform duration-150 group-open/release-notes:rotate-180 motion-reduce:transition-none" />
        </summary>
        <div className="border-t border-black/[0.05] dark:border-white/[0.06]">
            {installedRelease?<ReleaseEntry release={installedRelease}/>:<p className="p-5 text-sm text-muted-foreground">Release notes for this installed version are not bundled.</p>}
            {releases.filter(release => release.version !== installedVersion).map(release => <details key={release.version} className="border-t border-black/5 dark:border-white/10"><summary className="cursor-pointer px-5 py-4 text-xs font-medium">Version {release.version} · {release.title}</summary><ReleaseEntry release={release} /></details>)}
        </div>
    </details>;
}
