/**
 * Reference data used by the demo engine to synthesise realistic Haw Par documents.
 * Kept separate from generation logic so business users can review/extend it easily.
 */

export const GROUP_ENTITIES = Object.freeze([
  'Haw Par Corporation Limited',
  'Haw Par Healthcare Limited',
  'Haw Par Tiger Balm Sdn Bhd',
  'Haw Par Leisure Pte Ltd',
  'Haw Par Properties (Singapore) Pte Ltd',
  'Haw Par Trademark Holdings Pte Ltd',
  'Haw Par Equities Pte Ltd'
]);

export const SUPPLIERS = Object.freeze([
  { name: 'Sinar Mas Packaging Pte Ltd', uen: '199203441K', country: 'Singapore' },
  { name: 'Nippon Menthol Kogyo K.K.', uen: 'JP4010001034552', country: 'Japan' },
  { name: 'Guangzhou Herbal Extracts Co. Ltd', uen: '91440101MA5CQ2R3XL', country: 'China' },
  { name: 'Straits Logistics & Warehousing Pte Ltd', uen: '200812339E', country: 'Singapore' },
  { name: 'Kimball Print Solutions Sdn Bhd', uen: '199701008431', country: 'Malaysia' },
  { name: 'Camphor & Essential Oils (Thailand) Ltd', uen: '0105542089931', country: 'Thailand' },
  { name: 'Ascend Facility Services Pte Ltd', uen: '201533981C', country: 'Singapore' },
  { name: 'Bright Aluminium Tubes Industries Pte Ltd', uen: '198703441M', country: 'Singapore' }
]);

export const PRODUCTS = Object.freeze([
  { name: 'Tiger Balm White Ointment 19g', sku: 'TB-WO-019', uom: 'JAR' },
  { name: 'Tiger Balm Red Ointment 30g', sku: 'TB-RO-030', uom: 'JAR' },
  { name: 'Tiger Balm Neck & Shoulder Rub 50g', sku: 'TB-NS-050', uom: 'TUBE' },
  { name: 'Tiger Balm Medicated Plaster (Cool) 10s', sku: 'TB-MP-C10', uom: 'PACK' },
  { name: 'Tiger Balm Mosquito Repellent Patch 10s', sku: 'TB-MR-P10', uom: 'PACK' },
  { name: 'Tiger Balm Active Muscle Rub 60g', sku: 'TB-AM-060', uom: 'TUBE' },
  { name: 'Tiger Balm Joint Rub 50g', sku: 'TB-JR-050', uom: 'TUBE' },
  { name: 'Kwan Loong Medicated Oil 57ml', sku: 'KL-MO-057', uom: 'BOTTLE' }
]);

export const RAW_MATERIALS = Object.freeze([
  { name: 'Menthol Crystals USP', sku: 'RM-MEN-001', uom: 'KG' },
  { name: 'Camphor Powder BP', sku: 'RM-CAM-004', uom: 'KG' },
  { name: 'Cajuput Oil', sku: 'RM-CAJ-002', uom: 'LTR' },
  { name: 'Clove Bud Oil', sku: 'RM-CLV-003', uom: 'LTR' },
  { name: 'Paraffin Wax (Pharma Grade)', sku: 'RM-PAR-011', uom: 'KG' },
  { name: 'Aluminium Collapsible Tube 50g', sku: 'PK-ALU-050', uom: 'PCS' },
  { name: 'Printed Carton 19g Hexagonal', sku: 'PK-CTN-019', uom: 'PCS' }
]);

export const QC_TESTS = Object.freeze([
  { test: 'Appearance', spec: 'Off-white translucent ointment', method: 'Visual' },
  { test: 'Menthol Content', spec: '8.0 – 12.0 % w/w', method: 'GC-FID', numeric: [8, 12], unit: '% w/w' },
  { test: 'Camphor Content', spec: '10.0 – 13.0 % w/w', method: 'GC-FID', numeric: [10, 13], unit: '% w/w' },
  { test: 'Melting Point', spec: '48 – 56 °C', method: 'USP <741>', numeric: [48, 56], unit: '°C' },
  { test: 'Fill Weight', spec: '19.0 – 20.5 g', method: 'Gravimetric', numeric: [19, 20.5], unit: 'g' },
  { test: 'Total Aerobic Count', spec: 'NMT 100 cfu/g', method: 'USP <61>', numeric: [0, 60], unit: 'cfu/g' },
  { test: 'Heavy Metals (Pb)', spec: 'NMT 10 ppm', method: 'ICP-MS', numeric: [0, 6], unit: 'ppm' },
  { test: 'Leak Test', spec: 'No leakage', method: 'Vacuum 15 min' }
]);

export const PORTS = Object.freeze([
  'SGSIN Singapore',
  'MYPKG Port Klang',
  'HKHKG Hong Kong',
  'USLAX Los Angeles',
  'NLRTM Rotterdam',
  'AEJEA Jebel Ali',
  'INNSA Nhava Sheva',
  'JPYOK Yokohama'
]);

export const MARKETS = Object.freeze([
  'Singapore',
  'Malaysia',
  'Indonesia',
  'Thailand',
  'Vietnam',
  'Hong Kong SAR',
  'United Kingdom',
  'United States',
  'India',
  'Australia'
]);

export const REGULATORS = Object.freeze({
  Singapore: 'Health Sciences Authority (HSA)',
  Malaysia: 'National Pharmaceutical Regulatory Agency (NPRA)',
  Indonesia: 'Badan POM',
  Thailand: 'Thai FDA',
  Vietnam: 'Drug Administration of Vietnam',
  'Hong Kong SAR': 'Department of Health',
  'United Kingdom': 'MHRA',
  'United States': 'US Food and Drug Administration',
  India: 'CDSCO',
  Australia: 'Therapeutic Goods Administration'
});

export const PROPERTIES = Object.freeze([
  { name: 'Haw Par Centre, 180 Clemenceau Avenue', city: 'Singapore', unit: '#05-01' },
  { name: 'Haw Par Technocentre, 401 Commonwealth Drive', city: 'Singapore', unit: '#03-12' },
  { name: 'Haw Par Glass Tower, 178 Clemenceau Avenue', city: 'Singapore', unit: '#11-04' },
  { name: 'Menara Haw Par, Jalan Sultan Ismail', city: 'Kuala Lumpur', unit: 'Level 8' }
]);

export const BANKS = Object.freeze([
  'United Overseas Bank Limited',
  'DBS Bank Ltd',
  'Oversea-Chinese Banking Corporation Limited',
  'Standard Chartered Bank (Singapore) Limited'
]);

export const DEPARTMENTS = Object.freeze([
  'Group Finance',
  'Manufacturing Operations',
  'Quality Assurance',
  'Regulatory Affairs',
  'Sales & Marketing',
  'Supply Chain',
  'Legal & Secretariat',
  'Property Management'
]);

export const STAFF = Object.freeze([
  'Tan Wei Ling',
  'Rajesh Kumar s/o Muthusamy',
  'Nurul Aisyah binte Rahman',
  'Chan Kok Meng',
  'Priya Nair',
  'Lim Hui Ying',
  'Mohd Faizal bin Osman',
  'Goh Beng Hock',
  'Sharon Lee Mei Fong',
  'Arun Balasubramanian'
]);

export const CARRIERS = Object.freeze([
  'Ocean Network Express',
  'Maersk Line',
  'PIL Pacific International Lines',
  'Evergreen Marine',
  'DHL Global Forwarding'
]);

export const CURRENCIES = Object.freeze(['SGD', 'USD', 'MYR', 'HKD', 'GBP', 'THB']);

export const SINGAPORE_GST_RATE = 0.09;

/**
 * Company-registration formats by jurisdiction.
 *
 * Haw Par buys across ASEAN and North Asia, so an identifier check that only
 * understands the Singapore UEN would reject every legitimate foreign supplier
 * registration. Each entry states the issuing authority so a reviewer can see
 * *why* an identifier was accepted rather than being told only that it "looks
 * valid". Order matters: the first jurisdiction whose pattern matches is
 * reported, so the more specific patterns are listed first.
 */
export const COMPANY_REGISTRATION_FORMATS = Object.freeze([
  {
    jurisdiction: 'Japan',
    authority: 'National Tax Agency corporate number',
    pattern: /^JP[0-9]{13}$/
  },
  {
    jurisdiction: 'China',
    authority: 'Unified Social Credit Code',
    pattern: /^[0-9A-HJ-NPQRTUWXY]{18}$/
  },
  {
    jurisdiction: 'Singapore',
    authority: 'ACRA UEN (business)',
    pattern: /^[0-9]{8,9}[A-Z]$/
  },
  {
    jurisdiction: 'Singapore',
    authority: 'ACRA UEN (local or foreign entity)',
    pattern: /^[TSR][0-9]{2}[A-Z]{2}[0-9]{4}[A-Z]$/
  },
  {
    jurisdiction: 'Hong Kong',
    authority: 'Business Registration number',
    pattern: /^[0-9]{8}(-[0-9]{3})?$/
  },
  {
    jurisdiction: 'Malaysia',
    authority: 'SSM registration number (post-2019)',
    pattern: /^[0-9]{12}$/
  },
  {
    jurisdiction: 'Malaysia',
    authority: 'SSM registration number (legacy)',
    pattern: /^[0-9]{4,7}-[A-Z]$/
  },
  {
    jurisdiction: 'Thailand',
    authority: 'DBD juristic person identifier',
    pattern: /^[0-9]{13}$/
  },
  {
    jurisdiction: 'United Kingdom',
    authority: 'Companies House number',
    pattern: /^(?:[A-Z]{2})?[0-9]{6,8}$/
  }
]);

/** Normalises an identifier for comparison: upper case, no spacing or punctuation. */
export function normaliseRegistrationNumber(value) {
  return String(value ?? '')
    .toUpperCase()
    .replace(/[^0-9A-Z-]/g, '');
}

/**
 * Resolves a company registration identifier against reference data.
 *
 * The supplier master is authoritative: an identifier that belongs to an
 * onboarded counterparty is accepted on that basis alone. Only when the value is
 * unknown does the jurisdiction format registry decide, so a well-formed foreign
 * registration is accepted while a malformed identifier is still rejected.
 *
 * @param {string} value
 * @returns {{ status: 'known'|'well-formed'|'unrecognised', supplier: object|null,
 *             jurisdiction: string|null, authority: string|null }}
 */
export function resolveRegistrationNumber(value) {
  const normalised = normaliseRegistrationNumber(value);
  if (!normalised) {
    return { status: 'unrecognised', supplier: null, jurisdiction: null, authority: null };
  }

  const supplier = SUPPLIERS.find((entry) => normaliseRegistrationNumber(entry.uen) === normalised) ?? null;
  if (supplier) {
    const format = COMPANY_REGISTRATION_FORMATS.find(
      (entry) => entry.jurisdiction === supplier.country && entry.pattern.test(normalised)
    );
    return {
      status: 'known',
      supplier,
      jurisdiction: supplier.country,
      authority: format?.authority ?? null
    };
  }

  const format = COMPANY_REGISTRATION_FORMATS.find((entry) => entry.pattern.test(normalised));
  if (format) {
    return {
      status: 'well-formed',
      supplier: null,
      jurisdiction: format.jurisdiction,
      authority: format.authority
    };
  }

  return { status: 'unrecognised', supplier: null, jurisdiction: null, authority: null };
}
