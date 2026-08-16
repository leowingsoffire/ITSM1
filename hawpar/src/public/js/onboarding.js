/**
 * onboarding.js — the customer onboarding wizard.
 *
 * A three-step form (company profile → business type & scale → review) that
 * provisions a brand-new, isolated workspace via `POST /api/onboarding`. On
 * success the returned tenant id is persisted client-side (see `tenant.js`)
 * and sent as `x-tenant-id` on every subsequent API call, so this customer's
 * settings/branding/documents are scoped away from every other workspace —
 * including the shared "default" demo workspace pre-existing visitors land in.
 *
 * Presented *before* the passphrase gate for first-time visitors who have not
 * yet created (or restored) a workspace; existing workspaces skip straight to
 * the passphrase gate. This keeps the wizard purely additive: nothing about
 * the original single-tenant demo flow changes for anyone who already has a
 * workspace (or never uses onboarding at all).
 */
import { icon } from './icons.js';
import { api, ApiError } from './api.js';
import { setTenant, rememberSharedWorkspace } from './tenant.js';
import { el, toast } from './util.js';

const TOTAL_STEPS = 3;

const STEP_TITLES = Object.freeze([
  'Tell us about your company',
  'What does your business do?',
  'Review & create your workspace'
]);

/** A labelled text/select field with consistent wizard styling. */
function field(label, inputNode, hint) {
  return el('div.onboard-field', {}, [
    el('label', { text: label }),
    inputNode,
    hint ? el('p.onboard-field__hint', { text: hint }) : null
  ]);
}

function textInput({ id, placeholder, value = '', type = 'text', required = false, maxlength }) {
  return el('input', { id, type, placeholder, value, required, maxlength: maxlength ?? null });
}

function selectInput({ id, options, value = '', placeholder, required = false }) {
  const select = el('select', { id, required });
  if (placeholder) select.append(el('option', { value: '', text: placeholder, disabled: true, selected: !value }));
  for (const option of options) {
    const node = el('option', { value: option, text: option });
    if (option === value) node.selected = true;
    select.append(node);
  }
  return select;
}

const COMPANY_SIZES = Object.freeze(['1–10 employees', '11–50 employees', '51–200 employees', '201–1,000 employees', '1,000+ employees']);

/**
 * Presents the onboarding wizard and resolves once a workspace has been
 * created (or the visitor opts to sign in to the shared demo instead).
 * @returns {Promise<{ skipped: boolean }>}
 */
export function presentOnboarding() {
  return new Promise((resolve) => {
    const data = {
      companyName: '',
      businessType: '',
      country: 'Singapore',
      contactName: '',
      contactEmail: '',
      companySize: COMPANY_SIZES[0]
    };

    let step = 0;
    let businessTypes = [];
    let countries = [];
    let submitting = false;

    const screen = el('div.onboard', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'onboard-title' });
    document.body.append(screen);

    function finish(skipped) {
      screen.classList.add('is-leaving');
      setTimeout(() => {
        screen.remove();
        resolve({ skipped });
      }, skipped ? 0 : 260);
    }

    async function render() {
      const stepIndex = step;
      const progress = el('div.onboard-progress', { role: 'progressbar', 'aria-valuenow': stepIndex + 1, 'aria-valuemin': 1, 'aria-valuemax': TOTAL_STEPS },
        Array.from({ length: TOTAL_STEPS }, (_, index) =>
          el(`div.onboard-progress__dot${index <= stepIndex ? '.is-active' : ''}`, { 'aria-hidden': 'true' })
        )
      );

      const body = el('div.onboard-step');
      if (stepIndex === 0) body.append(await renderStepCompany());
      else if (stepIndex === 1) body.append(await renderStepBusiness());
      else body.append(renderStepReview());

      const skipLink = el('button.onboard-skip', { type: 'button', text: 'Sign in to the shared demo workspace instead' , on: { click: () => { rememberSharedWorkspace(); finish(true); } } });

      const card = el('section.onboard-card', {}, [
        el('div.onboard-brand', {}, [
          icon('sparkles', { size: 22, className: 'onboard-brand__icon' }),
          el('div', {}, [
            el('h1', { id: 'onboard-title', text: 'Create your workspace' }),
            el('p', { text: `Step ${stepIndex + 1} of ${TOTAL_STEPS} · ${STEP_TITLES[stepIndex]}` })
          ])
        ]),
        progress,
        body,
        skipLink
      ]);

      clearScreen();
      screen.append(card);
      requestAnimationFrame(() => card.querySelector('input, select, button.btn--primary')?.focus());
    }

    function clearScreen() {
      while (screen.firstChild) screen.removeChild(screen.firstChild);
    }

    function goto(next) {
      step = Math.max(0, Math.min(TOTAL_STEPS - 1, next));
      render();
    }

    async function renderStepCompany() {
      const nameField = textInput({ id: 'ob-company-name', placeholder: 'e.g. Acme Logistics Pte. Ltd.', value: data.companyName, required: true, maxlength: 160 });
      const contactField = textInput({ id: 'ob-contact-name', placeholder: 'e.g. Jamie Tan', value: data.contactName });
      const emailField = textInput({ id: 'ob-contact-email', type: 'email', placeholder: 'you@company.com', value: data.contactEmail });

      if (countries.length === 0) {
        try {
          const result = await api.onboardingCountries();
          countries = result.items ?? [];
        } catch {
          countries = ['Singapore'];
        }
      }
      const countryField = selectInput({ id: 'ob-country', options: countries, value: data.country });

      const errorSlot = el('p.onboard-error', { role: 'alert' });

      const nextButton = el('button.btn.btn--primary', { type: 'button', text: 'Continue' }, [el('span', { text: 'Continue' }), icon('chevronRight', { size: 16 })]);
      nextButton.textContent = '';
      nextButton.append(el('span', { text: 'Continue' }), icon('chevronRight', { size: 16 }));
      nextButton.addEventListener('click', () => {
        data.companyName = nameField.value.trim();
        data.contactName = contactField.value.trim();
        data.contactEmail = emailField.value.trim();
        data.country = countryField.value;

        if (data.companyName.length < 2) {
          errorSlot.textContent = 'Enter your company name to continue.';
          nameField.focus();
          return;
        }
        if (data.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.contactEmail)) {
          errorSlot.textContent = 'Enter a valid contact email, or leave it blank.';
          emailField.focus();
          return;
        }
        errorSlot.textContent = '';
        goto(step + 1);
      });

      return el('form.onboard-form', { novalidate: true, on: { submit: (event) => event.preventDefault() } }, [
        field('Company name', nameField),
        field('Registered country', countryField, 'Used to seed your regional and timezone defaults — you can change this later in Settings.'),
        el('div.onboard-form__row', {}, [
          field('Your name', contactField, 'Optional'),
          field('Work email', emailField, 'Optional — used only for workspace notifications, never shared.')
        ]),
        errorSlot,
        el('div.onboard-actions', {}, [nextButton])
      ]);
    }

    async function renderStepBusiness() {
      if (businessTypes.length === 0) {
        try {
          const result = await api.onboardingBusinessTypes();
          businessTypes = result.items ?? [];
        } catch {
          businessTypes = ['Other'];
        }
      }
      const typeField = selectInput({ id: 'ob-business-type', options: businessTypes, value: data.businessType, placeholder: 'Select your industry' });
      const sizeField = selectInput({ id: 'ob-company-size', options: COMPANY_SIZES, value: data.companySize });

      const errorSlot = el('p.onboard-error', { role: 'alert' });

      const backButton = el('button.btn.btn--ghost', { type: 'button' }, [icon('chevronLeft', { size: 16 }), el('span', { text: 'Back' })]);
      backButton.addEventListener('click', () => goto(step - 1));

      const nextButton = el('button.btn.btn--primary', { type: 'button' }, [el('span', { text: 'Continue' }), icon('chevronRight', { size: 16 })]);
      nextButton.addEventListener('click', () => {
        data.businessType = typeField.value;
        data.companySize = sizeField.value;
        if (!data.businessType) {
          errorSlot.textContent = 'Choose the option that best describes your business.';
          return;
        }
        errorSlot.textContent = '';
        goto(step + 1);
      });

      return el('form.onboard-form', { novalidate: true, on: { submit: (event) => event.preventDefault() } }, [
        field('Type of business', typeField, 'Helps us tailor document types and workflow templates to your industry.'),
        field('Company size', sizeField),
        errorSlot,
        el('div.onboard-actions', {}, [backButton, nextButton])
      ]);
    }

    function renderStepReview() {
      const summary = el('dl.onboard-summary', {}, [
        el('dt', { text: 'Company' }), el('dd', { text: data.companyName }),
        el('dt', { text: 'Country' }), el('dd', { text: data.country }),
        el('dt', { text: 'Business type' }), el('dd', { text: data.businessType }),
        el('dt', { text: 'Company size' }), el('dd', { text: data.companySize }),
        data.contactName ? el('dt', { text: 'Contact' }) : null,
        data.contactName ? el('dd', { text: data.contactName }) : null,
        data.contactEmail ? el('dt', { text: 'Email' }) : null,
        data.contactEmail ? el('dd', { text: data.contactEmail }) : null
      ]);

      const errorSlot = el('p.onboard-error', { role: 'alert' });

      const backButton = el('button.btn.btn--ghost', { type: 'button' }, [icon('chevronLeft', { size: 16 }), el('span', { text: 'Back' })]);
      backButton.addEventListener('click', () => goto(step - 1));

      const createButton = el('button.btn.btn--primary', { type: 'button' }, [icon('sparkles', { size: 16 }), el('span', { text: 'Create my workspace' })]);
      createButton.addEventListener('click', async () => {
        if (submitting) return;
        submitting = true;
        createButton.disabled = true;
        createButton.textContent = '';
        createButton.append(el('span', { text: 'Provisioning your workspace…' }));

        try {
          const { tenant } = await api.createWorkspace({
            companyName: data.companyName,
            businessType: data.businessType,
            country: data.country,
            contactName: data.contactName || undefined,
            contactEmail: data.contactEmail || undefined,
            companySize: data.companySize
          });
          setTenant(tenant.id, { companyName: tenant.companyName, businessType: tenant.businessType });
          toast(`Workspace created for ${tenant.companyName}.`, 'success');
          finish(false);
        } catch (error) {
          submitting = false;
          createButton.disabled = false;
          createButton.textContent = '';
          createButton.append(icon('sparkles', { size: 16 }), el('span', { text: 'Create my workspace' }));
          errorSlot.textContent = error instanceof ApiError
            ? error.message
            : 'Something went wrong while creating your workspace. Please try again.';
        }
      });

      return el('div', {}, [
        summary,
        errorSlot,
        el('div.onboard-actions', {}, [backButton, createButton])
      ]);
    }

    render();
  });
}
