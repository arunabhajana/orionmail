import { createElement, useState } from 'react';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { currentRelease, releases } from '@/lib/generated/releases';
vi.mock('next/image', () => ({ default: ({ src, alt }: { src: string; alt: string }) => createElement('img', { src, alt }) }));
import { ReleaseNotesPanel, WhatsNewModal } from '@/components/settings/ReleaseNotes';

function Tour() {
    const [open, setOpen] = useState(false);
    return <><button onClick={() => setOpen(true)}>Open tour</button>{open && <WhatsNewModal onClose={() => setOpen(false)} />}</>;
}
describe('release content from the versioned file', () => {
    it('introduces 0.3.0 Smart Notifications as an optional feature', () => {
        const release = releases.find(entry => entry.version === '0.3.0')!;
        render(<WhatsNewModal release={release} onClose={() => {}} />);
        const modal = within(screen.getByRole('dialog'));
        expect(modal.getByText(/Smart Notifications are OFF by default/)).toBeVisible();
        expect(modal.getByText(/Enable them in Settings → Notifications to try them/)).toBeVisible();
        expect(modal.getByRole('img')).toHaveAttribute('src', '/releases/0.3.0/smart-notifications.svg');
    });
    it('starts collapsed, expands categorized text, and has no tour preview button', async () => {
        const user = userEvent.setup(); render(<ReleaseNotesPanel />);
        const title = screen.getByRole('heading', { name: currentRelease.title, hidden: true });
        expect(title).not.toBeVisible();
        expect(screen.queryByRole('button', { name: /what.s new/i })).not.toBeInTheDocument();
        await user.click(screen.getByText('Release notes'));
        expect(title).toBeVisible();
        const currentNotes = screen.getByRole('article', { name: `Version ${currentRelease.version} release notes` });
        for (const section of currentRelease.sections) expect(within(currentNotes).getByRole('heading', { name: section.category })).toBeVisible();
        for (const release of releases.filter(entry => entry.version !== currentRelease.version)) {
            const summary = screen.getByText(`Version ${release.version} · ${release.title}`);
            expect(summary.closest('details')).not.toHaveAttribute('open');
            const history = screen.getByRole('article', { name: `Version ${release.version} release notes`, hidden: true });
            expect(history).not.toBeVisible();
            await user.click(summary);
            expect(history).toBeVisible();
            for (const section of release.sections) expect(within(history).getByRole('heading', { name: section.category })).toBeVisible();
            await user.click(summary);
            expect(history).not.toBeVisible();
        }
        expect(screen.queryByRole('img')).not.toBeInTheDocument();
        await user.click(screen.getByText('Release notes'));
        expect(title).not.toBeVisible();
    });
    it('pages through file-backed illustrated slides', async () => {
        const user = userEvent.setup(); render(<Tour />);
        await user.click(screen.getByRole('button', { name: 'Open tour' }));
        const modal = screen.getByRole('dialog');
        expect(within(modal).getByRole('img')).toHaveAttribute('alt', currentRelease.whatsNew[0].image.alt);
        expect(within(modal).getByRole('button', { name: 'Previous feature' })).toBeDisabled();
        for (let index = 1; index < currentRelease.whatsNew.length; index++) {
            await user.click(within(modal).getByRole('button', { name: 'Next' }));
            expect(within(modal).getByRole('heading', { name: currentRelease.whatsNew[index].title })).toBeInTheDocument();
            expect(within(modal).getByRole('img')).toHaveAttribute('src', currentRelease.whatsNew[index].image.src);
        }
        await user.click(within(modal).getByRole('button', { name: 'Done' }));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    it('supports dots, keyboard navigation and cancellation without persisting a seen version', async () => {
        const user = userEvent.setup(); render(<Tour />);
        await user.click(screen.getByRole('button', { name: 'Open tour' }));
        const modal = screen.getByRole('dialog');
        const target = Math.min(2, currentRelease.whatsNew.length - 1);
        await user.click(within(modal).getByRole('button', { name: `Slide ${target + 1}: ${currentRelease.whatsNew[target].title}` }));
        fireEvent.keyDown(modal, { key: 'ArrowLeft' });
        expect(within(modal).getByRole('heading', { name: currentRelease.whatsNew[Math.max(0, target - 1)].title })).toBeInTheDocument();
        fireEvent(modal, new Event('cancel', { bubbles: false, cancelable: true }));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Open tour' }));
        expect(within(screen.getByRole('dialog')).getByRole('heading', { name: currentRelease.whatsNew[0].title })).toBeInTheDocument();
    });
});
