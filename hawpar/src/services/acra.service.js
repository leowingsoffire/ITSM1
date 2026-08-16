/**
 * ACRA (Accounting and Corporate Regulatory Authority) UEN lookup.
 *
 * Backed by the real, free, public "ACRA Information on Corporate Entities"
 * collection on data.gov.sg (https://data.gov.sg/collections/2). The dataset
 * is split into 27 CSV resources — one per starting letter of the entity name,
 * plus "Others" for names starting with a digit/symbol — refreshed monthly by
 * ACRA. There is no live single-company API, so we resolve the correct
 * resource from the first character of the search term and run a full-text
 * `datastore_search` query against it.
 *
 * This is a genuine external integration: if data.gov.sg is unreachable (e.g.
 * no outbound internet from the runtime), lookups fail with a clear,
 * honest error rather than fabricating results.
 */
import { badRequest } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

const DATASTORE_SEARCH_URL = 'https://data.gov.sg/api/action/datastore_search';
const LOOKUP_TIMEOUT_MS = 8000;
const MAX_RESULTS = 10;

/** One data.gov.sg dataset per starting letter (resolved 2024-06 — ACRA does not rotate these ids). */
const LETTER_RESOURCE_IDS = Object.freeze({
  A: 'd_8575e84912df3c28995b8e6e0e05205a',
  B: 'd_3a3807c023c61ddfba947dc069eb53f2',
  C: 'd_c0650f23e94c42e7a20921f4c5b75c24',
  D: 'd_acbc938ec77af18f94cecc4a7c9ec720',
  E: 'd_124a9bd407c7a25f8335b93b86e50fdd',
  F: 'd_4526d47d6714d3b052eed4a30b8b1ed6',
  G: 'd_b58303c68e9cf0d2ae93b73ffdbfbfa1',
  H: 'd_fa2ed456cf2b8597bb7e064b08fc3c7c',
  I: 'd_85518d970b8178975850457f60f1e738',
  J: 'd_478f45a9c541cbe679ca55d1cd2b970b',
  K: 'd_5573b0db0575db32190a2ad27919a7aa',
  L: 'd_a2141adf93ec2a3c2ec2837b78d6d46e',
  M: 'd_9af9317c646a1c881bb5591c91817cc6',
  N: 'd_67e99e6eabc4aad9b5d48663b579746a',
  O: 'd_5c4ef48b025fdfbc80056401f06e3df9',
  P: 'd_181005ca270b45408b4cdfc954980ca2',
  Q: 'd_4130f1d9d365d9f1633536e959f62bb7',
  R: 'd_2b8c54b2a490d2fa36b925289e5d9572',
  S: 'd_df7d2d661c0c11a7c367c9ee4bf896c1',
  T: 'd_72f37e5c5d192951ddc5513c2b134482',
  U: 'd_0cc5f52a1f298b916f317800251057f3',
  V: 'd_e97e8e7fc55b85a38babf66b0fa46b73',
  W: 'd_af2042c77ffaf0db5d75561ce9ef5688',
  X: 'd_1cd970d8351b42be4a308d628a6dd9d3',
  Y: 'd_31af23fdb79119ed185c256f03cb5773',
  Z: 'd_4e3db8955fdcda6f9944097bef3d2724',
  OTHERS: 'd_300ddc8da4e8f7bdc1bfc62d0d99e2e7'
});

function resourceIdFor(query) {
  const first = String(query ?? '').trim().charAt(0).toUpperCase();
  return LETTER_RESOURCE_IDS[first] ?? LETTER_RESOURCE_IDS.OTHERS;
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Searches ACRA's public entity register for companies matching `query`.
 * @param {string} query Company name (or the start of one) — minimum 2 characters.
 * @returns {Promise<{query: string, resourceId: string, total: number, candidates: object[]}>}
 */
export async function lookupAcraEntities(query) {
  const term = String(query ?? '').trim();
  if (term.length < 2) throw badRequest('Enter at least 2 characters of the company name to search ACRA.');

  const resourceId = resourceIdFor(term);
  const url = `${DATASTORE_SEARCH_URL}?resource_id=${resourceId}&limit=${MAX_RESULTS}&q=${encodeURIComponent(term)}`;

  let response;
  try {
    response = await fetchWithTimeout(url, LOOKUP_TIMEOUT_MS);
  } catch (error) {
    logger.warn('ACRA lookup failed to reach data.gov.sg.', { error, term });
    throw badRequest(
      'Could not reach the ACRA registry (data.gov.sg). Check network/outbound internet access and try again, or enter the UEN manually.'
    );
  }

  if (!response.ok) {
    logger.warn('ACRA lookup returned a non-OK status.', { status: response.status, term });
    throw badRequest(`The ACRA registry returned an error (HTTP ${response.status}). Please try again shortly.`);
  }

  const payload = await response.json();
  const records = payload?.result?.records ?? [];

  const candidates = records
    .filter((record) => record.entity_name)
    .map((record) => ({
      uen: record.uen ?? null,
      entityName: record.entity_name,
      entityType: record.entity_type_description ?? null,
      status: record.entity_status_description ?? null,
      registeredAddress: [record.block, record.street_name].filter(Boolean).join(' ') || null,
      postalCode: record.postal_code ?? null,
      incorporationDate: record.registration_incorporation_date ?? null,
      primaryActivity: record.primary_ssic_description ?? null
    }));

  return { query: term, resourceId, total: payload?.result?.total ?? candidates.length, candidates };
}
