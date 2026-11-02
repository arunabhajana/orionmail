"use client";
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Bell, Check, ChevronDown, Copy, GitBranch, Sparkles, X } from 'lucide-react';
import packageInfo from '@/package.json';
import { settingButton } from './SettingsControls';

const slides = [
    { kind: 'threads', category: 'A clearer conversation', title: 'Every reply, in its place.', text: 'Follow a conversation in one tidy view. Open individual replies, keep quoted history tucked away, and act on the message you choose.' },
    { kind: 'actions', category: 'Less copying. More doing.', title: 'Useful details, ready to go.', text: 'Find verification codes, meeting links, and delivery details in Smart Actions cards, right above your message.' },
    { kind: 'focus', category: 'Your inbox, at your pace', title: 'Make room for focus.', text: 'Choose which folders can notify you, pick a sound, or schedule quiet hours. Your mail keeps syncing while alerts take a break.' },
] as const;

type Kind = typeof slides[number]['kind'];
function ReleaseArtwork({ kind }: { kind: Kind }) {
    return <div role="img" aria-label={kind === 'threads' ? 'Illustration of three replies in a connected conversation' : kind === 'actions' ? 'Illustration of a Smart Actions verification code card' : 'Illustration of scheduled quiet hours'} className="relative flex h-56 items-center justify-center overflow-hidden rounded-2xl border border-black/[0.05] bg-gradient-to-br from-primary/[0.09] via-white/40 to-violet-400/10 p-5 dark:border-white/[0.06] dark:via-white/[0.02] sm:h-64">
        <div aria-hidden="true" className="pointer-events-none absolute size-44 rounded-full bg-primary/10 blur-3xl" />
        <div aria-hidden="true" className="relative w-full max-w-[310px] rounded-2xl border border-white/80 bg-white/75 p-4 shadow-xl shadow-black/[0.05] backdrop-blur-xl dark:border-white/10 dark:bg-[#20232c]/80">
            <div className="mb-4 flex gap-1.5">{[0,1,2].map(n => <span key={n} className="size-1.5 rounded-full bg-black/15 dark:bg-white/20" />)}</div>
            {kind === 'threads' ? <div className="space-y-2 border-l border-primary/25 pl-3"><p className="mb-3 flex items-center gap-2 text-[11px] font-medium text-muted-foreground"><GitBranch size={13} />A little catch-up · 3 messages</p>{['Sounds like a plan.', 'I’ve shared the details.', 'See you there!'].map((text, index) => <div key={text} className={'flex items-center gap-2 rounded-lg border p-2.5 text-[11px] ' + (index === 2 ? 'border-primary/30 bg-primary/[0.08]' : 'border-black/5 bg-white/50 dark:border-white/5 dark:bg-white/[0.025]')}><span className="flex size-5 shrink-0 items-center justify-center rounded bg-primary/10 text-[10px] text-primary">{index+1}</span><span className="flex-1">{text}</span><ChevronDown size={12} className="text-muted-foreground" /></div>)}</div>
            : kind === 'actions' ? <><div className="mb-3 flex items-center gap-2 text-xs font-medium"><Sparkles size={14} className="text-primary" />Smart Actions</div><div className="rounded-xl border border-primary/20 bg-primary/[0.06] p-4"><p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Verification code</p><div className="mt-2 flex items-center justify-between"><span className="text-2xl font-semibold tracking-[.18em]">482 916</span><span className="rounded-lg bg-primary/10 p-2 text-primary"><Copy size={15} /></span></div></div><div className="mt-4 h-1.5 w-3/4 rounded-full bg-black/5 dark:bg-white/10" /><div className="mt-2 h-1.5 w-1/2 rounded-full bg-black/5 dark:bg-white/10" /></>
            : <><div className="flex items-center gap-3"><span className="rounded-xl bg-primary/10 p-3 text-primary"><Bell size={20} /></span><div><p className="text-xs font-semibold">A quieter evening</p><p className="mt-1 text-[10px] text-muted-foreground">Scheduled quiet hours</p></div><span className="ml-auto rounded-full bg-primary p-1 text-white"><Check size={12} /></span></div><div className="mt-5 flex items-center justify-between rounded-xl border border-black/5 bg-black/[0.02] p-4 dark:border-white/5 dark:bg-white/[0.025]"><div><p className="text-[10px] text-muted-foreground">From</p><p className="mt-1 text-xl font-medium tabular-nums">22:00</p></div><ArrowRight size={16} className="text-muted-foreground" /><div><p className="text-[10px] text-muted-foreground">Until</p><p className="mt-1 text-xl font-medium tabular-nums">08:00</p></div></div><p className="mt-3 text-center text-[10px] text-muted-foreground">Mail keeps syncing. You keep unwinding.</p></>}
        </div>
    </div>;
}

/** Preview-only today; the updater can mount this after a successful update later. */
export function WhatsNewModal({ onClose }: { onClose: () => void }) {
    const dialog = useRef<HTMLDialogElement>(null);
    const [page, setPage] = useState(0);
    const slide = slides[page];
    useEffect(() => {
        const element = dialog.current;
        const previous = document.activeElement as HTMLElement | null;
        element?.showModal();
        return () => { element?.close(); if (previous?.isConnected) previous.focus(); };
    }, []);
    return <dialog ref={dialog} aria-labelledby="whats-new-title" aria-describedby="whats-new-description" onCancel={event => { event.preventDefault(); onClose(); }} onKeyDown={event => { event.stopPropagation(); if (event.key === 'ArrowRight') { event.preventDefault(); setPage(value => Math.min(value+1, slides.length-1)); } if (event.key === 'ArrowLeft') { event.preventDefault(); setPage(value => Math.max(value-1,0)); } }}
        className="m-auto max-h-[calc(100dvh_-_3rem)] w-[calc(100%_-_2rem)] max-w-[540px] overflow-y-auto rounded-3xl border border-white/70 bg-white/90 p-0 text-foreground shadow-2xl backdrop-blur-2xl backdrop:bg-black/45 backdrop:backdrop-blur-md dark:border-white/15 dark:bg-[#191c24]/90">
        <div className="flex items-center justify-between gap-3 px-6 pb-4 pt-5"><div><p className="text-sm font-semibold">What’s new in OrionMail</p><p className="mt-1 text-[11px] text-muted-foreground">Version {packageInfo.version} · Design preview</p></div><button type="button" autoFocus onClick={onClose} aria-label="Close What’s new" className={settingButton + ' !rounded-full !p-2'}><X size={16} /></button></div>
        <div className="px-6"><ReleaseArtwork kind={slide.kind} /><div className="min-h-44 pb-5 pt-6" aria-live="polite" aria-atomic="true"><p className="text-[11px] font-medium text-primary">{slide.category}</p><h2 id="whats-new-title" className="mt-2 text-2xl font-semibold tracking-tight">{slide.title}</h2><p id="whats-new-description" className="mt-3 text-sm leading-relaxed text-muted-foreground">{slide.text}</p></div></div>
        <div className="flex items-center justify-between gap-4 border-t border-black/[0.06] px-6 py-5 dark:border-white/[0.07]"><div className="flex items-center gap-1" role="group" aria-label="Feature slides">{slides.map((item,index) => <button key={item.kind} type="button" onClick={() => setPage(index)} aria-label={'Slide ' + (index+1) + ': ' + item.title} aria-current={index === page ? 'step' : undefined} className="flex size-7 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><span className={'h-1.5 rounded-full transition-[width,background-color] motion-reduce:transition-none ' + (index === page ? 'w-5 bg-primary' : 'w-1.5 bg-black/20 dark:bg-white/25')} /></button>)}</div><div className="flex gap-2"><button type="button" onClick={() => setPage(value => value-1)} disabled={page === 0} aria-label="Previous feature" className={settingButton + ' !p-2.5'}><ArrowLeft size={15} /></button><button type="button" onClick={() => page === slides.length-1 ? onClose() : setPage(value => value+1)} className={settingButton + ' !border-primary !bg-primary !text-white hover:!bg-primary/90'}>{page === slides.length-1 ? 'Done' : 'Next'}{page < slides.length-1 && <ArrowRight size={14} />}</button></div></div>
    </dialog>;
}

export function ReleaseNotesPanel() {
    const [preview, setPreview] = useState(false);
    return <section data-setting-id="about.changelog" className="settings-group overflow-hidden">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-black/[0.05] bg-primary/[0.025] p-5 dark:border-white/[0.06]"><div><h2 className="text-sm font-semibold">Release notes</h2><p className="mt-1 text-xs text-muted-foreground">The little changes that make a better inbox.</p></div><button type="button" onClick={() => setPreview(true)} className={settingButton}><Sparkles size={14} />Preview What’s new</button></header>
        <div className="p-5 sm:p-6"><div className="flex flex-wrap items-center gap-2"><h3 className="text-lg font-semibold tracking-tight">A calmer everyday inbox</h3><span className="rounded-full border border-primary/15 bg-primary/[0.07] px-2 py-1 text-[10px] font-medium text-primary">Mock release</span></div><p className="mt-2 text-xs text-muted-foreground">Version {packageInfo.version} · Sample content, not published release notes.</p>
            <div className="mt-6 space-y-6">{[
                { title: 'New', icon: Sparkles, items: [['Conversations that stay together', 'Read linked replies as a clean conversation, with individual message controls.'], ['Notifications that fit your day', 'Choose alert folders, sounds, and a quiet-hours schedule.']] },
                { title: 'Improved', icon: ArrowRight, items: [['A more personal workspace', 'Theme previews, accent colors, and reading preferences in one place.'], ['Signatures within reach', 'Insert a signature from Compose or save your default in Settings.']] },
                { title: 'Fixed', icon: Check, items: [['Cleaner message presentation', 'Quoted reply history stays tucked away for easier reading.'], ['Clearer sign-in feedback', 'Understand browser sign-in status and return to OrionMail.']] },
            ].map(group => <div key={group.title}><h4 className="mb-3 flex items-center gap-2 text-xs font-semibold"><span className="flex size-6 items-center justify-center rounded-lg bg-primary/[0.08] text-primary"><group.icon size={12} /></span>{group.title}</h4><ul className="space-y-3 border-l border-black/[0.06] pl-4 dark:border-white/[0.08]">{group.items.map(([title,text]) => <li key={title}><p className="text-xs font-medium">{title}</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{text}</p></li>)}</ul></div>)}</div>
        </div>{preview && <WhatsNewModal onClose={() => setPreview(false)} />}
    </section>;
}
