/**
 * Settings — compact, tabbed workspace for company profile, branding,
 * regional/timezone, SMTP and document template preferences.
 *
 * Editability is role-based (see role.js and domain/settings.js): the server
 * is the real enforcement point, this view just mirrors the same policy so
 * disabled fields are obvious rather than surprising on save.
 */
import { api } from '../api.js';
import { autoCropLogo } from '../logo-crop.js';
import { getRole, Role } from '../role.js';
import { el, formatDateTime, toast } from '../util.js';
import { icon } from '../icons.js';
import { card, pageHeader, tabGroup } from './common.js';

/** Mirrors src/domain/settings.js FIELD_POLICY so the UI can disable fields consistently. */
const ADMIN_ONLY_SECTIONS = new Set(['company', 'branding', 'smtp', 'templates']);
const USER_EDITABLE_REGIONAL = new Set(['autoTimezone', 'timezone', 'locale', 'dateFormat', 'timeFormat']);

function canEdit(section, field) {
  const role = getRole();
  if (role === Role.ADMIN) return true;
  if (section === 'regional') return USER_EDITABLE_REGIONAL.has(field);
  return !ADMIN_ONLY_SECTIONS.has(section);
}

function lockNote(section, field) {
  if (canEdit(section, field)) return null;
  return el('span.settings-field__lock', { title: 'Administrator only' }, [icon('lock', { size: 12 })]);
}

/** A single labelled input row, disabled per role policy. */
function settingsField({ section, field, label, value, type = 'text', hint, onChange, options }) {
  const editable = canEdit(section, field);
  const id = `set-${section}-${field}`;

  let input;
  if (type === 'select') {
    input = el(
      'select',
      { id, disabled: !editable, on: { change: (event) => onChange(event.target.value) } },
      (options ?? []).map((option) =>
        el('option', { value: option.value, text: option.label, selected: option.value === value })
      )
    );
  } else if (type === 'textarea') {
    input = el('textarea', {
      id,
      rows: 3,
      value,
      disabled: !editable,
      on: { change: (event) => onChange(event.target.value) }
    });
  } else if (type === 'checkbox') {
    return el('div.field', {}, [
      el('label.switch', {}, [
        el('input', {
          type: 'checkbox',
          checked: Boolean(value),
          disabled: !editable,
          on: { change: (event) => onChange(event.target.checked) }
        }),
        el('span', { text: label }),
        lockNote(section, field)
      ]),
      hint ? el('p.settings-field__hint', { text: hint }) : null
    ]);
  } else {
    input = el('input', {
      id,
      type,
      value: value ?? '',
      disabled: !editable,
      on: { change: (event) => onChange(event.target.value) }
    });
  }

  return el('div.field', {}, [
    el('label', { for: id }, [el('span', { text: label }), lockNote(section, field)]),
    input,
    hint ? el('p.settings-field__hint', { text: hint }) : null
  ]);
}

/** Company Profile tab: identity, ACRA UEN lookup, address and contact details. */
function companyPanel(model, refresh) {
  const address = model.settings.company.address;
  const acraResults = el('div.settings-acra-results');
  const acraQueryId = 'settings-acra-query';
  const acraQuery = el('input', {
    id: acraQueryId,
    type: 'text',
    placeholder: 'Search registered company name…',
    value: model.settings.company.name
  });

  async function runAcraLookup() {
    const term = acraQuery.value.trim();
    if (term.length < 2) {
      toast('Enter at least 2 characters to search ACRA.', 'warn');
      return;
    }
    acraResults.replaceChildren(el('p.settings-acra-status', { text: 'Searching the ACRA registry…' }));
    try {
      const result = await api.acraLookup(term);
      if (result.candidates.length === 0) {
        acraResults.replaceChildren(el('p.settings-acra-status', { text: `No ACRA entities matched "${term}".` }));
        return;
      }
      acraResults.replaceChildren(
        ...result.candidates.map((candidate) =>
          el('button.settings-acra-candidate', {
            type: 'button',
            on: {
              click: async () => {
                await refresh({
                  company: {
                    name: candidate.entityName,
                    legalName: candidate.entityName,
                    uen: candidate.uen ?? model.settings.company.uen
                  }
                });
                toast(`Applied ${candidate.entityName} (UEN ${candidate.uen ?? 'n/a'}).`, 'success');
              }
            }
          }, [
            el('span.settings-acra-candidate__name', { text: candidate.entityName }),
            el('span.settings-acra-candidate__meta', {
              text: [candidate.uen, candidate.status, candidate.entityType].filter(Boolean).join(' · ')
            })
          ])
        )
      );
    } catch (error) {
      acraResults.replaceChildren(el('p.settings-acra-status.settings-acra-status--error', { text: error.message }));
    }
  }

  // The field is pre-filled with the company name, so its placeholder never
  // shows: without a visible label it reads as an unexplained text box sitting
  // between the UEN and the lookup button.
  const acraSearch = el('div.settings-acra', {}, [
    el('label.settings-acra__label', { for: acraQueryId, text: 'Look up the official ACRA record' }),
    el('div.settings-acra__row', {}, [
      acraQuery,
      el('button.btn.btn--ghost.btn--sm', {
        type: 'button',
        disabled: getRole() !== Role.ADMIN,
        on: { click: runAcraLookup }
      }, [icon('search', { size: 14 }), el('span', { text: 'Auto-detect via ACRA' })])
    ]),
    acraResults
  ]);

  return el('div.settings-grid', {}, [
    card({
      title: 'Company identity',
      subtitle: 'Registered name and UEN — auto-detect UEN from the official ACRA registry (data.gov.sg).',
      icon: 'building',
      body: el('div.settings-form', {}, [
        settingsField({ section: 'company', field: 'name', label: 'Company name', value: model.settings.company.name, onChange: (value) => refresh({ company: { name: value } }) }),
        settingsField({ section: 'company', field: 'legalName', label: 'Legal / registered name', value: model.settings.company.legalName, onChange: (value) => refresh({ company: { legalName: value } }) }),
        settingsField({ section: 'company', field: 'uen', label: 'UEN', value: model.settings.company.uen, hint: 'Unique Entity Number, issued by ACRA.', onChange: (value) => refresh({ company: { uen: value } }) }),
        acraSearch
      ])
    }),
    card({
      title: 'Registered address',
      icon: 'globe',
      tone: 'teal',
      body: el('div.settings-form', {}, [
        settingsField({ section: 'company', field: 'address', label: 'Address line 1', value: address.line1, onChange: (value) => refresh({ company: { address: { ...address, line1: value } } }) }),
        settingsField({ section: 'company', field: 'address', label: 'Address line 2', value: address.line2, onChange: (value) => refresh({ company: { address: { ...address, line2: value } } }) }),
        el('div.settings-form__row', {}, [
          settingsField({ section: 'company', field: 'address', label: 'City', value: address.city, onChange: (value) => refresh({ company: { address: { ...address, city: value } } }) }),
          settingsField({ section: 'company', field: 'address', label: 'Postal code', value: address.postalCode, onChange: (value) => refresh({ company: { address: { ...address, postalCode: value } } }) })
        ]),
        settingsField({
          section: 'company', field: 'address', label: 'Country', value: address.country,
          type: 'select',
          options: model.countries.map((name) => ({ value: name, label: name })),
          hint: model.settings.regional.autoTimezone
            ? 'Timezone auto-syncs from this country while auto-sync is on (Regional tab).'
            : undefined,
          onChange: (value) => refresh({ company: { address: { ...address, country: value } } })
        })
      ])
    }),
    card({
      title: 'Contact details',
      icon: 'mail',
      tone: 'amber',
      body: el('div.settings-form', {}, [
        settingsField({ section: 'company', field: 'phone', label: 'Phone', value: model.settings.company.phone, onChange: (value) => refresh({ company: { phone: value } }) }),
        settingsField({ section: 'company', field: 'email', label: 'Email', type: 'email', value: model.settings.company.email, onChange: (value) => refresh({ company: { email: value } }) }),
        settingsField({ section: 'company', field: 'website', label: 'Website', value: model.settings.company.website, onChange: (value) => refresh({ company: { website: value } }) })
      ])
    })
  ]);
}

/** Branding tab: app name and an auto-cropped, auto-fit logo. */
function brandingPanel(model, refresh) {
  const preview = el('div.logo-preview', {}, [
    model.settings.branding.logoDataUrl
      ? el('img', { src: model.settings.branding.logoDataUrl, alt: 'Current logo' })
      : el('span.logo-preview__placeholder', {}, [icon('image', { size: 22 })])
  ]);

  const status = el('p.settings-field__hint', {
    text: model.settings.branding.logoUpdatedAt
      ? `Last updated ${formatDateTime(model.settings.branding.logoUpdatedAt)}`
      : 'No logo uploaded yet — the app name is shown instead.'
  });

  const fileInput = el('input', {
    type: 'file',
    accept: 'image/png,image/jpeg,image/webp,image/svg+xml',
    disabled: getRole() !== Role.ADMIN,
    on: {
      change: async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        try {
          const { dataUrl } = await autoCropLogo(file);
          preview.replaceChildren(el('img', { src: dataUrl, alt: 'Cropped logo preview' }));
          await refresh({ branding: { logoDataUrl: dataUrl } });
          status.textContent = `Last updated ${formatDateTime(new Date().toISOString())}`;
          removeButton.disabled = getRole() !== Role.ADMIN;
          toast('Logo auto-cropped and applied.', 'success');
        } catch (error) {
          toast(error.message, 'error');
        } finally {
          event.target.value = '';
        }
      }
    }
  });

  const dropzone = el('label.settings-dropzone', {}, [
    icon('upload', { size: 18 }),
    el('span', { text: 'Drop a logo here or click to choose a file' }),
    el('span.settings-dropzone__hint', { text: 'PNG, JPEG, WebP or SVG — auto-cropped and centred automatically.' }),
    fileInput
  ]);
  dropzone.addEventListener('dragover', (event) => {
    event.preventDefault();
    dropzone.classList.add('is-dragging');
  });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-dragging'));
  dropzone.addEventListener('drop', (event) => {
    event.preventDefault();
    dropzone.classList.remove('is-dragging');
    const file = event.dataTransfer?.files?.[0];
    if (file) {
      const transfer = new DataTransfer();
      transfer.items.add(file);
      fileInput.files = transfer.files;
      fileInput.dispatchEvent(new Event('change'));
    }
  });

  const removeButton = el('button.btn.btn--ghost.btn--sm', {
    type: 'button',
    disabled: getRole() !== Role.ADMIN || !model.settings.branding.logoDataUrl,
    on: {
      click: async () => {
        preview.replaceChildren(el('span.logo-preview__placeholder', {}, [icon('image', { size: 22 })]));
        await refresh({ branding: { logoDataUrl: null } });
        status.textContent = 'No logo uploaded yet — the app name is shown instead.';
        removeButton.disabled = true;
        toast('Logo removed.', 'success');
      }
    }
  }, [icon('close', { size: 13 }), el('span', { text: 'Remove logo' })]);

  return el('div.settings-grid', {}, [
    card({
      title: 'App name',
      icon: 'sparkles',
      body: el('div.settings-form', {}, [
        settingsField({ section: 'branding', field: 'appName', label: 'Application name', value: model.settings.branding.appName, hint: 'Shown in the topbar, browser tab and emails.', onChange: (value) => refresh({ branding: { appName: value } }) })
      ])
    }),
    card({
      title: 'Logo',
      subtitle: 'Auto-crops transparent/white margins and fits the logo into a square badge.',
      icon: 'image',
      tone: 'violet',
      body: el('div.logo-editor', {}, [preview, el('div.logo-editor__controls', {}, [dropzone, status, removeButton])])
    })
  ]);
}

/** Regional & Timezone tab: personal display preferences, auto-synced from the company address. */
function regionalPanel(model, refresh) {
  const regional = model.settings.regional;
  return el('div.settings-grid', {}, [
    card({
      title: 'Timezone',
      icon: 'clock',
      body: el('div.settings-form', {}, [
        settingsField({
          section: 'regional', field: 'autoTimezone', type: 'checkbox',
          label: 'Auto-sync timezone from company address',
          value: regional.autoTimezone,
          hint: `Currently resolves to ${regional.timezone} from ${model.settings.company.address.country}.`,
          onChange: (value) => refresh({ regional: { autoTimezone: value } })
        }),
        settingsField({
          section: 'regional', field: 'timezone', label: 'Timezone', type: 'select',
          value: regional.timezone,
          hint: regional.autoTimezone ? 'Turn off auto-sync to choose a timezone manually.' : undefined,
          options: model.timezones.map((tz) => ({ value: tz, label: tz })),
          onChange: (value) => refresh({ regional: { timezone: value, autoTimezone: false } })
        })
      ])
    }),
    card({
      title: 'Locale & formatting',
      icon: 'globe',
      tone: 'teal',
      body: el('div.settings-form', {}, [
        settingsField({ section: 'regional', field: 'locale', label: 'Locale', value: regional.locale, hint: 'e.g. en-SG, en-GB, en-US', onChange: (value) => refresh({ regional: { locale: value } }) }),
        settingsField({
          section: 'regional', field: 'dateFormat', label: 'Date format', type: 'select', value: regional.dateFormat,
          options: ['DD MMM YYYY', 'MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD'].map((f) => ({ value: f, label: f })),
          onChange: (value) => refresh({ regional: { dateFormat: value } })
        }),
        settingsField({
          section: 'regional', field: 'timeFormat', label: 'Time format', type: 'select', value: regional.timeFormat,
          options: [{ value: '24h', label: '24-hour' }, { value: '12h', label: '12-hour (AM/PM)' }],
          onChange: (value) => refresh({ regional: { timeFormat: value } })
        }),
        settingsField({ section: 'regional', field: 'currency', label: 'Currency', value: regional.currency, hint: 'ISO 4217 code, e.g. SGD, USD.', onChange: (value) => refresh({ regional: { currency: value } }) })
      ])
    })
  ]);
}

/** Email (SMTP) tab — admin-only; shown to standard users disabled, not hidden. */
function smtpPanel(model, refresh) {
  const smtp = model.settings.smtp;
  const testAddress = el('input', { id: 'smtp-test-address', type: 'email', placeholder: 'you@company.com', disabled: getRole() !== Role.ADMIN });
  const statusHost = el('div.settings-smtp-status');

  async function runTest(mode) {
    statusHost.replaceChildren(el('p.settings-acra-status', { text: mode === 'send' ? 'Sending test email…' : 'Verifying connection…' }));
    try {
      const body = mode === 'send' ? { mode: 'send', to: testAddress.value.trim() } : { mode: 'verify' };
      const result = await api.smtpTest(body);
      statusHost.replaceChildren(
        el('p.settings-acra-status', { text: mode === 'send' ? `Test email sent (${result.messageId}).` : 'Connection verified successfully.' })
      );
      toast('SMTP check succeeded.', 'success');
    } catch (error) {
      statusHost.replaceChildren(el('p.settings-acra-status.settings-acra-status--error', { text: error.message }));
    }
  }

  return el('div.settings-grid', {}, [
    card({
      title: 'SMTP server',
      subtitle: getRole() === Role.ADMIN ? 'Used to send workflow and review notifications.' : 'Managed by an administrator.',
      icon: 'mail',
      body: el('div.settings-form', {}, [
        settingsField({ section: 'smtp', field: 'enabled', type: 'checkbox', label: 'Enable outgoing email', value: smtp.enabled, onChange: (value) => refresh({ smtp: { enabled: value } }) }),
        el('div.settings-form__row', {}, [
          settingsField({ section: 'smtp', field: 'host', label: 'SMTP host', value: smtp.host, onChange: (value) => refresh({ smtp: { host: value } }) }),
          settingsField({ section: 'smtp', field: 'port', label: 'Port', type: 'number', value: smtp.port, onChange: (value) => refresh({ smtp: { port: Number(value) } }) })
        ]),
        settingsField({ section: 'smtp', field: 'secure', type: 'checkbox', label: 'Use TLS (implicit, port 465)', value: smtp.secure, onChange: (value) => refresh({ smtp: { secure: value } }) }),
        settingsField({ section: 'smtp', field: 'username', label: 'Username', value: smtp.username, onChange: (value) => refresh({ smtp: { username: value } }) }),
        settingsField({ section: 'smtp', field: 'password', label: 'Password', type: 'password', value: smtp.password, hint: 'Stored server-side only; never shown in full once saved.', onChange: (value) => refresh({ smtp: { password: value } }) }),
        el('div.settings-form__row', {}, [
          settingsField({ section: 'smtp', field: 'fromName', label: 'From name', value: smtp.fromName, onChange: (value) => refresh({ smtp: { fromName: value } }) }),
          settingsField({ section: 'smtp', field: 'fromEmail', label: 'From email', type: 'email', value: smtp.fromEmail, onChange: (value) => refresh({ smtp: { fromEmail: value } }) })
        ]),
        settingsField({ section: 'smtp', field: 'replyTo', label: 'Reply-to (optional)', type: 'email', value: smtp.replyTo, onChange: (value) => refresh({ smtp: { replyTo: value } }) })
      ])
    }),
    card({
      title: 'Test this configuration',
      icon: 'sparkles',
      tone: 'amber',
      body: el('div.settings-form', {}, [
        el('button.btn.btn--ghost.btn--sm', { type: 'button', disabled: getRole() !== Role.ADMIN, on: { click: () => runTest('verify') } }, [icon('checkCircle', { size: 14 }), el('span', { text: 'Verify connection' })]),
        el('div.field', {}, [el('label', { for: 'smtp-test-address', text: 'Send a test email to' }), testAddress]),
        el('button.btn.btn--primary.btn--sm', { type: 'button', disabled: getRole() !== Role.ADMIN, on: { click: () => runTest('send') } }, [icon('send', { size: 14 }), el('span', { text: 'Send test email' })]),
        statusHost
      ])
    })
  ]);
}

/** Templates tab — org-wide document/email formatting, admin-only. */
function templatesPanel(model, refresh) {
  const templates = model.settings.templates;
  return el('div.settings-grid', {}, [
    card({
      title: 'Document formatting',
      icon: 'documents',
      body: el('div.settings-form', {}, [
        settingsField({ section: 'templates', field: 'documentHeader', label: 'Document header', type: 'textarea', value: templates.documentHeader, onChange: (value) => refresh({ templates: { documentHeader: value } }) }),
        settingsField({ section: 'templates', field: 'documentFooter', label: 'Document footer', type: 'textarea', value: templates.documentFooter, onChange: (value) => refresh({ templates: { documentFooter: value } }) }),
        el('div.settings-form__row', {}, [
          settingsField({ section: 'templates', field: 'invoiceNumberPrefix', label: 'Invoice number prefix', value: templates.invoiceNumberPrefix, onChange: (value) => refresh({ templates: { invoiceNumberPrefix: value } }) }),
          settingsField({ section: 'templates', field: 'numberFormat', label: 'Number format', value: templates.numberFormat, onChange: (value) => refresh({ templates: { numberFormat: value } }) })
        ])
      ])
    }),
    card({
      title: 'Email signature',
      icon: 'mail',
      tone: 'violet',
      body: el('div.settings-form', {}, [
        settingsField({ section: 'templates', field: 'emailSignature', label: 'Signature', type: 'textarea', value: templates.emailSignature, onChange: (value) => refresh({ templates: { emailSignature: value } }) }),
        el('p.settings-field__hint', { text: 'Placeholders: {{companyName}}, {{appName}}, {{date}}, {{companyPhone}}, {{companyEmail}}.' })
      ])
    })
  ]);
}

export async function render() {
  const node = el('div.view');
  const role = getRole();

  const [settingsResponse, timezoneResponse] = await Promise.all([api.getSettings(), api.listTimezones()]);
  const model = {
    settings: settingsResponse.settings,
    timezones: timezoneResponse.items,
    countries: timezoneResponse.countries
  };

  const saveIndicator = el('span.settings-save-indicator');
  let saveTimer = null;

  /** Debounced PATCH so rapid keystrokes coalesce into one save. */
  async function refresh(patch) {
    model.settings = {
      ...model.settings,
      ...patch,
      company: { ...model.settings.company, ...patch.company },
      regional: { ...model.settings.regional, ...patch.regional },
      branding: { ...model.settings.branding, ...patch.branding },
      smtp: { ...model.settings.smtp, ...patch.smtp },
      templates: { ...model.settings.templates, ...patch.templates }
    };
    clearTimeout(saveTimer);
    saveIndicator.textContent = 'Saving…';
    return new Promise((resolve) => {
      saveTimer = setTimeout(async () => {
        try {
          const result = await api.updateSettings(patch);
          model.settings = result.settings;
          saveIndicator.textContent = `Saved ${new Date().toLocaleTimeString('en-SG', { hour12: false })}`;
          window.dispatchEvent(new CustomEvent('vgc:settings-updated', { detail: result.settings }));
        } catch (error) {
          saveIndicator.textContent = '';
          toast(error.message ?? 'Could not save settings.', 'error');
        }
        resolve();
      }, 260);
    });
  }

  const panels = [
    { id: 'company', label: 'Company profile', render: () => companyPanel(model, refresh) },
    { id: 'branding', label: 'Branding', render: () => brandingPanel(model, refresh) },
    { id: 'regional', label: 'Regional & timezone', render: () => regionalPanel(model, refresh) },
    { id: 'smtp', label: 'Email (SMTP)', render: () => smtpPanel(model, refresh) },
    { id: 'templates', label: 'Templates', render: () => templatesPanel(model, refresh) }
  ];

  const settingsTabs = tabGroup(panels, { label: 'Settings sections', idPrefix: 'settings-tab' });

  node.append(
    pageHeader({
      title: 'Settings',
      subtitle: 'Company profile, branding, regional preferences, SMTP and document templates — organised for quick edits.',
      icon: 'settings',
      actions: [
        el(`span.badge.badge--${role === Role.ADMIN ? 'success' : 'info'}`, {}, [
          icon(role === Role.ADMIN ? 'shield' : 'user', { size: 12 }),
          el('span', { text: role === Role.ADMIN ? 'Administrator view' : 'Standard user view' })
        ]),
        saveIndicator
      ]
    }),
    card({ body: settingsTabs.node, flush: true })
  );

  return { node };
}
