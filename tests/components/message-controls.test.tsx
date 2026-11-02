import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import type { Email, Tag } from '@/lib/types';
import { MessageTagPicker } from '@/components/inbox/MessageTagPicker';
import { SnoozeDialog } from '@/components/inbox/SnoozeDialog';
const email: Email = { id: 'inbox-1', uid: 1, folder: 'inbox', sender: 'Alex', senderEmail: 'alex@example.com', subject: 'Planning', timestamp: 1, date: '', time: '', unread: true, starred: false, preview: '', tags: ['one'], attachments: [] };
const tags: Tag[] = ['one', 'two'].map(id => ({ account_id: 'a', id, name: id, tag_type: 'user', provider: 'google', updated_at: 0 }));
it('custom tag selectors submit exact additions and removals', async () => {
    const user = userEvent.setup(), apply = vi.fn(); render(<MessageTagPicker email={email} tags={tags} onApply={apply} onClose={vi.fn()} />);
    await user.click(screen.getByRole('checkbox', { name: /one/ })); await user.click(screen.getByRole('checkbox', { name: /two/ }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(apply).toHaveBeenCalledWith(email, ['two'], ['one']);
});
it('custom snooze selection returns to choices before scheduling mail', async () => {
    const user = userEvent.setup(), save = vi.fn().mockResolvedValue(undefined); render(<SnoozeDialog subject="Planning" onClose={vi.fn()} onSave={save} />);
    await user.click(screen.getByRole('button', { name: /Pick date & time/ }));
    expect(screen.getByRole('heading', { name: 'Pick date & time' })).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Set time' }));
    expect(screen.getByRole('heading', { name: 'Snooze conversation' })).toBeInTheDocument(); expect(save).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Snooze' })); expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0][0]).toBeGreaterThan(Date.now() / 1000);
});
