/**
 * Onboarding API: the customer-facing wizard's backend.
 *
 * `POST /api/onboarding` is the only write; everything else is read-only
 * reference data the wizard's UI needs (business type catalogue). Unlike the
 * rest of the platform, these routes intentionally run *before* `tenantContext`
 * in `app.js` — there is no tenant to resolve yet, that's the whole point of
 * this endpoint.
 */
import express from 'express';
import { badRequest } from '../lib/errors.js';
import { BUSINESS_TYPES, createTenant, getTenant } from '../services/tenant.service.js';
import { seedTenantSettings } from '../services/settings.service.js';
import { COUNTRY_TIMEZONES } from '../domain/settings.js';
import { runWithTenant } from '../lib/tenantContext.js';
import { asyncHandler } from './asyncHandler.js';

const router = express.Router();

router.get('/onboarding/business-types', (request, response) => {
  response.json({ items: BUSINESS_TYPES });
});

router.get('/onboarding/countries', (request, response) => {
  response.json({ items: Object.keys(COUNTRY_TIMEZONES) });
});

/**
 * Provisions a brand-new, isolated workspace: creates the tenant record, then
 * seeds its settings document from the wizard's company profile so the
 * customer opens straight into a workspace personalised with their own
 * details instead of VGC's own demo defaults.
 */
router.post(
  '/onboarding',
  asyncHandler(async (request, response) => {
    const body = request.body ?? {};
    const companyName = String(body.companyName ?? '').trim();
    if (!companyName) throw badRequest('"companyName" is required.');

    const tenant = await createTenant({
      companyName,
      businessType: body.businessType,
      contactName: body.contactName,
      contactEmail: body.contactEmail,
      country: body.country,
      companySize: body.companySize
    });

    // Seeding writes the tenant's settings.json, which must happen with the
    // new tenant bound to the async context so it lands in the right
    // per-workspace path rather than the caller's (nonexistent) tenant.
    await runWithTenant(tenant.id, () =>
      seedTenantSettings(tenant.id, {
        name: companyName,
        address: { country: tenant.country ?? 'Singapore' }
      })
    );

    response.status(201).json({ tenant });
  })
);

/** Lightweight existence/name check — used by the client to validate a stored tenant id on load. */
router.get(
  '/onboarding/:tenantId',
  asyncHandler(async (request, response) => {
    const tenant = getTenant(request.params.tenantId);
    response.json({ tenant });
  })
);

export default router;
