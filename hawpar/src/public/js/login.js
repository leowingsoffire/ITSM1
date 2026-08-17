/**
 * login.js — the sign-in gate.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * IMPORTANT — this is NOT authentication.
 *
 * The platform has no user store, no session backend and no protected data:
 * every API route is open by design because this is a demonstration workspace.
 * This module is a *presentation* gate only — it sets the tone for the product
 * and gives the demo a front door. It must never be relied upon for access
 * control. When real auth is introduced it belongs on the server (Entra ID /
 * OIDC + signed session cookies), and this screen should be replaced by a
 * redirect to the identity provider.
 *
 * The passphrase is printed on the card precisely so nobody mistakes it for a
 * security boundary.
 * ────────────────────────────────────────────────────────────────────────────
 */

import { icon } from './icons.js';
import { Role, setRole } from './role.js';
import { el } from './util.js';

const SESSION_KEY = 'vgc.demo-session';
const DEMO_PASSPHRASE = 'vgc';

/** @returns {boolean} true when the visitor already passed the gate this tab session. */
export function hasSession() {
  try {
    return sessionStorage.getItem(SESSION_KEY) === 'open';
  } catch {
    // Private browsing / storage disabled — never block the demo.
    return true;
  }
}

export function clearSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* nothing to clear */
  }
}

function markSession() {
  try {
    sessionStorage.setItem(SESSION_KEY, 'open');
  } catch {
    /* storage unavailable — the gate simply won't persist */
  }
}

/** A liquid-glass text field with a leading icon. */
function liquidField({ id, label, type, placeholder, iconName, autocomplete, value = '' }) {
  const input = el('input', {
    id,
    type,
    placeholder,
    autocomplete,
    value,
    required: true
  });
  const node = el('div.auth-field', {}, [
    el('label', { for: id, text: label }),
    input,
    icon(iconName, { size: 16, className: 'auth-field__icon' })
  ]);
  return { node, input };
}

/** Product mark: the VGC monogram, matching the topbar badge. */
function brandMark() {
  return el('div.auth__mark', { 'aria-hidden': 'true' }, [el('span', { text: 'VGC' })]);
}

/**
 * Presents the welcome gate and resolves once the visitor enters.
 * Resolves immediately when a session already exists.
 * @returns {Promise<void>}
 */
export function presentLogin() {
  if (hasSession()) return Promise.resolve();

  return new Promise((resolve) => {
    const name = liquidField({
      id: 'auth-operator',
      label: 'Operator',
      type: 'text',
      placeholder: 'demo.user@vgc.com',
      iconName: 'user',
      autocomplete: 'username',
      value: 'demo.user@vgc.com'
    });

    const secret = liquidField({
      id: 'auth-passphrase',
      label: 'Workspace passphrase',
      type: 'password',
      placeholder: 'Enter the demo passphrase',
      iconName: 'lock',
      autocomplete: 'current-password'
    });

    const errorSlot = el('div');

    let selectedRole = Role.ADMIN;
    const roleButtons = el('div.auth__role', { role: 'radiogroup', 'aria-label': 'Sign in as' });
    const paintRoleButtons = () => {
      for (const button of roleButtons.querySelectorAll('button')) {
        const isActive = button.dataset.role === selectedRole;
        button.classList.toggle('is-active', isActive);
        button.setAttribute('aria-checked', String(isActive));
      }
    };
    roleButtons.append(
      el('label.auth__role-label', { text: 'Sign in as' }),
      el('div.auth__role-toggle', {}, [
        el('button', {
          type: 'button',
          role: 'radio',
          dataset: { role: Role.ADMIN },
          on: { click: () => { selectedRole = Role.ADMIN; paintRoleButtons(); } }
        }, [icon('shield', { size: 14 }), el('span', { text: 'Administrator' })]),
        el('button', {
          type: 'button',
          role: 'radio',
          dataset: { role: Role.USER },
          on: { click: () => { selectedRole = Role.USER; paintRoleButtons(); } }
        }, [icon('user', { size: 14 }), el('span', { text: 'Standard user' })])
      ])
    );
    paintRoleButtons();

    const submit = el('button.btn.btn--primary.auth__submit', { type: 'submit' }, [
      icon('sparkles', { size: 17 }),
      el('span', { text: 'Enter the workspace' })
    ]);

    const form = el('form.auth__form', {
      novalidate: true,
      on: {
        submit: (event) => {
          event.preventDefault();
          const passphrase = secret.input.value.trim().toLowerCase();
          if (passphrase !== DEMO_PASSPHRASE) {
            errorSlot.replaceChildren(
              el('p.auth__error', {
                role: 'alert',
                text: 'That passphrase does not match. The demo passphrase is shown below.'
              })
            );
            secret.input.focus();
            secret.input.select();
            return;
          }
          setRole(selectedRole);
          markSession();
          screen.classList.add('is-leaving');

          // The exit can be reported by the animation or by the fallback timer
          // (reduced motion suppresses the animation entirely) — run once.
          let finished = false;
          const finish = () => {
            if (finished) return;
            finished = true;
            screen.remove();
            resolve();
          };
          screen.addEventListener('animationend', (done) => {
            // Ignore animations bubbling up from the card and its children.
            if (done.target === screen) finish();
          });
          setTimeout(finish, 900);
        }
      }
    }, [name.node, secret.node, roleButtons, errorSlot, submit]);

    const card = el('section.auth__card', {
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'auth-title'
    }, [
      el('div.auth__brand', {}, [
        brandMark(),
        el('h1.auth__title', { id: 'auth-title', text: 'VGC OCR Intelligence' }),
        el('p.auth__subtitle', { text: 'Document Intelligence Operating System' })
      ]),
      form,
      el('p.auth__hint', {}, [
        el('span', { text: 'Demonstration workspace — no live credentials. Passphrase: ' }),
        el('code', { text: DEMO_PASSPHRASE })
      ])
    ]);

    const screen = el('div.auth', {}, [
      card,
      el('p.auth__footnote', { text: 'VGC Group · AI Document Intelligence Platform' })
    ]);

    document.body.append(screen);
    // Focus the field the visitor actually has to fill in.
    requestAnimationFrame(() => secret.input.focus());
  });
}
