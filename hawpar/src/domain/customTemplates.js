/**
 * "Template Studio" domain — customer-trained extraction templates.
 *
 * Distinct from the branding/notification "Templates" in Settings
 * (`domain/settings.js`): these are zonal extraction templates a customer
 * builds by uploading a sample document, drawing boxes over the fields they
 * care about, and (optionally) uploading their own Excel layout so future
 * extractions are exported in exactly that column order.
 */

export const TemplateFieldType = Object.freeze({
  STRING: 'string',
  NUMBER: 'number',
  CURRENCY: 'currency',
  DATE: 'date'
});

export const TEMPLATE_FIELD_TYPES = Object.freeze(Object.values(TemplateFieldType));

export const MAX_TEMPLATE_NAME_LENGTH = 120;
export const MAX_REGIONS_PER_TEMPLATE = 60;
export const MAX_RUN_FILES_PER_REQUEST = 20;

/** Metadata columns a customer's Excel template can map onto besides extracted fields. */
export const SYSTEM_COLUMN_TOKENS = Object.freeze({
  FILE_NAME: '__fileName',
  PROCESSED_AT: '__processedAt',
  PAGE_COUNT: '__pageCount',
  CONFIDENCE: '__confidence'
});

export function isValidFieldType(type) {
  return TEMPLATE_FIELD_TYPES.includes(type);
}

/**
 * Validates one drawn region.
 * @param {object} region
 * @throws {Error} message describing the first validation failure
 */
export function assertValidRegion(region, index) {
  const label = `Region ${index + 1}`;
  if (!region || typeof region !== 'object') throw new Error(`${label} is missing.`);

  const key = String(region.key ?? '').trim();
  if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key)) {
    throw new Error(`${label}: field key must be a short identifier (letters, numbers, underscore).`);
  }

  const fieldLabel = String(region.label ?? '').trim();
  if (fieldLabel.length === 0 || fieldLabel.length > 120) {
    throw new Error(`${label}: label is required (max 120 characters).`);
  }

  if (!isValidFieldType(region.type)) {
    throw new Error(`${label}: type must be one of ${TEMPLATE_FIELD_TYPES.join(', ')}.`);
  }

  const pageNumber = Number(region.pageNumber);
  if (!Number.isInteger(pageNumber) || pageNumber < 1) {
    throw new Error(`${label}: pageNumber must be a positive integer.`);
  }

  const box = region.box;
  if (!Array.isArray(box) || box.length !== 4 || box.some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
    throw new Error(`${label}: box must be [x, y, width, height] as fractions between 0 and 1.`);
  }
  const [x, y, width, height] = box;
  if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1.001 || y + height > 1.001) {
    throw new Error(`${label}: box coordinates must stay within the page (0–1 range).`);
  }

  return {
    key,
    label: fieldLabel,
    type: region.type,
    pageNumber,
    box: [x, y, width, height],
    critical: region.critical === true
  };
}

export function sanitiseTemplateName(name) {
  const trimmed = String(name ?? '').trim();
  if (trimmed.length === 0) throw new Error('Template name is required.');
  return trimmed.slice(0, MAX_TEMPLATE_NAME_LENGTH);
}
