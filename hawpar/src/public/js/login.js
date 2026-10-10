/**
 * login.js — sign-in, first-run setup and password screens.
 *
 * The server owns identity: credentials are checked there, the session lives
 * in an HttpOnly cookie, and every API route verifies it. These screens only
 * collect input and report the server's answer.
 */
import { api, ApiError } from './api.js';
import { icon } from './icons.js';
import { presentOnboarding } from './onboarding.js';
import { setTenantId } from './tenant.js';
import { appendChildren, el } from './util.js';
import { modalDialog } from './views/common.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Replaces a node's children, skipping the null placeholders of optional parts. */
function setChildren(node, ...children) {
  node.replaceChildren();
  appendChildren(node, children);
}

/** A labelled input with a leading icon; password inputs get a show/hide toggle. */
function authField({ id, label, type = 'text', placeholder = '', iconName, autocomplete, value = '', hint }) {
  const hintId = hint ? `${id}-hint` : null;
  const input = el('input', { id, name: id, type, placeholder, autocomplete, value, required: true, 'aria-describedby': hintId });
  const control = el('div.auth-field__control', {}, [input, icon(iconName, { size: 16, className: 'auth-field__icon' })]);

  if (type === 'password') {
    const reveal = el('button.auth-field__reveal', { type: 'button', 'aria-label': `Show ${label.toLowerCase()}`, 'aria-pressed': 'false' }, [icon('eye', { size: 16 })]);
    reveal.addEventListener('click', () => {
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      reveal.setAttribute('aria-pressed', String(!showing));
      reveal.setAttribute('aria-label', `${showing ? 'Show' : 'Hide'} ${label.toLowerCase()}`);
      input.focus();
    });
    control.append(reveal);
  }

  const node = el(`div.auth-field${type === 'password' ? '.auth-field--secret' : ''}`, {}, [el('label', { for: id, text: label }), control]);
  if (hint) node.append(el('p.auth-field__hint', { id: hintId, text: hint }));
  return { node, input };
}

/** Warns when Caps Lock is on while typing a password. */
function capsLockWarning(...inputs) {
  const warning = el('p.auth__caps', { role: 'status', hidden: true }, [icon('alert', { size: 13 }), el('span', { text: 'Caps Lock is on.' })]);
  const check = (event) => {
    if (typeof event.getModifierState === 'function') warning.hidden = !event.getModifierState('CapsLock');
  };
  for (const input of inputs) {
    input.addEventListener('keydown', check);
    input.addEventListener('keyup', check);
  }
  return warning;
}

function brandHeader(subtitle) {
  return el('div.auth__brand', {}, [
    el('div.auth__mark', { 'aria-hidden': 'true' }, [el('span', { text: 'VGC' })]),
    el('h1.auth__title', { id: 'auth-title', text: 'VGC OCR Intelligence' }),
    el('p.auth__subtitle', { text: subtitle })
  ]);
}

function notice(text, tone = 'info') {
  return el(`div.auth__notice.auth__notice--${tone}`, { role: tone === 'warn' ? 'alert' : 'status' }, [
    icon(tone === 'warn' ? 'alert' : 'info', { size: 15 }),
    el('span', { text })
  ]);
}

function showError(slot, error, fallback) {
  slot.replaceChildren(el('p.auth__error', { role: 'alert', text: error instanceof ApiError ? error.message : fallback }));
}

function setBusy(button, busy, label) {
  button.disabled = busy;
  button.setAttribute('aria-busy', String(busy));
  button.querySelector('span:last-child').textContent = label;
}

function mountScreen(card) {
  const screen = el('div.auth', {}, [card, el('p.auth__footnote', { text: 'VGC Group · AI Document Intelligence Platform' })]);
  document.body.append(screen);
  return screen;
}

function leave(screen) {
  return new Promise((resolve) => {
    screen.classList.add('is-leaving');
    setTimeout(() => {
      screen.remove();
      resolve();
    }, 180);
  });
}

/**
 * Presents sign-in (or first-run setup) and resolves once the server has
 * issued a session cookie.
 * @param {object} input
 * @param {object} input.options      `options` from GET /api/auth/session
 * @param {string} [input.message]    Shown above the form (e.g. session ended).
 * @returns {Promise<void>}
 */
export function presentSignIn({ options, message } = {}) {
  return new Promise((resolve) => {
    const card = el('section.auth__card', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'auth-title' });
    const screen = mountScreen(card);

    const finish = async () => {
      await leave(screen);
      resolve();
    };

    async function startSignup() {
      screen.hidden = true;
      const result = await presentOnboarding({ requireAccount: true, passwordMinLength: options.passwordMinLength });
      if (result.created) {
        screen.remove();
        resolve();
        return;
      }
      screen.hidden = false;
      paint();
    }

    function signupPrompt() {
      if (!options.selfSignup) return null;
      return el('p.auth__alt', {}, [
        el('span', { text: 'New to VGC OCR Intelligence?' }),
        el('button.auth__link', { type: 'button', id: 'auth-create-workspace', on: { click: startSignup } }, [el('span', { text: 'Create a workspace' })])
      ]);
    }

    function paintAwaiting() {
      setChildren(card, 
        brandHeader('Document Intelligence Operating System'),
        notice('No administrator account exists yet. The platform operator must set ADMIN_EMAIL and ADMIN_PASSWORD on the server, then restart it.', 'warn'),
        signupPrompt()
      );
    }

    function paintSetup() {
      const name = authField({ id: 'auth-name', label: 'Your name', iconName: 'user', autocomplete: 'name', placeholder: 'e.g. Jamie Tan' });
      name.input.required = false;
      const email = authField({ id: 'auth-email', label: 'Work email', type: 'email', iconName: 'mail', autocomplete: 'username', placeholder: 'you@company.com' });
      const password = authField({
        id: 'auth-password', label: 'Password', type: 'password', iconName: 'lock', autocomplete: 'new-password',
        hint: `At least ${options.passwordMinLength} characters.`
      });
      const confirm = authField({ id: 'auth-confirm', label: 'Confirm password', type: 'password', iconName: 'lock', autocomplete: 'new-password' });
      const errorSlot = el('div');
      const submit = el('button.btn.btn--primary.auth__submit', { type: 'submit' }, [icon('shield', { size: 16 }), el('span', { text: 'Create administrator account' })]);

      const form = el('form.auth__form', { novalidate: true, on: {
        submit: async (event) => {
          event.preventDefault();
          errorSlot.replaceChildren();
          const address = email.input.value.trim();
          if (!EMAIL_PATTERN.test(address)) {
            showError(errorSlot, new ApiError('Enter a valid email address.'), '');
            return email.input.focus();
          }
          if (password.input.value.length < options.passwordMinLength) {
            showError(errorSlot, new ApiError(`Passwords must be at least ${options.passwordMinLength} characters long.`), '');
            return password.input.focus();
          }
          if (password.input.value !== confirm.input.value) {
            showError(errorSlot, new ApiError('The passwords do not match.'), '');
            return confirm.input.focus();
          }
          setBusy(submit, true, 'Creating account…');
          try {
            const view = await api.setup({ email: address, password: password.input.value, name: name.input.value.trim() || undefined });
            setTenantId(view.workspace.id);
            await finish();
          } catch (error) {
            showError(errorSlot, error, 'Setup failed. Please try again.');
            setBusy(submit, false, 'Create administrator account');
          }
        }
      } }, [name.node, email.node, password.node, confirm.node, capsLockWarning(password.input, confirm.input), errorSlot, submit]);

      setChildren(card, 
        brandHeader('First-run setup'),
        notice('This is a new installation. The first account becomes the platform administrator, with access to every workspace.'),
        form
      );
      requestAnimationFrame(() => name.input.focus());
    }

    function paintSignIn() {
      const email = authField({ id: 'auth-email', label: 'Work email', type: 'email', iconName: 'mail', autocomplete: 'username', placeholder: 'you@company.com' });
      const password = authField({ id: 'auth-password', label: 'Password', type: 'password', iconName: 'lock', autocomplete: 'current-password' });
      const errorSlot = el('div');
      const submit = el('button.btn.btn--primary.auth__submit', { type: 'submit' }, [icon('lock', { size: 16 }), el('span', { text: 'Sign in' })]);

      const form = el('form.auth__form', { novalidate: true, on: {
        submit: async (event) => {
          event.preventDefault();
          errorSlot.replaceChildren();
          const address = email.input.value.trim();
          if (!EMAIL_PATTERN.test(address)) {
            showError(errorSlot, new ApiError('Enter the email address you sign in with.'), '');
            return email.input.focus();
          }
          if (!password.input.value) {
            showError(errorSlot, new ApiError('Enter your password.'), '');
            return password.input.focus();
          }
          setBusy(submit, true, 'Signing in…');
          try {
            await api.login({ email: address, password: password.input.value });
            await finish();
          } catch (error) {
            showError(errorSlot, error, 'Sign-in failed. Please try again.');
            setBusy(submit, false, 'Sign in');
            password.input.select();
          }
        }
      } }, [email.node, password.node, capsLockWarning(password.input), errorSlot, submit]);

      setChildren(card, 
        brandHeader('Sign in to your workspace'),
        message ? notice(message) : null,
        form,
        signupPrompt(),
        el('p.auth__hint', { text: 'Forgotten your password? Ask a workspace administrator to reset it.' })
      );
      requestAnimationFrame(() => email.input.focus());
    }

    function paint() {
      if (options.setupRequired) paintSetup();
      else if (options.awaitingAdministrator) paintAwaiting();
      else paintSignIn();
    }

    paint();
  });
}

/**
 * Builds the change-password form.
 * @returns {{ form: HTMLFormElement, focus: () => void }}
 */
function passwordForm({ forced, minLength, email, submitLabel, onDone, extraActions = [] }) {
  const current = authField({
    id: 'pw-current', label: forced ? 'Temporary password' : 'Current password', type: 'password', iconName: 'key', autocomplete: 'current-password'
  });
  const next = authField({
    id: 'pw-new', label: 'New password', type: 'password', iconName: 'lock', autocomplete: 'new-password',
    hint: `At least ${minLength} characters, and different from your email address.`
  });
  const confirm = authField({ id: 'pw-confirm', label: 'Confirm new password', type: 'password', iconName: 'lock', autocomplete: 'new-password' });
  const errorSlot = el('div');
  const submit = el('button.btn.btn--primary.auth__submit', { type: 'submit' }, [icon('check', { size: 16 }), el('span', { text: submitLabel })]);

  const form = el('form.auth__form', { novalidate: true, on: {
    submit: async (event) => {
      event.preventDefault();
      errorSlot.replaceChildren();
      const fail = (text, input) => {
        showError(errorSlot, new ApiError(text), '');
        input.focus();
      };
      if (!current.input.value) return fail(`Enter your ${forced ? 'temporary' : 'current'} password.`, current.input);
      if (next.input.value.length < minLength) return fail(`Passwords must be at least ${minLength} characters long.`, next.input);
      if (email && next.input.value.trim().toLowerCase() === email.toLowerCase()) {
        return fail('Choose a password that is different from your email address.', next.input);
      }
      if (next.input.value === current.input.value) return fail('Choose a password you have not used here before.', next.input);
      if (next.input.value !== confirm.input.value) return fail('The new passwords do not match.', confirm.input);
      setBusy(submit, true, 'Updating…');
      try {
        await api.changePassword({ currentPassword: current.input.value, newPassword: next.input.value });
        await onDone();
      } catch (error) {
        showError(errorSlot, error, 'The password could not be changed.');
        setBusy(submit, false, submitLabel);
      }
    }
  } }, [current.node, next.node, confirm.node, capsLockWarning(current.input, next.input, confirm.input), errorSlot, submit, ...extraActions]);

  return { form, focus: () => current.input.focus() };
}

/**
 * Asks for a new password. `forced` covers the first sign-in with a temporary
 * password: nothing else is reachable until it is changed. Otherwise the form
 * opens in a dismissible dialog.
 * @returns {Promise<boolean>} true when the password was changed
 */
export function presentPasswordChange({ forced = false, minLength = 10, email } = {}) {
  return new Promise((resolve) => {
    if (forced) {
      const signOut = el('button.btn.btn--ghost.auth__submit', { type: 'button', on: {
        click: async () => {
          await api.logout().catch(() => {});
          setTenantId(null);
          location.reload();
        }
      } }, [icon('logout', { size: 16 }), el('span', { text: 'Sign out' })]);
      const card = el('section.auth__card', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'auth-title' });
      const screen = mountScreen(card);
      const { form, focus } = passwordForm({
        forced, minLength, email, submitLabel: 'Update password and continue', extraActions: [signOut],
        onDone: async () => {
          await leave(screen);
          resolve(true);
        }
      });
      setChildren(card, 
        brandHeader('Choose a new password'),
        notice(`You signed in${email ? ` as ${email}` : ''} with a temporary password. Choose your own to continue.`),
        form
      );
      requestAnimationFrame(focus);
      return;
    }

    let changed = false;
    const holder = el('div');
    const modal = modalDialog({ title: 'Change password', subtitle: 'Other signed-in devices are signed out when your password changes.', content: [holder] });
    const { form } = passwordForm({
      forced, minLength, email, submitLabel: 'Change password',
      onDone: async () => {
        changed = true;
        modal.close();
      }
    });
    holder.append(form);
    modal.closed.then(() => resolve(changed));
  });
}
