/**
 * Settings API: company profile, branding, regional/timezone, SMTP and
 * document template preferences — plus the ACRA UEN lookup and SMTP test
 * helpers the Settings screen calls into.
 */
import express from 'express';
import { Role } from '../domain/settings.js';
import { badRequest } from '../lib/errors.js';
import { lookupAcraEntities } from '../services/acra.service.js';
import { sendTestEmail, verifySmtpConnection } from '../services/mailer.service.js';
import { assertEditable, ensureTenantSettingsLoaded, getSettingsRaw, updateSettings } from '../services/settings.service.js';
import { redactSecrets, listTimezones, COUNTRY_TIMEZONES } from '../domain/settings.js';
import { asyncHandler } from './asyncHandler.js';

const router = express.Router();

const MAX_LOGO_DATA_URL_LENGTH = 400_000; // ~300KB decoded, plenty for a cropped header/sidebar logo.
const LOGO_DATA_URL_PATTERN = /^data:image\/(png|jpeg|jpg|webp|svg\+xml);base64,/;

/** Reads the caller's declared role. Defaults to the least-privileged role (fail closed). */
function callerRole(request) {
  const raw = String(request.get('x-user-role') ?? '').toLowerCase();
  return raw === Role.ADMIN ? Role.ADMIN : Role.USER;
}

function callerActor(request) {
  return request.get('x-user-operator') || 'demo.user@vgc.com';
}

router.get(
  '/settings',
  asyncHandler(async (request, response) => {
    await ensureTenantSettingsLoaded();
    const role = callerRole(request);
    const settings = getSettingsRaw();
    response.json({
      settings: redactSecrets(settings),
      role,
      editable: role === Role.ADMIN
    });
  })
);

router.get('/settings/timezones', (request, response) => {
  response.json({ items: listTimezones(), countries: Object.keys(COUNTRY_TIMEZONES) });
});

router.patch(
  '/settings',
  asyncHandler(async (request, response) => {
    await ensureTenantSettingsLoaded();
    const role = callerRole(request);
    const patch = request.body ?? {};

    if (patch.branding?.logoDataUrl) {
      const logo = patch.branding.logoDataUrl;
      if (!LOGO_DATA_URL_PATTERN.test(logo)) {
        throw badRequest('Logo must be a PNG, JPEG, WebP or SVG image.');
      }
      if (logo.length > MAX_LOGO_DATA_URL_LENGTH) {
        throw badRequest('Logo is too large after cropping. Try a smaller source image.');
      }
      patch.branding.logoUpdatedAt = new Date().toISOString();
    }

    const settings = await updateSettings(patch, role, callerActor(request));
    response.json({ settings: redactSecrets(settings), role, editable: role === Role.ADMIN });
  })
);

router.get(
  '/settings/acra-lookup',
  asyncHandler(async (request, response) => {
    response.json(await lookupAcraEntities(request.query.q));
  })
);

router.post(
  '/settings/smtp-test',
  asyncHandler(async (request, response) => {
    const role = callerRole(request);
    assertEditable({ smtp: 'x' }, role); // SMTP is admin-only — testing it is too.

    const settings = getSettingsRaw();
    const overrides = request.body?.smtp ?? {};
    const smtp = { ...settings.smtp, ...overrides };
    const brand = { appName: settings.branding.appName, companyName: settings.company.name };

    if (request.body?.mode === 'send' && request.body?.to) {
      response.json(await sendTestEmail(smtp, request.body.to, brand));
      return;
    }
    response.json(await verifySmtpConnection(smtp));
  })
);

export default router;
