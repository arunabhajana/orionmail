import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
const route = vi.hoisted(() => ({ path: '/inbox' }));
vi.mock('next/navigation', () => ({ usePathname: () => route.path }));
vi.mock('@/components/AuthContext', () => ({ useAuth: () => ({ user: { id: 'account-a' } }) }));
vi.mock('@/components/InboxWorkspace', () => ({ default: function Workspace() { const [count, setCount] = useState(0); return <button onClick={() => setCount(count + 1)}>Selected message {count}</button>; } }));
import { PersistentInbox } from '@/components/PersistentInbox';
it('keeps the existing inbox mounted through a settings round trip', async () => {
    const user = userEvent.setup(), { rerender } = render(<PersistentInbox />);
    await user.click(screen.getByRole('button', { name: 'Selected message 0' }));
    route.path = '/settings'; rerender(<PersistentInbox />); expect(screen.queryByRole('button')).not.toBeInTheDocument();
    route.path = '/inbox'; rerender(<PersistentInbox />); expect(screen.getByRole('button', { name: 'Selected message 1' })).toBeInTheDocument();
});
