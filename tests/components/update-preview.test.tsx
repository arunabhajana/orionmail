import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { UpdatePreviewCard } from '@/components/settings/UpdatePreview';

afterEach(() => vi.useRealTimers());

it('runs a cancellable update simulation and opens the illustrated tour on completion', () => {
    vi.useFakeTimers(); render(<UpdatePreviewCard />);
    fireEvent.click(screen.getByRole('button', { name: 'Preview update' }));
    expect(screen.getByRole('dialog', { name: 'An update is ready' })).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Update now' }));
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    act(() => vi.advanceTimersByTime(4200));
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '70');
    expect(screen.getByRole('status')).toHaveTextContent('Preparing installation');
    act(() => vi.advanceTimersByTime(1800));
    expect(screen.getByRole('dialog', { name: 'You’re all set' })).toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'See what’s new' }));
    expect(screen.getByRole('dialog', { name: /.+/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close What’s new' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('cancels cleanly and starts fresh when reopened', () => {
    vi.useFakeTimers(); render(<UpdatePreviewCard />);
    fireEvent.click(screen.getByRole('button', { name: 'Preview update' }));
    fireEvent.click(screen.getByRole('button', { name: 'Update now' }));
    act(() => vi.advanceTimersByTime(600));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel preview' }));
    expect(vi.getTimerCount()).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Preview update' }));
    expect(screen.getByRole('button', { name: 'Update now' })).toBeInTheDocument();
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
