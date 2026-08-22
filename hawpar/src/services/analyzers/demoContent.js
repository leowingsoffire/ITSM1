/**
 * Demo document content generators.
 *
 * Produces realistic, deterministic VGC business documents so the platform can
 * be demonstrated end-to-end without incurring any Azure cost. Each generator
 * returns a neutral content structure that the demo analyser paginates and
 * converts into an OCR-style analysis result.
 */
import { createRandom } from '../../lib/random.js';
import { addDays, addMonths, formatDate, formatMoney } from '../../lib/format.js';
import { CLAIM_SCENARIOS } from '../../domain/marketingClaims.js';
import {
  BANKS,
  CARRIERS,
  CURRENCIES,
  DEPARTMENTS,
  GROUP_ENTITIES,
  MARKETS,
  PORTS,
  PRODUCTS,
  PROPERTIES,
  QC_TESTS,
  RAW_MATERIALS,
  REGULATORS,
  SINGAPORE_GST_RATE,
  STAFF,
  SUPPLIERS
} from '../../domain/referenceData.js';

const Role = Object.freeze({
  TITLE: 'title',
  HEADING: 'sectionHeading',
  PARAGRAPH: 'paragraph',
  FOOTER: 'pageFooter'
});

const text = (role, value) => ({ role, text: value });

/** @returns {{blocks: Array, keyValuePairs: Array, tables: Array, pageTarget: number}} */
function base(pageTarget) {
  return { blocks: [], keyValuePairs: [], tables: [], pageTarget };
}

function kv(container, key, value) {
  container.keyValuePairs.push({ key, value: String(value) });
  container.blocks.push(text(Role.PARAGRAPH, `${key}: ${value}`));
}

function heading(container, value) {
  container.blocks.push(text(Role.HEADING, value));
}

function para(container, value) {
  container.blocks.push(text(Role.PARAGRAPH, value));
}

// ── Supplier invoice ────────────────────────────────────────────────────────
function buildSupplierInvoice(rng) {
  const doc = base(rng.int(1, 3));
  const supplier = rng.pick(SUPPLIERS);
  const currency = supplier.country === 'Singapore' ? 'SGD' : rng.pick(CURRENCIES);
  const invoiceDate = addDays(new Date(Date.UTC(2026, 0, 15)), rng.int(0, 170));
  const dueDate = addDays(invoiceDate, rng.pick([14, 30, 45, 60]));

  const lines = [];
  const lineCount = rng.int(3, 8);
  for (let index = 0; index < lineCount; index += 1) {
    const material = rng.pick(RAW_MATERIALS);
    const quantity = rng.int(20, 900);
    const unitPrice = rng.float(1.2, 96.5);
    lines.push({
      no: index + 1,
      sku: material.sku,
      description: material.name,
      uom: material.uom,
      quantity,
      unitPrice,
      amount: Number((quantity * unitPrice).toFixed(2))
    });
  }

  const subtotal = Number(lines.reduce((sum, line) => sum + line.amount, 0).toFixed(2));
  const taxable = currency === 'SGD';
  const taxAmount = taxable ? Number((subtotal * SINGAPORE_GST_RATE).toFixed(2)) : 0;
  const total = Number((subtotal + taxAmount).toFixed(2));

  doc.blocks.push(text(Role.TITLE, 'TAX INVOICE'));
  para(doc, supplier.name);
  para(doc, `${supplier.country} · Company Registration ${supplier.uen}`);
  heading(doc, 'Bill To');
  para(doc, rng.pick(GROUP_ENTITIES));
  para(doc, '180 Clemenceau Avenue #02-01, VGC Centre, Singapore 239922');

  heading(doc, 'Invoice Details');
  kv(doc, 'Invoice Number', `INV-${rng.int(100000, 999999)}`);
  kv(doc, 'Invoice Date', formatDate(invoiceDate));
  kv(doc, 'Due Date', formatDate(dueDate));
  kv(doc, 'Supplier', supplier.name);
  kv(doc, 'UEN', supplier.uen);
  kv(doc, 'PO No', `HP-PO-2026-${rng.int(1000, 9999)}`);
  kv(doc, 'Currency', currency);
  kv(doc, 'Payment Terms', `Net ${Math.round((dueDate - invoiceDate) / 86400000)} days`);

  doc.tables.push({
    title: 'Line Items',
    fieldKey: 'lineItems',
    columns: ['No', 'SKU', 'Description', 'UOM', 'Qty', 'Unit Price', 'Amount'],
    rows: lines.map((line) => [
      String(line.no),
      line.sku,
      line.description,
      line.uom,
      String(line.quantity),
      formatMoney(line.unitPrice),
      formatMoney(line.amount)
    ])
  });

  heading(doc, 'Summary');
  // Foreign-currency invoices are the ones re-keyed by hand at VGC, so they
  // carry a transcription discrepancy between the printed total and the line
  // items — exactly the exception the rules engine catches before payment.
  const printedTotal = taxable ? total : Number((total + rng.float(3.5, 48.9, 2)).toFixed(2));
  kv(doc, 'Subtotal', `${currency} ${formatMoney(subtotal)}`);
  kv(doc, taxable ? 'GST @ 9%' : 'GST (Zero-rated export)', `${currency} ${formatMoney(taxAmount)}`);
  kv(doc, 'Total Amount Payable', `${currency} ${formatMoney(printedTotal)}`);
  para(doc, 'Please remit to UOB Current Account 451-903-221-9 quoting the invoice number.');
  return doc;
}

// ── Purchase order ──────────────────────────────────────────────────────────
function buildPurchaseOrder(rng) {
  const doc = base(rng.int(1, 2));
  const supplier = rng.pick(SUPPLIERS);
  const orderDate = addDays(new Date(Date.UTC(2026, 1, 3)), rng.int(0, 150));
  const deliveryDate = addDays(orderDate, rng.int(7, 60));
  const currency = supplier.country === 'Singapore' ? 'SGD' : rng.pick(CURRENCIES);

  const lines = [];
  for (let index = 0; index < rng.int(2, 6); index += 1) {
    const material = rng.pick(RAW_MATERIALS);
    const quantity = rng.int(50, 1200);
    const unitPrice = rng.float(0.8, 88);
    lines.push([
      String(index + 1),
      material.sku,
      material.name,
      material.uom,
      String(quantity),
      formatMoney(unitPrice),
      formatMoney(Number((quantity * unitPrice).toFixed(2)))
    ]);
  }
  const total = lines.reduce((sum, row) => sum + Number(row[6].replace(/,/g, '')), 0);

  doc.blocks.push(text(Role.TITLE, 'PURCHASE ORDER'));
  para(doc, 'VGC Corporation Limited — Group Procurement');
  heading(doc, 'Order Header');
  kv(doc, 'Purchase Order No', `HP-PO-2026-${rng.int(1000, 9999)}`);
  kv(doc, 'PO Date', formatDate(orderDate));
  kv(doc, 'Supplier', supplier.name);
  kv(doc, 'Delivery Date', formatDate(deliveryDate));
  kv(doc, 'Ship To', 'VGC Technocentre, 401 Commonwealth Drive, Singapore 149598');
  kv(doc, 'Currency', currency);
  kv(doc, 'Incoterms', rng.pick(['DDP Singapore', 'FOB Port Klang', 'CIF Singapore', 'EXW Works']));

  doc.tables.push({
    title: 'Order Lines',
    fieldKey: 'lineItems',
    columns: ['No', 'SKU', 'Description', 'UOM', 'Qty', 'Unit Price', 'Amount'],
    rows: lines
  });

  heading(doc, 'Authorisation');
  kv(doc, 'Order Value', `${currency} ${formatMoney(total)}`);
  kv(doc, 'Approved By', rng.pick(STAFF));
  para(doc, 'This order is subject to VGC Group standard purchasing terms and conditions (Rev. 2025-04).');
  return doc;
}

// ── Delivery order ──────────────────────────────────────────────────────────
function buildDeliveryOrder(rng) {
  const doc = base(rng.int(1, 2));
  const deliveryDate = addDays(new Date(Date.UTC(2026, 2, 1)), rng.int(0, 140));
  const cartons = rng.int(12, 640);

  const rows = [];
  for (let index = 0; index < rng.int(2, 6); index += 1) {
    const product = rng.pick(PRODUCTS);
    rows.push([
      String(index + 1),
      product.sku,
      product.name,
      product.uom,
      String(rng.int(24, 1440)),
      `B${rng.int(2026001, 2026999)}`
    ]);
  }

  doc.blocks.push(text(Role.TITLE, 'DELIVERY ORDER / GOODS RECEIVED NOTE'));
  para(doc, rng.pick(SUPPLIERS).name);
  heading(doc, 'Delivery Details');
  kv(doc, 'Delivery Order No', `DO-${rng.int(100000, 999999)}`);
  kv(doc, 'Delivery Date', formatDate(deliveryDate));
  kv(doc, 'PO No', `HP-PO-2026-${rng.int(1000, 9999)}`);
  kv(doc, 'Carrier', rng.pick(CARRIERS));
  kv(doc, 'Vehicle No', `${rng.pick(['GBA', 'YN', 'PC'])}${rng.int(1000, 9999)}${rng.pick(['S', 'X', 'M'])}`);
  kv(doc, 'Total Cartons', String(cartons));

  doc.tables.push({
    title: 'Delivered Items',
    fieldKey: 'lineItems',
    columns: ['No', 'SKU', 'Description', 'UOM', 'Qty Delivered', 'Batch No'],
    rows
  });

  heading(doc, 'Acknowledgement');
  kv(doc, 'Received By', rng.pick(STAFF));
  kv(doc, 'Received Date', formatDate(addDays(deliveryDate, rng.int(0, 1))));
  para(doc, 'Goods received in apparent good order and condition, subject to quality inspection.');
  return doc;
}

// ── Certificate of analysis ─────────────────────────────────────────────────
function buildCertificateOfAnalysis(rng) {
  const doc = base(rng.int(2, 5));
  const product = rng.pick(PRODUCTS);
  const manufactureDate = addDays(new Date(Date.UTC(2025, 8, 1)), rng.int(0, 260));
  const expiryDate = addMonths(manufactureDate, 36);
  const shouldFail = rng.bool(0.15);

  const rows = QC_TESTS.map((entry, index) => {
    let result = 'Complies';
    let status = 'PASS';
    if (entry.numeric) {
      const [min, max] = entry.numeric;
      const span = max - min;
      const failing = shouldFail && index === 2;
      const value = failing ? Number((max + span * 0.12).toFixed(2)) : rng.float(min + span * 0.15, max - span * 0.15);
      result = `${value}${entry.unit ? ` ${entry.unit}` : ''}`;
      status = failing ? 'FAIL' : 'PASS';
    }
    return [entry.test, entry.spec, entry.method, result, status];
  });

  doc.blocks.push(text(Role.TITLE, 'CERTIFICATE OF ANALYSIS'));
  para(doc, 'VGC Healthcare Limited — Quality Control Laboratory, Singapore');
  heading(doc, 'Batch Identification');
  kv(doc, 'Product', product.name);
  kv(doc, 'Material Code', product.sku);
  kv(doc, 'Batch No', `B${rng.int(2026001, 2026999)}`);
  kv(doc, 'Batch Size', `${rng.int(5000, 90000)} ${product.uom}`);
  kv(doc, 'Manufacture Date', formatDate(manufactureDate));
  kv(doc, 'Expiry Date', formatDate(expiryDate));
  kv(doc, 'Specification Ref', `SPEC-${product.sku}-R${rng.int(2, 9)}`);

  doc.tables.push({
    title: 'Test Results',
    fieldKey: 'testResults',
    columns: ['Test', 'Specification', 'Method', 'Result', 'Status'],
    rows
  });

  heading(doc, 'Disposition');
  kv(doc, 'Result', shouldFail ? 'REJECTED — Out of Specification' : 'PASS — Released for Distribution');
  kv(doc, 'Approved By', rng.pick(STAFF));
  kv(doc, 'QA Release Date', formatDate(addDays(manufactureDate, rng.int(2, 12))));
  para(doc, 'This certificate is issued under GMP licence MFG-SG-0421 and is valid without signature when generated electronically.');
  return doc;
}

// ── Bill of lading ──────────────────────────────────────────────────────────
function buildBillOfLading(rng) {
  const doc = base(rng.int(1, 3));
  const loading = rng.pick(PORTS);
  let discharge = rng.pick(PORTS);
  if (discharge === loading) discharge = PORTS[(PORTS.indexOf(loading) + 3) % PORTS.length];

  const rows = [];
  for (let index = 0; index < rng.int(2, 5); index += 1) {
    const product = rng.pick(PRODUCTS);
    rows.push([
      String(index + 1),
      product.sku,
      product.name,
      String(rng.int(20, 400)),
      `${rng.float(80, 1800, 1)} KG`
    ]);
  }

  doc.blocks.push(text(Role.TITLE, 'BILL OF LADING'));
  heading(doc, 'Parties');
  kv(doc, 'B/L No', `ONEY${rng.int(1000000, 9999999)}`);
  kv(doc, 'Shipper', 'VGC Healthcare Limited, 401 Commonwealth Drive, Singapore');
  kv(doc, 'Consignee', `${rng.pick(['Regional Distributor', 'Health Care Trading', 'Pacific Pharma'])} ${rng.pick(MARKETS)} Pte Ltd`);
  kv(doc, 'Notify Party', 'Same as consignee');

  heading(doc, 'Transport');
  kv(doc, 'Vessel', `${rng.pick(['ONE APUS', 'MAERSK SENTOSA', 'KOTA NASRAT', 'EVER GIVEN'])} / V.${rng.int(100, 999)}E`);
  kv(doc, 'Port of Loading', loading);
  kv(doc, 'Port of Discharge', discharge);
  kv(doc, 'Container No', `${rng.pick(['TCLU', 'MSKU', 'ONEU', 'PILU'])}${rng.int(1000000, 9999999)}`);
  kv(doc, 'Seal No', `SG${rng.int(100000, 999999)}`);
  kv(doc, 'Gross Weight', `${rng.float(1200, 21000, 1)} KG`);
  kv(doc, 'Shipped On Board', formatDate(addDays(new Date(Date.UTC(2026, 1, 10)), rng.int(0, 150))));
  kv(doc, 'Freight Terms', rng.pick(['FREIGHT PREPAID', 'FREIGHT COLLECT']));

  doc.tables.push({
    title: 'Cargo Manifest',
    fieldKey: 'lineItems',
    columns: ['No', 'SKU', 'Description of Goods', 'Cartons', 'Weight'],
    rows
  });
  para(doc, 'SHIPPED on board the vessel named above in apparent good order and condition unless otherwise stated.');
  return doc;
}

// ── Product registration ────────────────────────────────────────────────────
function buildProductRegistration(rng) {
  const doc = base(rng.int(2, 6));
  const country = rng.pick(MARKETS);
  const issueDate = addDays(new Date(Date.UTC(2023, 0, 10)), rng.int(0, 900));
  const expiryDate = addMonths(issueDate, rng.pick([24, 36, 60]));
  const product = rng.pick(PRODUCTS);

  doc.blocks.push(text(Role.TITLE, 'CERTIFICATE OF PRODUCT REGISTRATION'));
  para(doc, REGULATORS[country] ?? 'National Health Authority');
  heading(doc, 'Registration Particulars');
  kv(doc, 'Registration No', `${country.slice(0, 2).toUpperCase()}-MED-${rng.int(10000, 99999)}`);
  kv(doc, 'Product Name', product.name);
  kv(doc, 'Dosage Form', 'Topical ointment');
  kv(doc, 'Country', country);
  kv(doc, 'Authority', REGULATORS[country] ?? 'National Health Authority');
  kv(doc, 'Licence Holder', 'VGC Healthcare Limited');
  kv(doc, 'Manufacturing Site', 'VGC Technocentre, 401 Commonwealth Drive, Singapore 149598');
  kv(doc, 'Issue Date', formatDate(issueDate));
  kv(doc, 'Valid Until', formatDate(expiryDate));

  doc.tables.push({
    title: 'Active Ingredients',
    fieldKey: 'lineItems',
    columns: ['Ingredient', 'Strength', 'Function'],
    rows: [
      ['Menthol', '10.0% w/w', 'Counter-irritant'],
      ['Camphor', '11.0% w/w', 'Counter-irritant'],
      ['Cajuput Oil', '7.0% w/w', 'Topical analgesic'],
      ['Clove Bud Oil', '1.5% w/w', 'Topical analgesic']
    ]
  });
  heading(doc, 'Conditions of Registration');
  para(doc, 'The registrant shall report any adverse drug reaction within 15 calendar days of becoming aware of it.');
  para(doc, 'Any variation to the approved formulation, packaging or manufacturing site requires prior written approval.');
  para(doc, 'This certificate remains the property of the issuing authority and must be surrendered upon cancellation.');
  return doc;
}

// ── Trademark certificate ───────────────────────────────────────────────────
function buildTrademarkCertificate(rng) {
  const doc = base(rng.int(1, 4));
  const country = rng.pick(MARKETS);
  const registrationDate = addDays(new Date(Date.UTC(2016, 0, 5)), rng.int(0, 2900));
  const renewalDate = addMonths(registrationDate, 120);

  doc.blocks.push(text(Role.TITLE, 'CERTIFICATE OF REGISTRATION OF TRADE MARK'));
  para(doc, `Intellectual Property Office of ${country}`);
  heading(doc, 'Mark Particulars');
  kv(doc, 'Trade Mark No', `T${rng.int(10, 99)}${rng.int(10000, 99999)}${rng.pick(['A', 'B', 'C', 'J'])}`);
  kv(doc, 'Mark', rng.pick(['TIGER BALM', 'TIGER BALM & Device', 'KWAN LOONG', 'VGC', 'TIGER (Leaping Tiger Device)']));
  kv(doc, 'Proprietor', 'VGC Trademark Holdings Pte Ltd');
  kv(doc, 'Address', '180 Clemenceau Avenue #02-01, VGC Centre, Singapore 239922');
  kv(doc, 'Country', country);
  kv(doc, 'Classes', rng.pick(['5', '3, 5', '5, 10', '3, 5, 35']));
  kv(doc, 'Registration Date', formatDate(registrationDate));
  kv(doc, 'Renewal Date', formatDate(renewalDate));
  heading(doc, 'Specification of Goods');
  para(doc, 'Class 5: Medicated ointments, balms, medicated plasters, analgesic preparations for topical application.');
  para(doc, 'Class 3: Non-medicated toiletries; essential oils; massage preparations not for medical purposes.');
  para(doc, 'Registration is valid for ten years and may be renewed for further periods of ten years.');
  return doc;
}

// ── Tenancy agreement ───────────────────────────────────────────────────────
function buildTenancyAgreement(rng) {
  const doc = base(rng.int(14, 34));
  const property = rng.pick(PROPERTIES);
  const startDate = addDays(new Date(Date.UTC(2025, 5, 1)), rng.int(0, 380));
  const termMonths = rng.pick([12, 24, 36]);
  const endDate = addDays(addMonths(startDate, termMonths), -1);
  const area = rng.int(850, 12500);
  const rentPsf = rng.float(3.2, 9.8);
  const monthlyRent = Number((area * rentPsf).toFixed(2));
  const depositMonths = rng.pick([2, 3, 6]);

  doc.blocks.push(text(Role.TITLE, 'TENANCY AGREEMENT'));
  heading(doc, 'Particulars');
  kv(doc, 'Agreement No', `HP-TA-${rng.int(2025, 2026)}-${rng.int(100, 999)}`);
  kv(doc, 'Landlord', 'VGC Properties (Singapore) Pte Ltd');
  kv(doc, 'Tenant', `${rng.pick(['Meridian', 'Crestline', 'Anchorvale', 'Novena', 'Kallang'])} ${rng.pick(['Consulting', 'Technologies', 'Logistics', 'Wellness'])} Pte Ltd`);
  kv(doc, 'Premises', `${property.unit}, ${property.name}, ${property.city}`);
  kv(doc, 'Lettable Area', `${area} sq ft`);
  kv(doc, 'Commencement Date', formatDate(startDate));
  kv(doc, 'Expiry Date', formatDate(endDate));
  kv(doc, 'Term', `${termMonths} months`);
  kv(doc, 'Monthly Rent', `SGD ${formatMoney(monthlyRent)}`);
  kv(doc, 'Security Deposit', `SGD ${formatMoney(Number((monthlyRent * depositMonths).toFixed(2)))}`);
  kv(doc, 'Option to Renew', rng.pick(['Yes — 12 months at prevailing market rent', 'Yes — 24 months at prevailing market rent', 'No']));
  kv(doc, 'Permitted Use', rng.pick(['General office', 'Showroom and office', 'Light industrial (B1)']));

  doc.tables.push({
    title: 'Rent Schedule',
    fieldKey: 'lineItems',
    columns: ['Period', 'Monthly Rent (SGD)', 'Service Charge (SGD)', 'Total (SGD)'],
    rows: Array.from({ length: Math.ceil(termMonths / 12) }, (unused, index) => {
      const escalated = Number((monthlyRent * (1 + index * 0.03)).toFixed(2));
      const service = Number((area * 0.55).toFixed(2));
      return [
        `Year ${index + 1}`,
        formatMoney(escalated),
        formatMoney(service),
        formatMoney(Number((escalated + service).toFixed(2)))
      ];
    })
  });

  const clauses = [
    ['Rent and Payment', 'The Tenant shall pay the Rent monthly in advance without deduction or set-off on the first day of each calendar month.'],
    ['Security Deposit', 'The Deposit shall be held by the Landlord free of interest as security for the due performance of the Tenant obligations.'],
    ['Use of Premises', 'The Tenant shall not use the Premises otherwise than for the Permitted Use without the prior written consent of the Landlord.'],
    ['Repair and Maintenance', 'The Tenant shall keep the interior of the Premises in good and tenantable repair, fair wear and tear excepted.'],
    ['Insurance', 'The Tenant shall maintain public liability insurance of not less than SGD 2,000,000 for any one occurrence.'],
    ['Alterations', 'No structural alteration shall be carried out without the prior written approval of the Landlord and the relevant authorities.'],
    ['Assignment and Subletting', 'The Tenant shall not assign, sublet, or part with possession of the Premises or any part thereof.'],
    ['Reinstatement', 'Upon expiry the Tenant shall reinstate the Premises to its original bare condition at the Tenant own cost.'],
    ['Default and Re-entry', 'If the Rent remains unpaid for fourteen days the Landlord may re-enter the Premises and this tenancy shall absolutely determine.'],
    ['Force Majeure', 'Neither party shall be liable for failure to perform caused by events beyond its reasonable control.'],
    ['Governing Law', 'This Agreement shall be governed by and construed in accordance with the laws of the Republic of Singapore.'],
    ['Dispute Resolution', 'Any dispute shall be referred to and finally resolved by arbitration administered by the SIAC.']
  ];

  clauses.forEach(([clauseTitle, body], index) => {
    heading(doc, `${index + 1}. ${clauseTitle}`);
    para(doc, body);
    para(doc, `${index + 1}.1 The parties acknowledge that time shall be of the essence in respect of this clause and all obligations arising under it.`);
    para(doc, `${index + 1}.2 Any waiver by the Landlord of a breach of this clause shall not operate as a waiver of any subsequent breach.`);
  });
  heading(doc, 'Execution');
  para(doc, 'SIGNED by the duly authorised representative of the Landlord in the presence of the witness named below.');
  return doc;
}

// ── Annual report (100+ pages) ──────────────────────────────────────────────
function buildAnnualReport(rng) {
  const doc = base(rng.int(112, 168));
  const financialYear = rng.pick([2023, 2024, 2025]);
  const revenue = rng.float(180, 260, 1);
  const pbt = Number((revenue * rng.float(0.28, 0.42, 3)).toFixed(1));
  const netProfit = Number((pbt * 0.87).toFixed(1));
  const totalAssets = Number((revenue * rng.float(8, 11, 2)).toFixed(1));
  const totalEquity = Number((totalAssets * rng.float(0.86, 0.94, 3)).toFixed(1));
  const eps = Number(((netProfit * 1000) / 221100).toFixed(1));

  doc.blocks.push(text(Role.TITLE, `VGC CORPORATION LIMITED — ANNUAL REPORT ${financialYear}`));
  heading(doc, 'Key Financial Highlights');
  kv(doc, 'Financial Year', String(financialYear));
  kv(doc, 'Company', 'VGC Corporation Limited');
  kv(doc, 'Revenue', `SGD ${formatMoney(revenue)} million`);
  kv(doc, 'Profit Before Tax', `SGD ${formatMoney(pbt)} million`);
  kv(doc, 'Net Profit', `SGD ${formatMoney(netProfit)} million`);
  kv(doc, 'Total Assets', `SGD ${formatMoney(totalAssets)} million`);
  kv(doc, 'Total Equity', `SGD ${formatMoney(totalEquity)} million`);
  kv(doc, 'Earnings Per Share', `${eps} cents`);
  kv(doc, 'Dividend Per Share', `${rng.pick([20, 25, 30, 35])} cents`);
  kv(doc, 'Auditor', rng.pick(['Ernst & Young LLP', 'KPMG LLP', 'PricewaterhouseCoopers LLP', 'Deloitte & Touche LLP']));
  kv(doc, 'Opinion', 'Unqualified opinion');

  const healthcare = Number((revenue * 0.82).toFixed(1));
  const leisure = Number((revenue * 0.08).toFixed(1));
  const property = Number((revenue * 0.06).toFixed(1));
  const investments = Number((revenue - healthcare - leisure - property).toFixed(1));

  doc.tables.push({
    title: 'Segment Results',
    fieldKey: 'segmentResults',
    columns: ['Segment', 'Revenue (SGD m)', 'Segment Profit (SGD m)', 'Assets (SGD m)', 'YoY Change'],
    rows: [
      ['Healthcare', formatMoney(healthcare), formatMoney(healthcare * 0.31), formatMoney(totalAssets * 0.14), `${rng.float(-4, 14, 1)}%`],
      ['Leisure', formatMoney(leisure), formatMoney(leisure * 0.11), formatMoney(totalAssets * 0.03), `${rng.float(-9, 22, 1)}%`],
      ['Property', formatMoney(property), formatMoney(property * 0.58), formatMoney(totalAssets * 0.07), `${rng.float(-2, 8, 1)}%`],
      ['Investments', formatMoney(investments), formatMoney(investments * 0.94), formatMoney(totalAssets * 0.76), `${rng.float(-6, 18, 1)}%`]
    ]
  });

  doc.tables.push({
    title: 'Consolidated Statement of Financial Position',
    columns: ['SGD million', String(financialYear), String(financialYear - 1)],
    rows: [
      ['Property, plant and equipment', formatMoney(totalAssets * 0.07), formatMoney(totalAssets * 0.068)],
      ['Investment properties', formatMoney(totalAssets * 0.05), formatMoney(totalAssets * 0.049)],
      ['Long-term investments', formatMoney(totalAssets * 0.72), formatMoney(totalAssets * 0.70)],
      ['Inventories', formatMoney(totalAssets * 0.02), formatMoney(totalAssets * 0.021)],
      ['Trade receivables', formatMoney(totalAssets * 0.03), formatMoney(totalAssets * 0.028)],
      ['Cash and bank balances', formatMoney(totalAssets * 0.11), formatMoney(totalAssets * 0.104)],
      ['Total assets', formatMoney(totalAssets), formatMoney(totalAssets * 0.96)],
      ['Total liabilities', formatMoney(totalAssets - totalEquity), formatMoney((totalAssets - totalEquity) * 0.98)],
      ['Total equity', formatMoney(totalEquity), formatMoney(totalEquity * 0.95)]
    ]
  });

  const sections = [
    ['Chairman Statement', 'The Group delivered a resilient performance despite persistent macroeconomic headwinds across its principal markets.'],
    ['Board of Directors', 'The Board comprises a majority of independent directors and meets at least four times each financial year.'],
    ['Corporate Governance Report', 'The Company has complied in all material respects with the principles of the Code of Corporate Governance 2018.'],
    ['Operating and Financial Review', 'Healthcare remained the principal contributor to Group revenue, supported by export recovery in ASEAN markets.'],
    ['Sustainability Report', 'The Group monitors Scope 1 and Scope 2 greenhouse gas emissions across its Singapore manufacturing operations.'],
    ['Risk Management', 'The Group Risk Register is reviewed semi-annually by the Audit Committee and covers strategic, operational and compliance risks.'],
    ['Directors Statement', 'In the opinion of the directors the financial statements are drawn up so as to give a true and fair view.'],
    ['Independent Auditor Report', 'In our opinion the accompanying consolidated financial statements present fairly, in all material respects, the financial position of the Group.']
  ];

  sections.forEach(([sectionTitle, lead]) => {
    heading(doc, sectionTitle);
    para(doc, lead);
    for (let index = 0; index < 6; index += 1) {
      para(
        doc,
        `The Group continued to invest in brand equity, distribution reach and manufacturing capability during the year under review, with particular emphasis on regulatory compliance across the ${rng.pick(MARKETS)} market and on the digitalisation of core finance and supply chain processes.`
      );
    }
  });

  const noteTitles = [
    'Basis of Preparation', 'Material Accounting Policies', 'Segment Information', 'Revenue',
    'Other Operating Income', 'Employee Benefits Expense', 'Finance Costs', 'Taxation',
    'Earnings Per Share', 'Property, Plant and Equipment', 'Investment Properties', 'Subsidiaries',
    'Associated Companies', 'Long-Term Investments', 'Inventories', 'Trade and Other Receivables',
    'Cash and Cash Equivalents', 'Trade and Other Payables', 'Provisions', 'Deferred Taxation',
    'Share Capital', 'Reserves', 'Dividends', 'Commitments', 'Contingent Liabilities',
    'Related Party Transactions', 'Financial Risk Management', 'Fair Value Measurement',
    'Capital Management', 'Leases', 'Government Grants', 'Share-Based Payments',
    'Events After the Reporting Period', 'New Standards Not Yet Adopted', 'Comparative Figures'
  ];

  noteTitles.forEach((noteTitle, index) => {
    heading(doc, `Note ${index + 1} — ${noteTitle}`);
    para(doc, `The Group applies the recognition and measurement principles of SFRS(I) in respect of ${noteTitle.toLowerCase()}.`);
    para(doc, `Movements during the financial year ended 31 December ${financialYear} are set out in the table below and are stated net of accumulated impairment where applicable.`);
    para(doc, 'Comparative amounts have been restated where necessary to conform with the current year presentation. No restatement had a material effect on reported profit.');
  });

  return doc;
}

// ── Bank statement ──────────────────────────────────────────────────────────
function buildBankStatement(rng) {
  const doc = base(rng.int(4, 18));
  const bank = rng.pick(BANKS);
  const opening = rng.float(120000, 4200000);
  const monthIndex = rng.int(0, 5);
  const periodStart = new Date(Date.UTC(2026, monthIndex, 1));
  const periodEnd = addDays(addMonths(periodStart, 1), -1);

  const rows = [];
  let balance = opening;
  let credits = 0;
  let debits = 0;
  const transactionCount = rng.int(28, 90);

  for (let index = 0; index < transactionCount; index += 1) {
    const isCredit = rng.bool(0.42);
    const amount = rng.float(180, 165000);
    if (isCredit) {
      credits += amount;
      balance += amount;
    } else {
      debits += amount;
      balance -= amount;
    }
    rows.push([
      formatDate(addDays(periodStart, Math.min(index, 27))),
      rng.pick([
        'GIRO COLLECTION',
        'FAST TRANSFER',
        'CHEQUE DEPOSIT',
        'TT REMITTANCE',
        'PAYROLL DEBIT',
        'SUPPLIER PAYMENT',
        'BANK CHARGES',
        'INTEREST CREDIT'
      ]),
      isCredit ? '' : formatMoney(amount),
      isCredit ? formatMoney(amount) : '',
      formatMoney(balance)
    ]);
  }

  doc.blocks.push(text(Role.TITLE, 'STATEMENT OF ACCOUNT'));
  para(doc, bank);
  heading(doc, 'Account Summary');
  kv(doc, 'Account Name', rng.pick(GROUP_ENTITIES));
  kv(doc, 'Account No', `${rng.int(100, 999)}-${rng.int(100, 999)}-${rng.int(100, 999)}-${rng.int(1, 9)}`);
  kv(doc, 'Bank', bank);
  kv(doc, 'Currency', 'SGD');
  kv(doc, 'Statement Period', `${formatDate(periodStart)} to ${formatDate(periodEnd)}`);
  kv(doc, 'Opening Balance', formatMoney(opening));
  kv(doc, 'Total Credits', formatMoney(credits));
  kv(doc, 'Total Debits', formatMoney(debits));
  kv(doc, 'Closing Balance', formatMoney(balance));

  doc.tables.push({
    title: 'Transactions',
    fieldKey: 'transactions',
    columns: ['Value Date', 'Description', 'Withdrawal', 'Deposit', 'Balance'],
    rows
  });
  return doc;
}

// ── Employee expense claim ──────────────────────────────────────────────────
function buildEmployeeClaim(rng) {
  const doc = base(rng.int(1, 6));
  const employee = rng.pick(STAFF);
  const monthIndex = rng.int(0, 5);
  const rows = [];
  for (let index = 0; index < rng.int(3, 10); index += 1) {
    const amount = rng.float(12, 980);
    rows.push([
      String(index + 1),
      formatDate(addDays(new Date(Date.UTC(2026, monthIndex, 1)), rng.int(0, 27))),
      rng.pick(['Client entertainment', 'Taxi fare', 'Airfare — regional', 'Hotel accommodation', 'Trade show booth', 'Courier charges', 'Mobile reimbursement']),
      rng.pick(['Travel', 'Entertainment', 'Communications', 'Marketing']),
      formatMoney(amount)
    ]);
  }
  const total = rows.reduce((sum, row) => sum + Number(row[4].replace(/,/g, '')), 0);

  doc.blocks.push(text(Role.TITLE, 'EMPLOYEE EXPENSE CLAIM FORM'));
  para(doc, 'VGC Corporation Limited — Human Resources');
  heading(doc, 'Claimant Details');
  kv(doc, 'Claim No', `CLM-2026-${rng.int(10000, 99999)}`);
  kv(doc, 'Employee', employee);
  kv(doc, 'Employee No', `HP${rng.int(10000, 99999)}`);
  kv(doc, 'Department', rng.pick(DEPARTMENTS));
  kv(doc, 'Claim Period', `${['January', 'February', 'March', 'April', 'May', 'June'][monthIndex]} 2026`);

  doc.tables.push({
    title: 'Claim Lines',
    fieldKey: 'lineItems',
    columns: ['No', 'Date', 'Description', 'Category', 'Amount (SGD)'],
    rows
  });

  heading(doc, 'Approval');
  kv(doc, 'Total Claimed', `SGD ${formatMoney(total)}`);
  kv(doc, 'Approved By', rng.pick(STAFF));
  kv(doc, 'Approval Date', formatDate(addDays(new Date(Date.UTC(2026, monthIndex + 1, 3)), rng.int(0, 8))));
  para(doc, 'I certify that the above expenses were incurred wholly and necessarily in the course of company business.');
  return doc;
}

// ── Marketing (A&P) claim summary ───────────────────────────────────────────
function resolveClaimScenario(seed) {
  const key = String(seed ?? '').toLowerCase();
  // Match on the scenario id or any of its distinctive tokens so both the
  // file-name seed (used by the analyzer) and the sample-id seed (used when
  // rendering the downloadable PDF) resolve to the same scenario.
  return (
    CLAIM_SCENARIOS.find((scenario) => {
      if (key.includes(scenario.id)) return true;
      return scenario.id.split('-').some((token) => token.length > 3 && key.includes(token));
    }) ?? CLAIM_SCENARIOS[0]
  );
}

function buildMarketingClaim(rng, seed) {
  const scenario = resolveClaimScenario(seed);
  const { claim, apCode, currency } = scenario;
  const doc = base(rng.int(2, 3));

  doc.blocks.push(text(Role.TITLE, 'MARKETING EXPENSE CLAIM SUMMARY'));
  para(doc, 'VGC Healthcare — Trade Marketing (Advertising & Promotion)');
  para(doc, `Distributor co-operative advertising claim for reimbursement under A&P code ${apCode}.`);

  heading(doc, 'Claim Details');
  kv(doc, 'Claim Number', claim.claimNumber);
  kv(doc, 'Distributor', claim.distributor);
  kv(doc, 'Claim Date', claim.claimDate);
  kv(doc, 'A&P Code', apCode);
  kv(doc, 'Campaign', claim.campaign);
  kv(doc, 'Currency', currency);
  kv(doc, 'Product Type Codes', claim.productSummary.map((row) => row.productType).join(', '));
  kv(doc, 'Supporting Documents', String(scenario.supporting.length));

  heading(doc, 'Product Type Summary');
  doc.tables.push({
    title: 'Product Type Summary',
    fieldKey: 'productSummary',
    columns: ['Product Type', `Amount (${currency})`],
    rows: claim.productSummary.map((row) => [row.productType, formatMoney(row.amount)])
  });

  heading(doc, 'Claim Line Items');
  doc.tables.push({
    title: 'Claim Line Items',
    fieldKey: 'lineItems',
    columns: ['Line', 'Vendor', 'Invoice No', 'Invoice Date', 'A&P', 'Product', `Amount (${currency})`, 'Mark-up'],
    rows: claim.lineItems.map((line) => [
      String(line.lineNo),
      line.vendor,
      line.invoiceRef,
      line.invoiceDate,
      line.apCode,
      line.productType,
      formatMoney(line.amount),
      line.annotation
    ])
  });

  heading(doc, 'Amount Claimed');
  kv(doc, 'Claim Amount', `${currency} ${formatMoney(claim.claimAmount)}`);
  para(
    doc,
    'The distributor certifies that the above marketing activities were executed in accordance with the approved A&P plan and that the attached supplier invoices support the amount claimed. Highlighted lines on the attachments have been summed by product type and carried to the Product Type Summary above.'
  );
  return doc;
}

// ── Marketing (A&P) supporting document ─────────────────────────────────────
function resolveSupport(seed) {
  const scenario = resolveClaimScenario(seed);
  const key = String(seed ?? '').toLowerCase();
  const match = key.match(/support-(\d+)/);
  const ordinal = match ? Number(match[1]) - 1 : 0;
  const index = Math.min(Math.max(ordinal, 0), scenario.supporting.length - 1);
  return { scenario, support: scenario.supporting[index] };
}

function buildMarketingSupport(rng, seed) {
  const { scenario, support } = resolveSupport(seed);
  const currency = scenario.currency;
  const doc = base(rng.int(1, 2));
  const isLetter = /letter/i.test(support.kind);

  // Lead with the exact type name so classification routes this to
  // marketing_support via a title match rather than the claim type.
  doc.blocks.push(text(Role.TITLE, 'A&P Supporting Document'));

  if (isLetter) {
    heading(doc, 'Agency Cover Letter');
    para(doc, support.vendor);
    para(doc, 'Attention: VGC Healthcare — Trade Marketing Department');
    heading(doc, 'Reference');
    kv(doc, 'Document Kind', support.kind);
    kv(doc, 'Vendor', support.vendor);
    kv(doc, 'Reference', support.reference);
    kv(doc, 'Document Date', support.date);
    kv(doc, 'A&P Code', support.apCodeRef);
    heading(doc, 'Summary');
    para(
      doc,
      `${support.note} This attachment accompanies claim ${scenario.claim.claimNumber} for campaign "${scenario.claim.campaign}". The A&P code is hand-stamped on the letterhead.`
    );
    return doc;
  }

  heading(doc, 'Vendor Tax Invoice');
  para(doc, support.vendor);
  para(doc, `Supplier tax invoice submitted in support of claim ${scenario.claim.claimNumber} (A&P code ${support.apCodeRef}).`);

  heading(doc, 'Document Details');
  kv(doc, 'Document Kind', support.kind);
  kv(doc, 'Vendor', support.vendor);
  kv(doc, 'Reference', support.reference);
  kv(doc, 'Document Date', support.date);
  kv(doc, 'A&P Code', support.apCodeRef);
  if (support.productType) kv(doc, 'Product Type', support.productType);

  if (Array.isArray(support.lineItems) && support.lineItems.length > 0) {
    heading(doc, 'Highlighted Line Items');
    doc.tables.push({
      title: 'Highlighted Line Items',
      fieldKey: 'lineItems',
      columns: ['Description', 'Product', `Amount (${currency})`, 'Mark-up'],
      rows: support.lineItems.map((line) => [line.label, line.productType, formatMoney(line.amount), line.annotation])
    });
    para(
      doc,
      'The highlighted lines above are grouped by product type for summation against the distributor claim summary.'
    );
  }

  heading(doc, 'Summary');
  kv(doc, 'Amount', `${currency} ${formatMoney(support.amount)}`);
  para(doc, `Payable to ${support.vendor}. Please quote reference ${support.reference} on remittance.`);
  return doc;
}

const GENERATORS = Object.freeze({
  supplier_invoice: buildSupplierInvoice,
  purchase_order: buildPurchaseOrder,
  delivery_order: buildDeliveryOrder,
  certificate_of_analysis: buildCertificateOfAnalysis,
  bill_of_lading: buildBillOfLading,
  product_registration: buildProductRegistration,
  trademark_certificate: buildTrademarkCertificate,
  tenancy_agreement: buildTenancyAgreement,
  annual_report: buildAnnualReport,
  bank_statement: buildBankStatement,
  employee_claim: buildEmployeeClaim,
  marketing_claim: buildMarketingClaim,
  marketing_support: buildMarketingSupport
});

export const GENERATED_TYPE_IDS = Object.freeze(Object.keys(GENERATORS));

/**
 * @param {string} typeId Document type to synthesise.
 * @param {string} seed   Deterministic seed (usually the file name).
 */
export function generateDocumentContent(typeId, seed) {
  const generator = GENERATORS[typeId] ?? buildSupplierInvoice;
  return generator(createRandom(`${typeId}:${seed}`), seed);
}
