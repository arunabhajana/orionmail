"use client";
import { useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useAuth } from '@/components/AuthContext';
import { createAccountInvoker } from '@/lib/account-client';

export function useAccountInvoke() {
    const { user, accountEpoch, isAccountCurrent } = useAuth();
    return useMemo(() => createAccountInvoker(user?.id, invoke, id => isAccountCurrent(id, accountEpoch)), [user?.id, accountEpoch, isAccountCurrent]);
}
