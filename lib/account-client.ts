export type AccountTransport = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

/** Device preferences/window commands stay global. Mailbox work always carries ownership. */
export const ACCOUNT_COMMANDS = new Set([
    'get_mailboxes', 'get_inbox_messages', 'get_cached_messages', 'get_folder_messages', 'get_messages_page',
    'get_message_body', 'get_cached_message_headers', 'get_conversation_messages', 'prefetch_messages',
    'sync_inbox', 'sync_mail_folder', 'get_unread_counts', 'get_sync_diagnostics', 'search_contacts',
    'search_messages', 'load_more_results', 'clear_search', 'get_all_tags', 'get_message_tags',
    'create_tag', 'update_tag', 'delete_tag', 'update_message_tags', 'refresh_message_labels',
    'clear_local_cache', 'get_cache_summary', 'clear_body_cache', 'update_display_name', 'get_download_folder',
    'pick_attachments', 'release_attachment_handles', 'download_attachment', 'send_message',
    'mark_as_read', 'toggle_read', 'toggle_star', 'delete_message', 'prepare_reply', 'prepare_forward',
    'list_drafts', 'draft_status', 'open_draft', 'save_draft', 'release_draft', 'discard_draft',
    'sync_drafts', 'send_draft', 'resolve_draft_send', 'fork_draft', 'copy_draft_to_account', 'recover_draft',
    'list_mail_pins', 'set_mail_pin', 'snooze_mail', 'unsnooze_mail', 'list_snoozed_mail',
    'trash_action', 'list_trash_actions', 'undo_trash_action',
]);

export function createAccountInvoker(owner: string | undefined, transport: AccountTransport, current: (id: string) => boolean = () => true): AccountTransport {
    return async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
        if (!ACCOUNT_COMMANDS.has(command)) return transport<T>(command, args);
        if (command === 'release_attachment_handles' && owner && (args?.accountId === undefined || args.accountId === owner)) return transport<T>(command, { ...args, accountId: owner });
        if (!owner || !current(owner) || args?.accountId !== undefined && args.accountId !== owner) throw new Error('Account changed. Reopen the mailbox and try again.');
        const result = await transport<T>(command, { ...args, accountId: owner });
        if (!current(owner)) throw new Error('Account changed while the request was running.');
        return result;
    };
}
