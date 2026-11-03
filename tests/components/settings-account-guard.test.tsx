import { useEffect } from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ onCloseRequested: async () => () => {} }) }));
import { SettingsProvider, useSettings } from '@/components/settings/SettingsContext';

let settings: ReturnType<typeof useSettings>;
function Probe({ save }: { save: () => Promise<void> }) {
    const value = useSettings();
    const { registerSection, unregisterSection } = value;
    useEffect(() => { settings = value; }, [value]);
    useEffect(() => { registerSection({ id: 'test', isDirty: true, save, reset: () => {} }); return () => unregisterSection('test'); }, [registerSection, unregisterSection, save]);
    return null;
}
it('permits an account change immediately after save, before the next React render', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<SettingsProvider onInterceptNavigation={() => {}}><Probe save={save} /></SettingsProvider>);
    await waitFor(() => expect(settings.hasUnsavedChanges).toBe(true));
    expect(settings.canChangeAccount()).toBe(false);
    await act(async () => { await settings.saveAll(); expect(settings.canChangeAccount()).toBe(true); });
    expect(save).toHaveBeenCalledOnce();
});
it('permits account changes immediately after discarding pending edits', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<SettingsProvider onInterceptNavigation={() => {}}><Probe save={save} /></SettingsProvider>);
    await waitFor(() => expect(settings.hasUnsavedChanges).toBe(true));
    act(() => { settings.resetAll(); expect(settings.canChangeAccount()).toBe(true); });
    expect(save).not.toHaveBeenCalled();
});
