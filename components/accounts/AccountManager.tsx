"use client";
import { Plus, LoaderCircle } from 'lucide-react';
import { useAuth } from '@/components/AuthContext';
import { MAX_CONNECTED_ACCOUNTS, ACCOUNT_LIMIT_MESSAGE } from '@/lib/account-policy';
import { AccountList } from './AccountList';
import { settingButton } from '@/components/settings/SettingsControls';
import { toast } from 'sonner';

export function AccountManager() {
    const { accounts, accountBusy, addGoogleAccount } = useAuth();
    return <section data-setting-id="account.connected" className="settings-group p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="text-sm font-semibold">Connected accounts</h2><p className="mt-1 text-xs text-muted-foreground">Choose the mailbox to use. Mail and drafts stay with their account.</p></div>
            <button type="button" disabled={accountBusy || (accounts?.length ?? 0) >= MAX_CONNECTED_ACCOUNTS} className={settingButton} onClick={() => { void addGoogleAccount().catch(error => toast.error('Could not add account', { description: String(error) })); }}>{accountBusy ? <LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" /> : <Plus size={14} />}Add Google account</button>
        </div>
        <p className="mb-3 text-[11px] text-muted-foreground">{accounts?.length ?? 0} / {MAX_CONNECTED_ACCOUNTS} accounts{(accounts?.length ?? 0) >= MAX_CONNECTED_ACCOUNTS && ` · ${ACCOUNT_LIMIT_MESSAGE}`}</p>
        <AccountList />
        <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">Profile changes and sign-out below apply to the selected account. Appearance, notifications, and mail preferences currently apply to this device.</p>
    </section>;
}
