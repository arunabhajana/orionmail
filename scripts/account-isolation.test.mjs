import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAccountRequestCancelled, createAccountInvoker } from '../lib/account-client.ts';
import { dedupeMail, sameMail } from '../lib/mail-identity.ts';
import { groupConversations } from '../lib/conversations.ts';
import { createEventScope } from '../lib/event-scope.ts';

test('mail requests capture their account while device settings stay global', async () => {
    const calls = [];
    const invoke = createAccountInvoker('a', async (name, args) => { calls.push([name, args]); return []; });
    await invoke('get_folder_messages', { folder: 'inbox', limit: 50 });
    await invoke('get_app_settings');
    assert.deepEqual(calls, [['get_folder_messages', { folder: 'inbox', limit: 50, accountId: 'a' }], ['get_app_settings', undefined]]);
    await assert.rejects(invoke('get_folder_messages', { accountId: 'b' }), /Account changed/);
    assert.equal(calls.length, 2);
});

test('late replies from a previous account are rejected without retargeting the request', async () => {
    let active = 'a', finish;
    const invoke = createAccountInvoker('a', (name, args) => {
        assert.equal(args.accountId, 'a');
        return new Promise(resolve => { finish = resolve; });
    }, id => id === active);
    const result = invoke('get_message_body', { folder: 'inbox', uid: 42 });
    active = 'b'; finish({ body: 'private A body' });
    await assert.rejects(result, /Account changed/);
});

test('no-account requests cannot access mailbox commands, and owned attachment cleanup remains possible', async () => {
    const calls = [];
    const transport = async (name, args) => { calls.push([name, args]); };
    await assert.rejects(createAccountInvoker(undefined, transport)('search_contacts', { query: '' }), /Account changed/);
    await createAccountInvoker('a', transport, () => false)('release_attachment_handles', { handles: ['owned-handle'] });
    assert.deepEqual(calls, [['release_attachment_handles', { handles: ['owned-handle'], accountId: 'a' }]]);
});

test('identical UIDs, Message-IDs and thread IDs from different accounts never merge', () => {
    const mail = { id: 'inbox-42', folder: 'inbox', uid: 42, messageId: '<same@example.com>', threadId: '<root@example.com>', timestamp: 100, senderEmail: 'sender@example.com', subject: 'Same copy', tags: [], attachments: [] };
    const a = { ...mail, accountId: 'a' }, b = { ...mail, accountId: 'b' };
    assert.equal(dedupeMail([a, b]).length, 2);
    assert.equal(sameMail(a, b), false);
    assert.equal(groupConversations([a, b]).length, 2);
    assert.equal(groupConversations([a, { ...a, id: 'sent-43', uid: 43 }]).length, 1);
});

test('account teardown releases listeners that finish registering after the view unmounts', async () => {
    let finish, receive, releases = 0, events = 0;
    const scope = createEventScope(async (_, handler) => { receive = handler; return new Promise(resolve => { finish = resolve; }); });
    const registration = scope.listen('mail:updated', () => events++);
    scope.dispose(); receive({ payload: 'old account' });
    finish(() => releases++);
    const stop = await registration; stop(); scope.dispose();
    assert.equal(releases, 1); assert.equal(events, 0);
});

test('account-switch cancellation is distinguishable from real provider failures', async () => {
    const invoke = createAccountInvoker('a', async () => {}, () => false);
    await assert.rejects(invoke('mark_as_read'), error => isAccountRequestCancelled(error));
    assert.equal(isAccountRequestCancelled(new Error('Provider failed')), false);
});
