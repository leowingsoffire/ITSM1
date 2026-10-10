/**
 * onboarding.js — the workspace creation wizard.
 *
 * Provisions an isolated workspace via `POST /api/onboarding`. Two entry
 * points share it:
 *   - self-service signup from the sign-in screen: an extra step creates the
 *     workspace administrator's account, and the server signs them in;
 *   - "Create a workspace" from the account menu for someone already signed in,
 *     who becomes the new workspace's administrator.
 */
import { api, ApiError } from './api.js';
import { icon } from './icons.js';
import { setTenantId } from './tenant.js';
import { el, toast } from './util.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const COMPANY_SIZES = Object.freeze(['1–10 employees', '11–50 employees', '51–200 employees', '201–1,000 employees', '1,000+ employees']);

const STEP_TITLES = Object.freeze({
  company: 'Tell us about your company',
  business: 'What does your business do?',
  account: 'Create your administrator account',
  review: 'Review & create your workspace'
});

/** A labelled field with consistent wizard styling. */
function field(label, inputNode, hint) {
  const hintNode = hint ? el('p.onboard-field__hint', { id: `${inputNode.id}-hint`, text: hint }) : null;
  if (hintNode) inputNode.setAttribute('aria-describedby', hintNode.id);
  return el('div.onboard-field', {}, [el('label', { for: inputNode.id, text: label }), inputNode, hintNode]);
}

function textInput({ id, placeholder, value = '', type = 'text', required = false, maxlength, autocomplete }) {
  return el('input', { id, name: id, type, placeholder, value, required, maxLength: maxlength ?? null, autocomplete: autocomplete ?? null });
}

function selectInput({ id, options, value = '', placeholder, required = false }) {
  const select = el('select', { id, name: id, required });
  if (placeholder) select.append(el('option', { value: '', text: placeholder, disabled: true, selected: !value }));
  for (const option of options) {
    const node = el('option', { value: option, text: option });
    if (option === value) node.selected = true;
    select.append(node);
  }
  return select;
}

function iconButton(className, label, iconName, { trailing = false } = {}) {
  const parts = [el('span', { text: label })];
  if (iconName) parts[trailing ? 'push' : 'unshift'](icon(iconName, { size: 16 }));
  return el(`button.btn.${className}`, { type: 'button' }, parts);
}

/**
 * Presents the wizard.
 * @param {object} [input]
 * @param {boolean} [input.requireAccount] Collect the administrator account (anonymous signup).
 * @param {number} [input.passwordMinLength]
 * @param {{name?: string, email?: string}} [input.prefill] Contact details of a signed-in user.
 * @returns {Promise<{ created: boolean, tenant?: object }>}
 */
export function presentOnboarding({ requireAccount = false, passwordMinLength = 10, prefill = {} } = {}) {
  return new Promise((resolve) => {
    const steps = requireAccount ? ['company', 'business', 'account', 'review'] : ['company', 'business', 'review'];
    const data = {
      companyName: '',
      businessType: '',
      country: 'Singapore',
      contactName: prefill.name ?? '',
      contactEmail: prefill.email ?? '',
      companySize: COMPANY_SIZES[0],
      password: ''
    };

    let stepIndex = 0;
    let businessTypes = [];
    let countries = [];
    let submitting = false;

    const screen = el('div.onboard', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'onboard-title' });
    document.body.append(screen);

    function finish(result) {
      screen.classList.add('is-leaving');
      setTimeout(() => {
        screen.remove();
        resolve(result);
      }, result.created ? 260 : 0);
    }

    async function render() {
      const step = steps[stepIndex];
      const progress = el('div.onboard-progress', {
        role: 'progressbar',
        'aria-label': 'Workspace setup progress',
        'aria-valuenow': stepIndex + 1,
        'aria-valuemin': 1,
        'aria-valuemax': steps.length
      }, steps.map((_, index) => el(`div.onboard-progress__dot${index <= stepIndex ? '.is-active' : ''}`, { 'aria-hidden': 'true' })));

      let body;
      if (step === 'company') body = await renderStepCompany();
      else if (step === 'business') body = await renderStepBusiness();
      else if (step === 'account') body = renderStepAccount();
      else body = renderStepReview();

      const leaveLink = el('button.onboard-skip', {
        type: 'button',
        id: 'onboard-cancel',
        text: requireAccount ? 'Already have an account? Sign in' : 'Cancel',
        on: { click: () => finish({ created: false }) }
      });

      const card = el('section.onboard-card', {}, [
        el('div.onboard-brand', {}, [
          icon('sparkles', { size: 22, className: 'onboard-brand__icon' }),
          el('div', {}, [
            el('h1', { id: 'onboard-title', text: 'Create your workspace' }),
            el('p', { text: `Step ${stepIndex + 1} of ${steps.length} · ${STEP_TITLES[step]}` })
          ])
        ]),
        progress,
        el('div.onboard-step', {}, [body]),
        leaveLink
      ]);

      screen.replaceChildren(card);
      requestAnimationFrame(() => card.querySelector('input, select, .onboard-actions .btn--primary')?.focus());
    }

    function goto(next) {
      stepIndex = Math.max(0, Math.min(steps.length - 1, next));
      render();
    }

    function backButton() {
      const button = iconButton('btn--ghost', 'Back', 'chevronLeft');
      button.addEventListener('click', () => goto(stepIndex - 1));
      return button;
    }

    function stepForm(children, onNext) {
      return el('form.onboard-form', {
        novalidate: true,
        on: {
          submit: (event) => {
            event.preventDefault();
            onNext();
          }
        }
      }, children);
    }

    async function renderStepCompany() {
      const nameField = textInput({ id: 'ob-company-name', placeholder: 'e.g. Acme Logistics Pte. Ltd.', value: data.companyName, required: true, maxlength: 120, autocomplete: 'organization' });
      const contactField = textInput({ id: 'ob-contact-name', placeholder: 'e.g. Jamie Tan', value: data.contactName, autocomplete: 'name' });
      const emailField = textInput({ id: 'ob-contact-email', type: 'email', placeholder: 'you@company.com', value: data.contactEmail, autocomplete: 'email' });

      if (countries.length === 0) {
        try {
          countries = (await api.onboardingCountries()).items ?? [];
        } catch {
          countries = ['Singapore'];
        }
      }
      const countryField = selectInput({ id: 'ob-country', options: countries, value: data.country });
      const errorSlot = el('p.onboard-error', { role: 'alert' });
      const nextButton = iconButton('btn--primary', 'Continue', 'chevronRight', { trailing: true });
      nextButton.type = 'submit';

      const next = () => {
        data.companyName = nameField.value.trim();
        data.country = countryField.value;
        if (!requireAccount) {
          data.contactName = contactField.value.trim();
          data.contactEmail = emailField.value.trim();
        }
        if (data.companyName.length < 2) {
          errorSlot.textContent = 'Enter your company name to continue.';
          nameField.focus();
          return;
        }
        if (!requireAccount && data.contactEmail && !EMAIL_PATTERN.test(data.contactEmail)) {
          errorSlot.textContent = 'Enter a valid contact email, or leave it blank.';
          emailField.focus();
          return;
        }
        errorSlot.textContent = '';
        goto(stepIndex + 1);
      };

      return stepForm([
        field('Company name', nameField),
        field('Registered country', countryField, 'Seeds your regional and timezone defaults. You can change it later in Settings.'),
        requireAccount
          ? null
          : el('div.onboard-form__row', {}, [
              field('Contact name', contactField, 'Optional'),
              field('Contact email', emailField, 'Optional. Used only for workspace notifications.')
            ]),
        errorSlot,
        el('div.onboard-actions', {}, [nextButton])
      ], next);
    }

    async function renderStepBusiness() {
      if (businessTypes.length === 0) {
        try {
          businessTypes = (await api.onboardingBusinessTypes()).items ?? [];
        } catch {
          businessTypes = ['Other'];
        }
      }
      const typeField = selectInput({ id: 'ob-business-type', options: businessTypes, value: data.businessType, placeholder: 'Select your industry', required: true });
      const sizeField = selectInput({ id: 'ob-company-size', options: COMPANY_SIZES, value: data.companySize });
      const errorSlot = el('p.onboard-error', { role: 'alert' });
      const nextButton = iconButton('btn--primary', 'Continue', 'chevronRight', { trailing: true });
      nextButton.type = 'submit';

      const next = () => {
        data.businessType = typeField.value;
        data.companySize = sizeField.value;
        if (!data.businessType) {
          errorSlot.textContent = 'Choose the option that best describes your business.';
          typeField.focus();
          return;
        }
        errorSlot.textContent = '';
        goto(stepIndex + 1);
      };

      return stepForm([
        field('Type of business', typeField, 'Tailors document types and workflow templates to your industry.'),
        field('Company size', sizeField),
        errorSlot,
        el('div.onboard-actions', {}, [backButton(), nextButton])
      ], next);
    }

    function renderStepAccount() {
      const nameField = textInput({ id: 'ob-account-name', placeholder: 'e.g. Jamie Tan', value: data.contactName, autocomplete: 'name' });
      const emailField = textInput({ id: 'ob-account-email', type: 'email', placeholder: 'you@company.com', value: data.contactEmail, required: true, autocomplete: 'username' });
      const passwordField = textInput({ id: 'ob-account-password', type: 'password', value: data.password, required: true, autocomplete: 'new-password' });
      const confirmField = textInput({ id: 'ob-account-confirm', type: 'password', value: data.password, required: true, autocomplete: 'new-password' });
      const errorSlot = el('p.onboard-error', { role: 'alert' });
      const nextButton = iconButton('btn--primary', 'Continue', 'chevronRight', { trailing: true });
      nextButton.type = 'submit';

      const next = () => {
        const name = nameField.value.trim();
        const email = emailField.value.trim();
        const fail = (text, input) => {
          errorSlot.textContent = text;
          input.focus();
        };
        if (name.length < 2) return fail('Enter your name.', nameField);
        if (!EMAIL_PATTERN.test(email)) return fail('Enter a valid work email address.', emailField);
        if (passwordField.value.length < passwordMinLength) return fail(`Passwords must be at least ${passwordMinLength} characters long.`, passwordField);
        if (passwordField.value.trim().toLowerCase() === email.toLowerCase()) return fail('Choose a password that is different from your email address.', passwordField);
        if (passwordField.value !== confirmField.value) return fail('The passwords do not match.', confirmField);
        data.contactName = name;
        data.contactEmail = email;
        data.password = passwordField.value;
        errorSlot.textContent = '';
        goto(stepIndex + 1);
      };

      return stepForm([
        el('p.onboard-lead', { text: 'You will be the administrator of this workspace and can invite your team once it is ready.' }),
        el('div.onboard-form__row', {}, [field('Your name', nameField), field('Work email', emailField, 'You will sign in with this address.')]),
        el('div.onboard-form__row', {}, [
          field('Password', passwordField, `At least ${passwordMinLength} characters.`),
          field('Confirm password', confirmField)
        ]),
        errorSlot,
        el('div.onboard-actions', {}, [backButton(), nextButton])
      ], next);
    }

    function renderStepReview() {
      const rows = [
        ['Company', data.companyName],
        ['Country', data.country],
        ['Business type', data.businessType],
        ['Company size', data.companySize],
        [requireAccount ? 'Administrator' : 'Contact', [data.contactName, data.contactEmail].filter(Boolean).join(' · ')]
      ].filter(([, value]) => value);
      const summary = el('dl.onboard-summary', {}, rows.flatMap(([label, value]) => [el('dt', { text: label }), el('dd', { text: value })]));

      const errorSlot = el('p.onboard-error', { role: 'alert' });
      const createButton = iconButton('btn--primary', 'Create my workspace', 'sparkles');
      createButton.id = 'onboard-create';
      createButton.addEventListener('click', async () => {
        if (submitting) return;
        submitting = true;
        createButton.disabled = true;
        createButton.setAttribute('aria-busy', 'true');
        createButton.querySelector('span').textContent = 'Provisioning your workspace…';

        try {
          const { tenant } = await api.createWorkspace({
            companyName: data.companyName,
            businessType: data.businessType,
            country: data.country,
            contactName: data.contactName || undefined,
            contactEmail: data.contactEmail || undefined,
            companySize: data.companySize,
            account: requireAccount ? { name: data.contactName, email: data.contactEmail, password: data.password } : undefined
          });
          data.password = '';
          setTenantId(tenant.id);
          toast(`Workspace created for ${tenant.companyName}.`, 'success');
          finish({ created: true, tenant });
        } catch (error) {
          submitting = false;
          createButton.disabled = false;
          createButton.removeAttribute('aria-busy');
          createButton.querySelector('span').textContent = 'Create my workspace';
          errorSlot.textContent = error instanceof ApiError
            ? error.message
            : 'Something went wrong while creating your workspace. Please try again.';
        }
      });

      return el('div', {}, [summary, errorSlot, el('div.onboard-actions', {}, [backButton(), createButton])]);
    }

    render();
  });
}
