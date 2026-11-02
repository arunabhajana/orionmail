"use client";
import { useState } from 'react';
import { X } from 'lucide-react';
import { useAppPreferences } from '@/components/AppPreferencesContext';

export function SignaturePanel({ onInsert, onClose, disabled }: { onInsert: (text: string) => void; onClose: () => void; disabled: boolean }) {
    const { preferences, updatePreferences } = useAppPreferences();
    const [text, setText] = useState(preferences.signature);
    const [saving, setSaving] = useState(false);
    const [status, setStatus] = useState('');
    const dirty = text !== preferences.signature;
    return <section aria-label="Email signature" className="shrink-0 border-y border-black/5 bg-primary/[0.035] px-6 py-3 dark:border-white/10">
        <div className="mb-2 flex items-center justify-between gap-3"><h3 className="text-xs font-semibold">Email signature</h3><button type="button" aria-label="Close signature editor" onClick={onClose} disabled={saving} className="compose-tool"><X size={14} /></button></div>
        <textarea aria-label="Signature text" value={text} disabled={disabled || saving} maxLength={4000} rows={3} placeholder="Your name, role, and contact details…" onChange={event => { setText(event.target.value); setStatus(''); }} className="settings-input max-h-36 min-h-20 w-full resize-y text-xs" />
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
            <button type="button" disabled={disabled || saving || !text.trim()} onClick={() => { onInsert(text); }} className="font-medium text-primary disabled:opacity-40">Insert into message</button>
            <button type="button" disabled={disabled || saving || !dirty} onClick={() => {
                setSaving(true); setStatus('');
                void updatePreferences({ signature: text }).then(() => setStatus(text.trim() ? 'Default signature saved.' : 'Default signature removed.')).catch(error => setStatus(`Could not save: ${String(error)}`)).finally(() => setSaving(false));
            }} className="font-medium text-primary disabled:opacity-40">{saving ? 'Saving…' : text.trim() ? 'Save as default' : 'Remove default'}</button>
            <span role="status" className="text-muted-foreground">{status || 'Defaults apply to new messages. Existing drafts stay as written.'}</span>
        </div>
    </section>;
}
