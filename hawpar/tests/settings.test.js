/**
 * Settings API tests: role-based edit policy, ACRA-driven timezone auto-sync,
 * SMTP secret redaction and the ACRA lookup route (network-tolerant).
 */
import assert from 'node:assert/strict';
import test, { after, before, describe } from 'node:test';
import './helpers/isolation.js';
import { createApp } from '../src/app.js';
import { initialiseSettingsStore, getSettingsRaw, updateSettings } from '../src/services/settings.service.js';
import { policyFor, timezoneForCountry } from '../src/domain/settings.js';

let server;
let baseUrl;

const get = (path, headers) => fetch(`${baseUrl}${path}`, { headers });
const patchJson = (path, body, headers) =>
  fetch(`${baseUrl}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });

before(async () => {
  await initialiseSettingsStore();
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('settings domain policy', () => {
  test('should_require_admin_for_company_and_branding_fields', () => {
    assert.equal(policyFor('company.name'), 'admin');
    assert.equal(policyFor('company.address.country'), 'admin');
    assert.equal(policyFor('branding.logoDataUrl'), 'admin');
    assert.equal(policyFor('smtp.host'), 'admin');
    assert.equal(policyFor('templates.documentFooter'), 'admin');
  });

  test('should_allow_users_to_edit_their_own_regional_display_prefs', () => {
    assert.equal(policyFor('regional.timezone'), 'user');
    assert.equal(policyFor('regional.locale'), 'user');
    assert.equal(policyFor('regional.dateFormat'), 'user');
  });

  test('should_fail_closed_for_unknown_fields', () => {
    assert.equal(policyFor('somethingNew.field'), 'admin');
  });

  test('should_map_known_countries_to_their_timezone', () => {
    assert.equal(timezoneForCountry('Singapore'), 'Asia/Singapore');
    assert.equal(timezoneForCountry('Japan'), 'Asia/Tokyo');
    assert.equal(timezoneForCountry('Nowhereland'), 'Asia/Singapore');
  });
});

describe('settings service', () => {
  test('should_reject_admin_only_edits_from_a_user_role', async () => {
    await assert.rejects(
      () => updateSettings({ company: { name: 'Hacked Inc' } }, 'user', 'tester'),
      /administrator/
    );
  });

  test('should_allow_admin_edits_and_persist_them', async () => {
    const updated = await updateSettings({ company: { phone: '+65 1234 5678' } }, 'admin', 'tester');
    assert.equal(updated.company.phone, '+65 1234 5678');
  });

  test('should_auto_sync_timezone_when_company_country_changes_and_autosync_is_on', async () => {
    await updateSettings({ regional: { autoTimezone: true } }, 'admin', 'tester');
    const updated = await updateSettings(
      { company: { address: { ...getSettingsRaw().company.address, country: 'Japan' } } },
      'admin',
      'tester'
    );
    assert.equal(updated.regional.timezone, 'Asia/Tokyo');
  });

  test('should_not_auto_sync_timezone_when_autosync_is_off', async () => {
    await updateSettings({ regional: { autoTimezone: false, timezone: 'Europe/London' } }, 'admin', 'tester');
    const updated = await updateSettings(
      { company: { address: { ...getSettingsRaw().company.address, country: 'Singapore' } } },
      'admin',
      'tester'
    );
    assert.equal(updated.regional.timezone, 'Europe/London');
  });
});

describe('settings API', () => {
  test('should_redact_the_smtp_password_for_every_role', async () => {
    await updateSettings({ smtp: { host: 'smtp.example.com', password: 'super-secret' } }, 'admin', 'tester');
    const payload = await (await get('/settings', { 'x-user-role': 'admin' })).json();
    assert.notEqual(payload.settings.smtp.password, 'super-secret');
    assert.equal(payload.settings.smtp.host, 'smtp.example.com');
  });

  test('should_report_editable_false_for_a_user_role_and_true_for_admin', async () => {
    const asUser = await (await get('/settings', { 'x-user-role': 'user' })).json();
    const asAdmin = await (await get('/settings', { 'x-user-role': 'admin' })).json();
    assert.equal(asUser.editable, false);
    assert.equal(asAdmin.editable, true);
  });

  test('should_reject_a_user_patching_an_admin_only_field_over_http', async () => {
    const response = await patchJson('/settings', { branding: { appName: 'Hacked' } }, { 'x-user-role': 'user' });
    assert.equal(response.status, 403);
  });

  test('should_allow_a_user_patching_their_own_regional_preference', async () => {
    const response = await patchJson('/settings', { regional: { locale: 'en-GB' } }, { 'x-user-role': 'user' });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.settings.regional.locale, 'en-GB');
  });

  test('should_reject_a_logo_that_is_not_a_supported_image_data_url', async () => {
    const response = await patchJson(
      '/settings',
      { branding: { logoDataUrl: 'data:text/plain;base64,aGVsbG8=' } },
      { 'x-user-role': 'admin' }
    );
    assert.equal(response.status, 400);
  });

  test('should_accept_a_well_formed_png_logo_data_url', async () => {
    const tinyPng =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const response = await patchJson('/settings', { branding: { logoDataUrl: tinyPng } }, { 'x-user-role': 'admin' });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.settings.branding.logoDataUrl, tinyPng);
    assert.ok(payload.settings.branding.logoUpdatedAt);
  });

  test('should_expose_the_iana_timezone_catalogue', async () => {
    const payload = await (await get('/settings/timezones')).json();
    assert.ok(payload.items.includes('Asia/Singapore'));
    assert.ok(payload.items.length > 50);
  });

  test('should_validate_the_acra_lookup_query_length', async () => {
    const response = await get('/settings/acra-lookup?q=a');
    assert.equal(response.status, 400);
  });

  test('should_query_the_real_acra_registry_or_fail_honestly_without_fabricating_data', async () => {
    // Network-tolerant: either a real result set comes back from data.gov.sg,
    // or the route reports a clear, honest failure — it must never invent data.
    const response = await get('/settings/acra-lookup?q=Haw Par');
    assert.ok(response.status === 200 || response.status === 400);
    const payload = await response.json();
    if (response.status === 200) {
      assert.equal(payload.query, 'Haw Par');
      assert.ok(Array.isArray(payload.candidates));
    } else {
      assert.ok(payload.error?.message?.length > 0);
    }
  });

  test('should_report_a_clear_error_when_smtp_is_not_configured', async () => {
    await updateSettings({ smtp: { host: '', port: 587 } }, 'admin', 'tester');
    const response = await fetch(`${baseUrl}/settings/smtp-test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-role': 'admin' },
      body: JSON.stringify({})
    });
    assert.equal(response.status, 400);
  });

  test('should_reject_a_non_admin_calling_the_smtp_test_endpoint', async () => {
    const response = await fetch(`${baseUrl}/settings/smtp-test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-role': 'user' },
      body: JSON.stringify({})
    });
    assert.equal(response.status, 403);
  });
});
