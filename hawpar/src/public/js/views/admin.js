/**
 * Workspace administration: members, API keys, webhooks, the activity log and
 * the extraction learning memory, plus the workspace lifecycle (archive and
 * restore) for platform administrators.
 *
 * Administrators only. The server enforces every rule (roles, last-admin
 * protection, one-time secrets); this view presents them, and a credential is
 * never kept beyond the dialog that reveals it.
 */
import { api } from '../api.js';
import { icon } from '../icons.js';
import { isAdmin } from '../role.js';
import { currentUser, currentWorkspace, initialsFor, loadSession } from '../session.js';
import { state } from '../store.js';
import { debounce, el, formatDateTime, formatNumber, relativeTime, toast } from '../util.js';
import { card, confirmDialog, dataTable, emptyState, kpi, loading, modalDialog, pageHeader, revealSecretDialog, tabGroup } from './common.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLE_LABELS = Object.freeze({ admin: 'Administrator', user: 'Operator' });
const roleLabel = (role) => ROLE_LABELS[role] ?? role;

const ACTIVITY_CATEGORIES = Object.freeze([
  { value: '', label: 'All activity' },
  { value: 'auth.', label: 'Sign-ins & sessions' },
  { value: 'document.', label: 'Documents' },
  { value: 'workflow.', label: 'Review workflow' },
  { value: 'member.', label: 'Members' },
  { value: 'api_key.', label: 'API keys' },
  { value: 'webhook.', label: 'Webhooks' },
  { value: 'settings.', label: 'Settings' },
  { value: 'workspace.', label: 'Workspace' },
  { value: 'learning.', label: 'Learning memory' }
]);

const WEBHOOK_EVENT_HELP = Object.freeze({
  'document.processed': 'Extraction finished.',
  'document.review_required': 'Extraction finished and a person needs to review it.',
  'document.failed': 'Processing failed.',
  'document.approved': 'A reviewer approved the document.',
  'document.rejected': 'A reviewer rejected the document.',
  'document.deleted': 'The document was deleted.'
});

const DELIVERY_TONES = Object.freeze({ succeeded: 'success', retrying: 'warn', failed: 'danger' });
const DELIVERY_LABELS = Object.freeze({ succeeded: 'Delivered', retrying: 'Retrying', failed: 'Failed' });

/* ── Building blocks ─────────────────────────────────────────────────────── */

let sequence = 0;
const nextId = (prefix) => `${prefix}-${(sequence += 1)}`;

function button(label, { iconName, tone = 'ghost', small = false, id, onClick, title } = {}) {
  return el(`button.btn.btn--${tone}${small ? '.btn--sm' : ''}`, { type: 'button', id, title, on: onClick ? { click: onClick } : null }, [
    iconName ? icon(iconName, { size: 14 }) : null,
    el('span', { text: label })
  ]);
}

/** Runs `task` with the button disabled; failures surface as a toast. */
async function busy(node, task) {
  if (node.disabled) return undefined;
  node.disabled = true;
  node.classList.add('is-busy');
  try {
    return await task();
  } catch (error) {
    toast(error?.message ?? 'Something went wrong. Please try again.', 'error');
    return undefined;
  } finally {
    node.disabled = false;
    node.classList.remove('is-busy');
  }
}

function formField(label, control, help) {
  if (!control.id) control.id = nextId('admin-field');
  const helpNode = help ? el('p.field__help', { id: `${control.id}-help`, text: help }) : null;
  if (helpNode) control.setAttribute('aria-describedby', helpNode.id);
  return el('div.field', {}, [el('label', { for: control.id, text: label }), control, helpNode]);
}

function roleSelect(value = 'user') {
  return el('select', {}, ['user', 'admin'].map((role) => el('option', { value: role, text: roleLabel(role), selected: role === value })));
}

function panelHead({ title, description, actions = [] }) {
  return el('div.admin-panel__head', {}, [
    el('div.admin-panel__intro', {}, [el('h2', { text: title }), el('p', {}, description)]),
    actions.length > 0 ? el('div.admin-panel__actions', {}, actions) : null
  ]);
}

/** A panel whose body loads asynchronously and can be refreshed in place. */
function asyncPanel(head, load) {
  const body = el('div.admin-panel__body', {}, [loading()]);
  const panel = el('section.admin-panel', {}, [head, body]);
  async function refresh() {
    try {
      const content = await load();
      body.replaceChildren(...[content].flat().filter(Boolean));
    } catch (error) {
      body.replaceChildren(
        emptyState('This section could not be loaded', error?.message ?? 'Please try again.', button('Retry', { iconName: 'refresh', onClick: refresh }), 'alert')
      );
    }
  }
  return { panel, refresh };
}

/**
 * A modal form. `onSubmit` returns the outcome, which the returned promise
 * resolves with once the dialog closes (undefined if it was cancelled). A
 * thrown error is shown inline and keeps the dialog open.
 */
function formDialog({ title, subtitle, fields, submitLabel, onSubmit, wide = false }) {
  const formId = nextId('admin-form');
  const errorSlot = el('p.field__error', { role: 'alert' });
  const form = el('form.admin-form', { id: formId, novalidate: true }, [...fields, errorSlot]);
  const submit = el('button.btn.btn--primary', { type: 'submit' }, [el('span', { text: submitLabel })]);
  submit.setAttribute('form', formId);
  const cancel = button('Cancel');
  const modal = modalDialog({ title, subtitle, content: [form], footer: [cancel, submit], wide });
  cancel.addEventListener('click', () => modal.close());

  let outcome;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    errorSlot.textContent = '';
    submit.disabled = true;
    submit.classList.add('is-busy');
    try {
      outcome = await onSubmit();
      modal.close();
    } catch (error) {
      errorSlot.textContent = error?.message ?? 'Something went wrong. Please try again.';
    } finally {
      submit.disabled = false;
      submit.classList.remove('is-busy');
    }
  });
  return modal.closed.then(() => outcome);
}

function invalid(input, message) {
  input.focus();
  return new Error(message);
}

/* ── Members ─────────────────────────────────────────────────────────────── */

function membersPanel() {
  const add = button('Add member', { iconName: 'users', tone: 'primary', id: 'admin-add-member' });
  const { panel, refresh } = asyncPanel(
    panelHead({
      title: 'Members',
      description: 'People who can sign in to this workspace. Operators upload, review and approve documents; administrators also manage members, API keys, webhooks and settings.',
      actions: [add]
    }),
    async () => {
      const { items } = await api.listMembers();
      const me = currentUser();
      const viaPlatformRole = me?.platformAdmin && !items.some((member) => member.id === me.id);
      const activeAdmins = items.filter((member) => member.role === 'admin' && member.status === 'active');
      return [
        viaPlatformRole
          ? el('p.auth__notice.auth__notice--info', { role: 'note' }, [
              icon('info', { size: 15 }),
              el('span', { text: 'You are not listed because you have access as a platform administrator, which covers every workspace.' })
            ])
          : null,
        dataTable(
          [{ label: 'Member' }, { label: 'Role' }, { label: 'Status' }, { label: 'Last sign-in' }, { label: 'Added' }, { label: 'Actions' }],
          items.map((member) =>
            memberRow(member, {
              isSelf: member.id === me?.id,
              soleAdmin: activeAdmins.length === 1 && activeAdmins[0].id === member.id,
              refresh
            })
          ),
          { stack: true, label: 'Workspace members', emptyMessage: 'No members yet. Add the people who will upload and review documents here.' }
        )
      ];
    }
  );
  add.addEventListener('click', () => addMember(refresh));
  refresh();
  return panel;
}

function memberRow(member, { isSelf, soleAdmin, refresh }) {
  const identity = el('div.admin-identity', {}, [
    el('span.admin-identity__avatar', { text: initialsFor(member), 'aria-hidden': 'true' }),
    el('div.admin-identity__text', {}, [
      el('strong', { text: `${member.name || member.email}${isSelf ? ' (you)' : ''}` }),
      member.name ? el('span', { text: member.email }) : null
    ])
  ]);

  const role = roleSelect(member.role);
  role.classList.add('admin-inline-select');
  role.setAttribute('aria-label', `Role for ${member.email}`);
  if (isSelf) {
    role.disabled = true;
    role.title = 'Ask another administrator to change your role.';
  }
  const workspaceName = () => currentWorkspace()?.name ?? 'this workspace';
  role.addEventListener('change', async () => {
    const next = role.value;
    if (next === 'admin') {
      const ok = await confirmDialog({
        title: 'Grant administrator access?',
        message: `${member.email} will be able to manage members, API keys, webhooks and settings in this workspace.`,
        confirmLabel: 'Make administrator',
        tone: 'default'
      });
      if (!ok) {
        role.value = member.role;
        return;
      }
    } else if (soleAdmin) {
      const ok = await confirmDialog({
        title: 'Leave the workspace without its own administrator?',
        message: `${member.email} is the only administrator of ${workspaceName()}. Afterwards only platform administrators can manage its members, API keys, webhooks and settings.`,
        confirmLabel: 'Make operator'
      });
      if (!ok) {
        role.value = member.role;
        return;
      }
    }
    role.disabled = true;
    try {
      const { member: updated } = await api.updateMember(member.id, { role: next });
      toast(`${updated.email} is now ${updated.role === 'admin' ? 'an administrator' : 'an operator'}.`, 'success');
      refresh();
    } catch (error) {
      role.value = member.role;
      role.disabled = false;
      toast(error.message, 'error');
    }
  });

  const badges = [
    member.status && member.status !== 'active' ? el('span.badge.badge--neutral', { text: member.status }) : null,
    member.locked ? el('span.badge.badge--danger', { text: 'Locked', title: 'Too many failed sign-ins; unlocks automatically.' }) : null,
    member.mustChangePassword ? el('span.badge.badge--warn', { text: 'Awaiting new password' }) : null,
    member.platformAdmin ? el('span.badge.badge--info', { text: 'Platform admin' }) : null
  ].filter(Boolean);
  if (badges.length === 0) badges.push(el('span.badge.badge--success', { text: 'Active' }));

  const reset = button('Reset password', { iconName: 'key', small: true });
  reset.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Reset this password?',
      message: `${member.email} is signed out everywhere and must sign in with a one-time password, then choose a new one.`,
      confirmLabel: 'Reset password',
      tone: 'default'
    });
    if (!ok) return;
    const result = await busy(reset, () => api.resetMemberPassword(member.id));
    if (!result) return;
    refresh();
    await revealSecretDialog({
      title: 'One-time password issued',
      message: `Give this one-time password to ${result.email} through a trusted channel. They choose a new password when they sign in.`,
      secret: result.temporaryPassword,
      label: 'One-time password'
    });
  });

  const remove = button('Remove', { iconName: 'close', small: true });
  remove.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Remove this member?',
      message: `${member.email} immediately loses access to ${workspaceName()}. Their past activity stays in the activity log.${
        soleAdmin ? ' They are its only administrator, so afterwards only platform administrators can manage it.' : ''
      }`,
      confirmLabel: 'Remove member'
    });
    if (!ok) return;
    const result = await busy(remove, () => api.removeMember(member.id));
    if (!result) return;
    toast(`${member.email} was removed from the workspace.`, 'success');
    refresh();
  });

  if (isSelf) {
    for (const node of [reset, remove]) {
      node.disabled = true;
      node.title = 'Use the account menu to manage your own access.';
    }
  }

  return [
    identity,
    role,
    el('div.chip-row', {}, badges),
    member.lastLoginAt ? el('span', { text: relativeTime(member.lastLoginAt), title: formatDateTime(member.lastLoginAt) }) : 'Never',
    el('div.admin-stack', {}, [el('span', { text: formatDateTime(member.addedAt) }), member.addedBy ? el('span.muted', { text: `by ${member.addedBy}` }) : null]),
    el('div.admin-row-actions', {}, [reset, remove])
  ];
}

async function addMember(refresh) {
  const email = el('input', { type: 'email', autocomplete: 'off', placeholder: 'colleague@company.com', required: true });
  const name = el('input', { type: 'text', autocomplete: 'off', placeholder: 'Optional' });
  const role = roleSelect('user');
  const result = await formDialog({
    title: 'Add a member',
    subtitle: 'New people get a one-time password to share with them securely. Someone who already has an account simply gains access to this workspace.',
    fields: [
      formField('Work email', email),
      formField('Name', name),
      formField('Role', role, 'Operators process documents. Administrators can also manage the workspace.')
    ],
    submitLabel: 'Add member',
    onSubmit: () => {
      const address = email.value.trim();
      if (!EMAIL_PATTERN.test(address)) throw invalid(email, 'Enter a valid email address.');
      return api.addMember({ email: address, name: name.value.trim() || undefined, role: role.value });
    }
  });
  if (!result) return;
  refresh();
  if (result.temporaryPassword) {
    await revealSecretDialog({
      title: 'Member added',
      message: `Give this one-time password to ${result.member.email} through a trusted channel. They choose their own password the first time they sign in.`,
      secret: result.temporaryPassword,
      label: 'One-time password'
    });
  } else {
    toast(`${result.member.email} already had an account and can now open this workspace.`, 'success');
  }
}

/* ── API keys ────────────────────────────────────────────────────────────── */

function apiKeysPanel() {
  const create = button('Create API key', { iconName: 'key', tone: 'primary', id: 'admin-create-key' });
  const { panel, refresh } = asyncPanel(
    panelHead({
      title: 'API keys',
      description: [
        'Connect back-office systems without a user session. Send the key in the ',
        el('code', { text: 'x-api-key' }),
        ' header; it acts with the role you choose and only in this workspace. Keys are stored as hashes and shown once.'
      ],
      actions: [create]
    }),
    async () => {
      const { items } = await api.listApiKeys();
      return dataTable(
        [{ label: 'Name' }, { label: 'Key' }, { label: 'Role' }, { label: 'Created' }, { label: 'Last used' }, { label: 'Status' }, { label: 'Actions' }],
        items.map((key) => [
          el('strong', { text: key.name }),
          el('code.admin-code', { text: key.preview }),
          roleLabel(key.role),
          el('div.admin-stack', {}, [el('span', { text: formatDateTime(key.createdAt) }), el('span.muted', { text: `by ${key.createdBy}` })]),
          key.lastUsedAt ? el('span', { text: relativeTime(key.lastUsedAt), title: formatDateTime(key.lastUsedAt) }) : 'Never',
          key.revokedAt
            ? el('span.badge.badge--neutral', { text: 'Revoked', title: `Revoked ${formatDateTime(key.revokedAt)}${key.revokedBy ? ` by ${key.revokedBy}` : ''}` })
            : el('span.badge.badge--success', { text: 'Active' }),
          key.revokedAt ? '' : revokeKeyButton(key, refresh)
        ]),
        { stack: true, label: 'API keys', emptyMessage: 'No API keys yet. Create one to connect an integration.' }
      );
    }
  );

  create.addEventListener('click', async () => {
    const name = el('input', { type: 'text', autocomplete: 'off', placeholder: 'e.g. SAP invoice intake', maxLength: 80, required: true });
    const role = roleSelect('user');
    const result = await formDialog({
      title: 'Create an API key',
      subtitle: 'Name the key after the system that will use it, so you can recognise and revoke it later.',
      fields: [
        formField('Name', name),
        formField('Role', role, 'Operator keys can upload, read and review documents. Administrator keys can also manage settings and webhooks and read the activity log; managing people and keys always needs a signed-in administrator.')
      ],
      submitLabel: 'Create key',
      onSubmit: () => {
        if (name.value.trim().length < 2) throw invalid(name, 'Give the key a name.');
        return api.createApiKey({ name: name.value.trim(), role: role.value });
      }
    });
    if (!result) return;
    refresh();
    await revealSecretDialog({
      title: 'API key created',
      message: `Store “${result.apiKey.name}” in your integration's secret store. Only a hash is kept here.`,
      secret: result.key,
      label: 'API key',
      extra: [
        el('p.field__help', { text: 'Example request:' }),
        el('pre.admin-snippet', {}, [el('code', { text: `curl -H "x-api-key: $VGC_API_KEY" ${location.origin}/api/documents` })])
      ]
    });
  });

  refresh();
  return panel;
}

function revokeKeyButton(key, refresh) {
  const revoke = button('Revoke', { iconName: 'close', small: true });
  revoke.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Revoke this API key?',
      message: `Requests using “${key.name}” (${key.preview}) are rejected immediately. This cannot be undone.`,
      confirmLabel: 'Revoke key'
    });
    if (!ok) return;
    const result = await busy(revoke, () => api.revokeApiKey(key.id));
    if (!result) return;
    toast(`“${key.name}” was revoked.`, 'success');
    refresh();
  });
  return revoke;
}

/* ── Webhooks ────────────────────────────────────────────────────────────── */

function signatureHelp() {
  return el('details.admin-help', {}, [
    el('summary', { text: 'How to verify a delivery' }),
    el('p', {}, [
      'Each request has an ',
      el('code', { text: 'X-VGC-Signature: t=<unix seconds>,v1=<hex>' }),
      ' header. Compute HMAC-SHA256 of ',
      el('code', { text: '<t>.<raw request body>' }),
      ' with this secret, compare it with v1 in constant time, and reject timestamps older than five minutes.'
    ])
  ]);
}

function webhooksPanel() {
  const create = button('Add endpoint', { iconName: 'globe', tone: 'primary', id: 'admin-add-webhook' });
  let events = [];
  const { panel, refresh } = asyncPanel(
    panelHead({
      title: 'Webhooks',
      description: 'Notify your systems the moment documents are processed, need review or are decided. Deliveries are signed with HMAC-SHA256, and failures are retried with back-off.',
      actions: [create]
    }),
    async () => {
      const response = await api.listWebhooks();
      events = response.events;
      if (response.items.length === 0) {
        return emptyState('No webhooks yet', 'Add an HTTPS endpoint to receive document events as they happen.', null, 'globe');
      }
      return el('div.webhook-list', {}, response.items.map((hook) => webhookCard(hook, { events, refresh })));
    }
  );

  create.addEventListener('click', async () => {
    if (events.length === 0) {
      const response = await api.listWebhooks().catch((error) => toast(error.message, 'error'));
      if (!response) return;
      events = response.events;
    }
    const result = await webhookForm({ events });
    if (!result) return;
    refresh();
    await revealSecretDialog({
      title: 'Webhook endpoint added',
      message: 'Use this signing secret to check that each delivery really comes from this workspace.',
      secret: result.secret,
      label: 'Signing secret',
      extra: [signatureHelp()]
    });
  });

  refresh();
  return panel;
}

function webhookCard(hook, { events, refresh }) {
  const status = hook.active ? el('span.badge.badge--success', { text: 'Active' }) : el('span.badge.badge--neutral', { text: 'Paused' });
  const last = hook.lastDeliveryAt
    ? el(`span.badge.badge--${DELIVERY_TONES[hook.lastDeliveryStatus] ?? 'neutral'}`, {
        text: `Last: ${(DELIVERY_LABELS[hook.lastDeliveryStatus] ?? hook.lastDeliveryStatus ?? '').toLowerCase()} ${relativeTime(hook.lastDeliveryAt)}`,
        title: formatDateTime(hook.lastDeliveryAt)
      })
    : el('span.badge.badge--neutral', { text: 'No deliveries yet' });

  const test = button('Send test', { iconName: 'send', small: true });
  test.addEventListener('click', async () => {
    const result = await busy(test, () => api.testWebhook(hook.id));
    if (!result) return;
    const { delivery } = result;
    if (delivery.status === 'succeeded') toast(`Test delivered: HTTP ${delivery.responseStatus} in ${formatNumber(delivery.durationMs)} ms.`, 'success');
    else toast(`Test failed: ${delivery.error ?? 'no response from the endpoint.'}`, 'error');
    refresh();
  });

  const deliveries = button('Deliveries', { iconName: 'history', small: true, onClick: () => showDeliveries(hook) });

  const edit = button('Edit', { iconName: 'edit', small: true });
  edit.addEventListener('click', async () => {
    const result = await webhookForm({ events, hook });
    if (!result) return;
    toast('Webhook updated.', 'success');
    refresh();
  });

  const toggle = button(hook.active ? 'Pause' : 'Resume', { iconName: hook.active ? 'clock' : 'play', small: true });
  toggle.addEventListener('click', async () => {
    const result = await busy(toggle, () => api.updateWebhook(hook.id, { active: !hook.active }));
    if (!result) return;
    toast(hook.active ? 'Webhook paused. Events are no longer sent to it.' : 'Webhook resumed.', 'success');
    refresh();
  });

  const rotate = button('Rotate secret', { iconName: 'refresh', small: true });
  rotate.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Rotate the signing secret?',
      message: 'The current secret stops working immediately, so deliveries fail verification until your endpoint uses the new one.',
      confirmLabel: 'Rotate secret',
      tone: 'default'
    });
    if (!ok) return;
    const result = await busy(rotate, () => api.rotateWebhookSecret(hook.id));
    if (!result) return;
    refresh();
    await revealSecretDialog({
      title: 'New signing secret',
      message: `Update ${hook.url} to verify deliveries with this secret.`,
      secret: result.secret,
      label: 'Signing secret',
      extra: [signatureHelp()]
    });
  });

  const remove = button('Delete', { iconName: 'close', small: true });
  remove.addEventListener('click', async () => {
    const ok = await confirmDialog({ title: 'Delete this webhook?', message: `Events will no longer be sent to ${hook.url}.`, confirmLabel: 'Delete webhook' });
    if (!ok) return;
    const result = await busy(remove, () => api.deleteWebhook(hook.id));
    if (!result) return;
    toast('Webhook deleted.', 'success');
    refresh();
  });

  return el('article.webhook-card', { 'aria-label': `Webhook ${hook.url}` }, [
    el('div.webhook-card__head', {}, [
      el('div.webhook-card__title', {}, [el('code.webhook-card__url', { text: hook.url }), hook.description ? el('p', { text: hook.description }) : null]),
      el('div.webhook-card__status', {}, [status, last])
    ]),
    el('div.chip-row', { role: 'list', 'aria-label': 'Subscribed events' }, hook.events.map((event) => el('span.chip.chip--sm', { role: 'listitem', text: event }))),
    el('p.webhook-card__meta', { text: `Signing secret ${hook.secretPreview} · added ${formatDateTime(hook.createdAt)}${hook.createdBy ? ` by ${hook.createdBy}` : ''}` }),
    el('div.webhook-card__actions', {}, [test, deliveries, edit, toggle, rotate, remove])
  ]);
}

function webhookForm({ events, hook }) {
  const url = el('input', { type: 'url', autocomplete: 'off', placeholder: 'https://example.com/hooks/vgc', value: hook?.url ?? '', required: true });
  url.setAttribute('spellcheck', 'false');
  const description = el('input', { type: 'text', autocomplete: 'off', placeholder: 'e.g. ERP invoice intake', value: hook?.description ?? '', maxLength: 120 });
  const selected = new Set(hook?.events ?? events);
  const boxes = events.map((event) => el('input', { type: 'checkbox', value: event, checked: selected.has(event) }));
  const eventList = el('fieldset.webhook-events', {}, [
    el('legend', { text: 'Events to send' }),
    ...boxes.map((box) =>
      el('label.switch.webhook-event', {}, [
        box,
        el('span.webhook-event__text', {}, [el('code', { text: box.value }), el('small', { text: WEBHOOK_EVENT_HELP[box.value] ?? '' })])
      ])
    )
  ]);

  return formDialog({
    title: hook ? 'Edit webhook' : 'Add a webhook endpoint',
    subtitle: 'Each event is sent as a signed JSON POST. Failed deliveries are retried three more times with increasing back-off.',
    wide: true,
    fields: [formField('Endpoint URL', url, 'A public https:// address.'), formField('Description', description, 'Optional. Helps your team recognise the endpoint.'), eventList],
    submitLabel: hook ? 'Save changes' : 'Add endpoint',
    onSubmit: () => {
      const address = url.value.trim();
      if (!address) throw invalid(url, 'Enter the endpoint URL.');
      const chosen = boxes.filter((box) => box.checked).map((box) => box.value);
      if (chosen.length === 0) throw invalid(boxes[0], 'Choose at least one event.');
      const body = { url: address, description: description.value.trim(), events: chosen };
      return hook ? api.updateWebhook(hook.id, body) : api.createWebhook(body);
    }
  });
}

async function showDeliveries(hook) {
  const host = el('div.webhook-deliveries', {}, [loading('Loading deliveries…')]);
  const reload = button('Refresh', { iconName: 'refresh' });
  const modal = modalDialog({ title: 'Recent deliveries', subtitle: hook.url, content: [host], footer: [reload], wide: true });

  async function paint() {
    try {
      const { items } = await api.webhookDeliveries(hook.id, 50);
      host.replaceChildren(
        dataTable(
          [{ label: 'When' }, { label: 'Event' }, { label: 'Attempt', numeric: true }, { label: 'Result' }, { label: 'HTTP', numeric: true }, { label: 'Duration', numeric: true }, { label: 'Details' }],
          items.map((delivery) => [
            el('span', { text: relativeTime(delivery.at), title: formatDateTime(delivery.at) }),
            el('code.admin-code', { text: delivery.event }),
            String(delivery.attempt),
            el(`span.badge.badge--${DELIVERY_TONES[delivery.status] ?? 'neutral'}`, { text: DELIVERY_LABELS[delivery.status] ?? delivery.status }),
            delivery.responseStatus ? String(delivery.responseStatus) : '—',
            `${formatNumber(delivery.durationMs ?? 0)} ms`,
            el('span.admin-detail', { text: delivery.error ?? delivery.responseSnippet ?? '' })
          ]),
          { stack: true, label: 'Webhook deliveries', emptyMessage: 'No deliveries yet. Use “Send test” to try the endpoint.' }
        )
      );
    } catch (error) {
      host.replaceChildren(el('p.field__error', { role: 'alert', text: error.message }));
    }
  }

  reload.addEventListener('click', () => busy(reload, paint));
  paint();
  await modal.closed;
}

/* ── Activity log ────────────────────────────────────────────────────────── */

const CSV_COLUMNS = Object.freeze(['at', 'actor', 'action', 'target', 'detail', 'ip', 'correlationId']);

/** Quotes a CSV cell and neutralises spreadsheet formula injection. */
function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function activityPanel() {
  const PAGE_SIZE = 50;
  const category = el('select', {}, ACTIVITY_CATEGORIES.map((option) => el('option', { value: option.value, text: option.label })));
  const actor = el('input', { type: 'search', autocomplete: 'off', placeholder: 'Email or “system”' });
  const search = el('input', { type: 'search', autocomplete: 'off', placeholder: 'Target or detail' });
  const exportCsv = button('Export CSV', { iconName: 'download', id: 'activity-export' });
  const summary = el('p.admin-panel__summary', { role: 'status' });
  const tableHost = el('div.admin-panel__body', {}, [loading()]);
  const more = button('Load older activity', { iconName: 'history', id: 'activity-more' });
  more.hidden = true;
  exportCsv.disabled = true;

  let items = [];
  let total = 0;
  let requestSeq = 0;
  const isFiltered = () => Boolean(category.value || actor.value.trim() || search.value.trim());

  function paint(hasMore) {
    const filtered = isFiltered();
    summary.textContent = items.length === 0
      ? ''
      : `Showing ${formatNumber(items.length)} ${filtered ? 'matching' : 'most recent'} ${items.length === 1 ? 'event' : 'events'} · ${formatNumber(total)} recorded in total.`;
    tableHost.replaceChildren(
      dataTable(
        [{ label: 'When' }, { label: 'Who' }, { label: 'Action' }, { label: 'Target' }, { label: 'Detail' }, { label: 'IP address' }],
        items.map((entry) => [
          el('span.admin-when', { text: formatDateTime(entry.at), title: relativeTime(entry.at) }),
          entry.actor ?? 'system',
          el('code.admin-code', { text: entry.action }),
          entry.target ?? '—',
          el('span.admin-detail', { text: entry.detail ?? '' }),
          entry.ip ?? '—'
        ]),
        { stack: true, label: 'Activity log', emptyMessage: filtered ? 'No activity matches these filters.' : 'No activity recorded yet.' }
      )
    );
    more.hidden = !hasMore;
    exportCsv.disabled = items.length === 0;
  }

  async function load({ append = false } = {}) {
    const seq = (requestSeq += 1);
    if (!append) tableHost.replaceChildren(loading());
    try {
      const response = await api.activity({
        limit: PAGE_SIZE,
        action: category.value,
        actor: actor.value.trim(),
        q: search.value.trim(),
        before: append ? items.at(-1)?.id : undefined
      });
      if (seq !== requestSeq) return;
      items = append ? [...items, ...response.items] : response.items;
      total = response.total;
      paint(Boolean(response.hasMore));
    } catch (error) {
      if (seq !== requestSeq) return;
      tableHost.replaceChildren(emptyState('Activity could not be loaded', error?.message ?? 'Please try again.', button('Retry', { iconName: 'refresh', onClick: () => load() }), 'alert'));
    }
  }

  const reload = debounce(() => load(), 300);
  category.addEventListener('change', () => load());
  actor.addEventListener('input', reload);
  search.addEventListener('input', reload);
  more.addEventListener('click', () => busy(more, () => load({ append: true })));
  exportCsv.addEventListener('click', () => {
    const lines = [CSV_COLUMNS.join(','), ...items.map((entry) => CSV_COLUMNS.map((key) => csvCell(entry[key])).join(','))];
    const url = URL.createObjectURL(new Blob([`\uFEFF${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' }));
    const slug = (currentWorkspace()?.name ?? 'workspace').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'workspace';
    const link = el('a', { href: url, download: `activity-${slug}-${new Date().toISOString().slice(0, 10)}.csv` });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  load();
  return el('section.admin-panel', {}, [
    panelHead({
      title: 'Activity log',
      description: 'Who did what, and when: sign-ins, document decisions and administrative changes in this workspace, with the network address behind each.',
      actions: [exportCsv]
    }),
    el('div.filter-bar.admin-filters', {}, [formField('Category', category), formField('Person', actor), formField('Search', search)]),
    summary,
    tableHost,
    el('div.admin-panel__more', {}, [more])
  ]);
}

/* ── Learning memory ─────────────────────────────────────────────────────── */

function learningPanel() {
  const clearMemory = button('Clear memory', { iconName: 'close', id: 'learning-clear' });
  const typeName = (id) => state.config?.documentTypes?.find((type) => type.id === id)?.name ?? id;

  const { panel, refresh } = asyncPanel(
    panelHead({
      title: 'Learning memory',
      description: 'Every field a reviewer corrects is remembered for this workspace. When the extractor later proposes a value your team has already confirmed for that field, its confidence is raised, so familiar documents need less review.',
      actions: [clearMemory]
    }),
    async () => {
      const stats = await api.learningMemory(15);
      clearMemory.disabled = stats.entries === 0;
      const usage = stats.capacity > 0 ? Math.round((stats.entries / stats.capacity) * 100) : 0;
      return [
        el('div.grid.grid--kpi.admin-kpis', {}, [
          kpi({ label: 'Corrections remembered', value: formatNumber(stats.entries), hint: `Holds up to ${formatNumber(stats.capacity)}`, icon: 'brain' }),
          kpi({ label: 'Fields learned', value: formatNumber(stats.fields), hint: 'Distinct document-type fields', icon: 'target' }),
          kpi({ label: 'Memory used', value: `${usage}%`, hint: 'The oldest corrections roll off when full', icon: 'database', tone: usage >= 90 ? 'warn' : undefined })
        ]),
        el('div.grid.grid--2.admin-learning', {}, [
          card({
            title: 'Most-corrected fields',
            icon: 'target',
            flush: true,
            body: dataTable(
              [{ label: 'Document type' }, { label: 'Field' }, { label: 'Corrections', numeric: true }, { label: 'Last corrected' }],
              stats.topFields.map((field) => [typeName(field.typeId), field.label ?? field.fieldKey, formatNumber(field.corrections), relativeTime(field.lastAt)]),
              { stack: true, label: 'Most-corrected fields', emptyMessage: 'Nothing learned yet. Correct a field on any document and it appears here.' }
            )
          }),
          card({
            title: 'Recent corrections',
            icon: 'history',
            flush: true,
            body: dataTable(
              [{ label: 'When' }, { label: 'Field' }, { label: 'Changed from' }, { label: 'To' }],
              stats.recent.map((entry) => [
                el('span', { text: relativeTime(entry.at), title: formatDateTime(entry.at) }),
                el('div.admin-stack', {}, [el('span', { text: entry.label ?? entry.fieldKey }), el('span.muted', { text: typeName(entry.typeId) })]),
                el('span.admin-detail', { text: entry.fromValue == null || entry.fromValue === '' ? '(empty)' : String(entry.fromValue) }),
                el('strong.admin-detail', { text: entry.toValue == null || entry.toValue === '' ? '(empty)' : String(entry.toValue) })
              ]),
              { stack: true, label: 'Recent corrections', emptyMessage: 'No corrections yet.' }
            )
          })
        ])
      ];
    }
  );

  clearMemory.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Clear the learning memory?',
      message: 'The extractor forgets every correction taught in this workspace. Documents already processed are not changed.',
      confirmLabel: 'Clear memory'
    });
    if (!ok) return;
    const result = await busy(clearMemory, () => api.clearLearningMemory());
    if (!result) return;
    toast(`Forgot ${formatNumber(result.removed)} ${result.removed === 1 ? 'correction' : 'corrections'}.`, 'success');
    refresh();
  });

  refresh();
  return panel;
}

/* ── Workspaces (platform administrators) ────────────────────────────────── */

const WORKSPACE_FILTERS = Object.freeze([
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
  { value: '', label: 'All workspaces' }
]);

const plural = (count, one, many = `${one}s`) => `${formatNumber(count)} ${count === 1 ? one : many}`;

function workspacesPanel() {
  const status = el('select', { id: 'workspace-status' }, WORKSPACE_FILTERS.map((option) => el('option', { value: option.value, text: option.label })));
  const search = el('input', { type: 'search', autocomplete: 'off', placeholder: 'Name, contact or ID', id: 'workspace-search' });
  const summary = el('p.admin-panel__summary', { role: 'status' });
  const tableHost = el('div.admin-panel__body', {}, [loading()]);
  let items = [];
  let current = null;

  function paint() {
    const term = search.value.trim().toLowerCase();
    const visible = items.filter(
      (item) =>
        (!status.value || item.status === status.value) &&
        (!term || [item.name, item.id, item.contactName, item.contactEmail, item.businessType].some((value) => value?.toLowerCase().includes(term)))
    );
    const archived = items.filter((item) => item.status === 'archived').length;
    summary.textContent = `${formatNumber(items.length - archived)} active · ${formatNumber(archived)} archived${
      visible.length === items.length ? '' : ` · showing ${formatNumber(visible.length)}`
    }`;
    tableHost.replaceChildren(
      dataTable(
        [{ label: 'Workspace' }, { label: 'Contact' }, { label: 'Members', numeric: true }, { label: 'Created' }, { label: 'Status' }, { label: 'Actions' }],
        visible.map((item) => workspaceRow(item, { isCurrent: item.id === current, refresh: load })),
        {
          stack: true,
          label: 'Workspaces',
          emptyMessage: term || status.value ? 'No workspaces match these filters.' : 'No client workspaces yet. They appear here once created.'
        }
      )
    );
  }

  async function load() {
    try {
      const response = await api.listWorkspaces();
      items = response.items;
      current = response.current;
      paint();
    } catch (error) {
      tableHost.replaceChildren(
        emptyState('Workspaces could not be loaded', error?.message ?? 'Please try again.', button('Retry', { iconName: 'refresh', onClick: load }), 'alert')
      );
    }
  }

  status.addEventListener('change', paint);
  search.addEventListener('input', debounce(paint, 150));
  load();
  return el('section.admin-panel', {}, [
    panelHead({
      title: 'Workspaces',
      description:
        'Every client workspace on this deployment. Archiving closes a workspace: its members can no longer open it and its API keys stop working, while its documents, settings and activity log are kept until you restore it.'
    }),
    el('div.filter-bar.admin-filters', {}, [formField('Status', status), formField('Search', search)]),
    summary,
    tableHost
  ]);
}

function workspaceRow(item, { isCurrent, refresh }) {
  const archived = item.status === 'archived';
  const name = el('div.admin-stack', {}, [
    el('strong', { text: `${item.name}${isCurrent ? ' (current)' : ''}` }),
    el('span.muted', { text: item.businessType ? `${item.businessType} · ${item.id}` : item.id })
  ]);
  const contact = item.contactName || item.contactEmail
    ? el('div.admin-stack', {}, [
        item.contactName ? el('span', { text: item.contactName }) : null,
        item.contactEmail ? el('span.muted', { text: item.contactEmail }) : null
      ])
    : '—';
  const members = el('span', { text: formatNumber(item.members), title: plural(item.administrators, 'administrator') });
  const created = item.createdAt ? el('span', { text: formatDateTime(item.createdAt), title: relativeTime(item.createdAt) }) : '—';
  const badge = archived
    ? el('span.badge.badge--neutral', {
        text: 'Archived',
        title: `Archived ${formatDateTime(item.archivedAt)}${item.archivedBy ? ` by ${item.archivedBy}` : ''}`
      })
    : el('span.badge.badge--success', { text: 'Active' });
  return [name, contact, members, created, badge, archived ? restoreWorkspaceButton(item, refresh) : archiveWorkspaceButton(item, { isCurrent, refresh })];
}

/** The account menu lists workspaces from the session, so reload it after a change. */
async function refreshWorkspaceChoices() {
  try {
    await loadSession();
  } catch {
    /* the next page load refreshes it */
  }
}

function archiveWorkspaceButton(item, { isCurrent, refresh }) {
  const archive = button('Archive', { iconName: 'archive', small: true, id: `archive-${item.id}` });
  archive.setAttribute('aria-label', `Archive ${item.name}`);
  if (isCurrent) {
    archive.disabled = true;
    archive.title = 'You are working in this workspace. Switch to another workspace to archive it.';
    return archive;
  }
  archive.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: `Archive ${item.name}?`,
      message: `Its ${plural(item.members, 'member')} can no longer open it: anyone working in it moves to another workspace they belong to or is signed out, and its API keys stop working. Documents, settings and the activity log are kept, and you can restore it at any time.`,
      confirmLabel: 'Archive workspace'
    });
    if (!ok) return;
    const result = await busy(archive, () => api.archiveWorkspace(item.id));
    if (!result) return;
    const { moved, ended } = result.sessions;
    const sessions = moved + ended === 0 ? '' : ` ${plural(moved, 'session')} moved to another workspace, ${formatNumber(ended)} signed out.`;
    toast(`${item.name} was archived.${sessions}`, 'success');
    await refreshWorkspaceChoices();
    refresh();
  });
  return archive;
}

function restoreWorkspaceButton(item, refresh) {
  const restore = button('Restore', { iconName: 'restore', small: true, id: `restore-${item.id}` });
  restore.setAttribute('aria-label', `Restore ${item.name}`);
  restore.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: `Restore ${item.name}?`,
      message: 'Its members can open it again and its API keys start working again, with every document and setting as it was.',
      confirmLabel: 'Restore workspace',
      tone: 'default'
    });
    if (!ok) return;
    const result = await busy(restore, () => api.restoreWorkspace(item.id));
    if (!result) return;
    toast(`${item.name} was restored.`, 'success');
    await refreshWorkspaceChoices();
    refresh();
  });
  return restore;
}

/* ── View ────────────────────────────────────────────────────────────────── */

const PANELS = Object.freeze([
  { id: 'members', label: 'Members', render: membersPanel },
  { id: 'api-keys', label: 'API keys', render: apiKeysPanel },
  { id: 'webhooks', label: 'Webhooks', render: webhooksPanel },
  { id: 'activity', label: 'Activity log', render: activityPanel },
  { id: 'learning', label: 'Learning memory', render: learningPanel },
  { id: 'workspaces', label: 'Workspaces', render: workspacesPanel, platformOnly: true }
]);

export async function render(params = {}) {
  const node = el('div.view.admin-view');
  if (!isAdmin()) {
    node.append(
      emptyState(
        'Administrators only',
        'Ask an administrator of this workspace for access to members, API keys, webhooks and the activity log.',
        el('a.btn.btn--primary', { href: '#/dashboard', text: 'Back to the dashboard' }),
        'lock'
      )
    );
    return { node };
  }

  const panels = PANELS.filter((panel) => !panel.platformOnly || currentUser()?.platformAdmin);
  const tabs = tabGroup(panels, {
    label: 'Administration sections',
    idPrefix: 'admin-tab',
    initial: params.tab,
    onSelect: (id) => history.replaceState(null, '', `#/admin/${id}`)
  });

  node.append(
    pageHeader({
      title: 'Administration',
      subtitle: `Members, integrations and the audit trail for ${currentWorkspace()?.name ?? 'this workspace'}.`,
      icon: 'shield'
    }),
    card({ body: tabs.node, flush: true })
  );
  return { node };
}
