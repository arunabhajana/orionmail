"use client";
import React, { useId } from "react";
export function SettingGroup({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
    return <section className="settings-group"><div className="px-5 pt-5 pb-2"><h2 className="text-[13px] font-semibold tracking-wide">{title}</h2>{description && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>}</div><div className="divide-y divide-black/[0.05] dark:divide-white/[0.06]">{children}</div></section>;
}
export function SettingRow({ id, title, description, children, unavailable = false }: { id: string; title: string; description: string; children?: React.ReactNode; unavailable?: boolean }) {
    return <div data-setting-id={id} className="setting-row flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-4 rounded-xl scroll-mt-8"><div className="min-w-0 flex-1 basis-48"><h3 className="text-sm font-medium">{title}</h3><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p></div>{unavailable ? <span className="rounded-full border border-black/10 dark:border-white/10 px-2.5 py-1 text-[10px] text-muted-foreground">Not available yet</span> : children}</div>;
}
export function SettingToggle({ label, checked, onChange, disabled = false }: { label: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) {
    return <button type="button" role="switch" aria-label={label} aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)} className={`relative h-6 w-10 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-40 disabled:cursor-not-allowed ${checked ? "bg-primary" : "bg-black/15 dark:bg-white/20"}`}><span className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow-sm transition-transform ${checked ? "translate-x-4" : "translate-x-0"}`} /></button>;
}
export function SettingSelect({ label, value, options, onChange, disabled = false }: { label: string; value: string; options: readonly (readonly [string, string])[]; onChange: (value: string) => void; disabled?: boolean }) {
    const id = useId();
    return <select id={id} aria-label={label} value={value} onChange={event => onChange(event.target.value)} disabled={disabled} className="settings-input w-auto max-w-full min-w-32 text-xs disabled:opacity-40">{options.map(([key, title]) => <option key={key} value={key}>{title}</option>)}</select>;
}
export const settingButton = "inline-flex items-center justify-center gap-2 rounded-xl border border-black/[0.08] dark:border-white/10 bg-white/40 dark:bg-white/5 px-3.5 py-2 text-xs font-medium hover:bg-white/80 dark:hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
