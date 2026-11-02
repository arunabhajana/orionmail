import { createElement } from 'react';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { currentRelease } from '@/lib/generated/releases';
vi.mock('next/image', () => ({ default: ({ src, alt }: { src: string; alt: string }) => createElement('img', { src, alt }) }));
import { ReleaseNotesPanel } from '@/components/settings/ReleaseNotes';
describe('release content from the versioned file', () => {
    it('shows text-only categorized notes and pages through illustrated slides', async () => {
        const user = userEvent.setup(); render(<ReleaseNotesPanel />);
        expect(screen.getByRole('heading', { name: currentRelease.title })).toBeInTheDocument();
        for (const section of currentRelease.sections) expect(screen.getByRole('heading', { name: section.category })).toBeInTheDocument();
        expect(screen.queryByRole('img')).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Preview What’s new' }));
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
        const user = userEvent.setup(); render(<ReleaseNotesPanel />);
        await user.click(screen.getByRole('button', { name: 'Preview What’s new' }));
        const modal = screen.getByRole('dialog');
        const target = Math.min(2, currentRelease.whatsNew.length - 1);
        await user.click(within(modal).getByRole('button', { name: `Slide ${target + 1}: ${currentRelease.whatsNew[target].title}` }));
        fireEvent.keyDown(modal, { key: 'ArrowLeft' });
        expect(within(modal).getByRole('heading', { name: currentRelease.whatsNew[Math.max(0, target - 1)].title })).toBeInTheDocument();
        fireEvent(modal, new Event('cancel', { bubbles: false, cancelable: true }));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Preview What’s new' }));
        expect(within(screen.getByRole('dialog')).getByRole('heading', { name: currentRelease.whatsNew[0].title })).toBeInTheDocument();
    });
});
