/**
 * Sample document library.
 *
 * Generates genuine PDF files (not fixtures) for each Haw Par document type and
 * pushes them through the exact same ingestion path as a customer upload, so a
 * demonstration exercises the real code path end to end.
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { getDocumentType } from '../domain/documentTypes.js';
import { createRandom } from '../lib/random.js';
import { generateDocumentContent } from './analyzers/demoContent.js';

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 46;
const BODY_SIZE = 8;
const HEADING_SIZE = 10.5;
const TITLE_SIZE = 15;
const LINE_HEIGHT = 11.4;
const MAX_CHARACTERS = 104;
const LINES_PER_PAGE = Math.floor((PAGE_HEIGHT - MARGIN * 2 - 26) / LINE_HEIGHT);
const MAX_SAMPLE_PAGES = 200;

const BRAND = rgb(0.1, 0.19, 0.33);
const BODY_COLOUR = rgb(0.13, 0.15, 0.18);
const MUTED = rgb(0.45, 0.48, 0.52);

/** pdf-lib's standard fonts are WinAnsi — map or drop anything outside it. */
function toWinAnsi(value) {
  return String(value)
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u00d7/g, 'x')
    .replace(/\u00b7/g, '-')
    .replace(/\u00b0/g, ' deg ')
    .replace(/\u2192/g, '->')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '');
}

function wrap(value, maxCharacters = MAX_CHARACTERS) {
  const words = toWinAnsi(value).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];
  const lines = [];
  let current = '';
  for (const word of words) {
    if (!current) current = word;
    else if (current.length + word.length + 1 <= maxCharacters) current += ` ${word}`;
    else {
      lines.push(current);
      current = word;
    }
  }
  lines.push(current);
  return lines;
}

function flattenContent(content) {
  const lines = [];

  for (const block of content.blocks) {
    if (block.role === 'title') {
      lines.push({ text: toWinAnsi(block.text), style: 'title' });
      lines.push({ text: '', style: 'body' });
      continue;
    }
    if (block.role === 'sectionHeading') {
      lines.push({ text: '', style: 'body' });
      lines.push({ text: toWinAnsi(block.text), style: 'heading' });
      continue;
    }
    for (const line of wrap(block.text)) lines.push({ text: line, style: 'body' });
  }

  for (const table of content.tables) {
    lines.push({ text: '', style: 'body' });
    lines.push({ text: toWinAnsi(table.title), style: 'heading' });
    const widths = table.columns.map((column, index) =>
      Math.min(
        34,
        Math.max(
          column.length,
          ...table.rows.map((row) => String(row[index] ?? '').length)
        )
      ) + 1
    );
    const renderRow = (cells) =>
      cells
        .map((cell, index) => toWinAnsi(String(cell ?? '')).slice(0, widths[index]).padEnd(widths[index]))
        .join(' ')
        .slice(0, MAX_CHARACTERS + 14);

    lines.push({ text: renderRow(table.columns), style: 'tableHeader' });
    lines.push({ text: '-'.repeat(Math.min(MAX_CHARACTERS + 14, widths.reduce((sum, width) => sum + width + 1, 0))), style: 'muted' });
    for (const row of table.rows) lines.push({ text: renderRow(row), style: 'body' });
  }

  return lines;
}

/**
 * @param {string} typeId
 * @param {string} seed
 * @returns {Promise<{buffer: Buffer, fileName: string, mimeType: string, pageCount: number}>}
 */
export async function generateSamplePdf(typeId, seed) {
  const type = getDocumentType(typeId);
  const content = generateDocumentContent(typeId, seed);
  const rng = createRandom(`pdf:${seed}`);

  const lines = flattenContent(content);
  const targetPages = Math.min(MAX_SAMPLE_PAGES, Math.max(1, content.pageTarget));
  const filler = [
    'Continued from the previous page. This document forms part of the Haw Par Group records retention set.',
    'Amounts are expressed in Singapore dollars unless otherwise indicated. Figures may not add due to rounding.',
    'This page is reproduced in full to preserve the completeness of the original record for audit purposes.',
    'Refer to the accompanying notes and schedules which form an integral part of this document.'
  ];
  let fillerIndex = 0;
  while (lines.length < targetPages * LINES_PER_PAGE) {
    lines.push({ text: toWinAnsi(filler[fillerIndex % filler.length]), style: 'muted' });
    fillerIndex += 1;
  }

  const pdf = await PDFDocument.create();
  pdf.setTitle(`${type.name} — Haw Par Corporation (sample)`);
  pdf.setAuthor('Haw Par AI Document Intelligence Platform');
  pdf.setSubject(`${type.businessUnit} · ${type.process}`);
  pdf.setProducer('Haw Par AI OCR Prototype');
  pdf.setCreationDate(new Date());

  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const mono = await pdf.embedFont(StandardFonts.Courier);

  const totalPages = Math.ceil(lines.length / LINES_PER_PAGE);
  for (let pageIndex = 0; pageIndex < totalPages; pageIndex += 1) {
    const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    page.drawRectangle({ x: 0, y: PAGE_HEIGHT - 26, width: PAGE_WIDTH, height: 26, color: BRAND });
    page.drawText('HAW PAR CORPORATION LIMITED', {
      x: MARGIN,
      y: PAGE_HEIGHT - 18,
      size: 9,
      font: bold,
      color: rgb(1, 1, 1)
    });
    page.drawText(toWinAnsi(type.name.toUpperCase()), {
      x: PAGE_WIDTH - MARGIN - bold.widthOfTextAtSize(toWinAnsi(type.name.toUpperCase()), 8),
      y: PAGE_HEIGHT - 17.5,
      size: 8,
      font: bold,
      color: rgb(0.85, 0.89, 0.95)
    });

    let cursorY = PAGE_HEIGHT - MARGIN - 12;
    const slice = lines.slice(pageIndex * LINES_PER_PAGE, (pageIndex + 1) * LINES_PER_PAGE);

    for (const line of slice) {
      if (line.text) {
        const style = line.style;
        const font = style === 'title' || style === 'heading' || style === 'tableHeader' ? bold : style === 'body' ? regular : mono;
        const size = style === 'title' ? TITLE_SIZE : style === 'heading' ? HEADING_SIZE : BODY_SIZE;
        const colour = style === 'title' || style === 'heading' ? BRAND : style === 'muted' ? MUTED : BODY_COLOUR;
        const usedFont = style === 'tableHeader' || style === 'muted' ? mono : font;
        page.drawText(line.text, { x: MARGIN, y: cursorY, size, font: usedFont, color: colour });
      }
      cursorY -= LINE_HEIGHT;
    }

    const footer = `Page ${pageIndex + 1} of ${totalPages}  |  Ref ${String(rng.int(100000, 999999))}  |  Uncontrolled when printed`;
    page.drawText(footer, { x: MARGIN, y: 24, size: 7, font: regular, color: MUTED });
  }

  const bytes = await pdf.save();
  return {
    buffer: Buffer.from(bytes),
    mimeType: 'application/pdf',
    pageCount: totalPages
  };
}

export const SAMPLE_LIBRARY = Object.freeze([
  { id: 'sample-invoice', typeId: 'supplier_invoice', fileName: 'Tax-Invoice-INV-884210-Sinar-Mas.pdf', description: 'Raw material invoice with GST, PO reference and 6 line items.' },
  { id: 'sample-po', typeId: 'purchase_order', fileName: 'Purchase-Order-HP-PO-2026-4471.pdf', description: 'Procurement order with Incoterms and approval block.' },
  { id: 'sample-do', typeId: 'delivery_order', fileName: 'Delivery-Order-GRN-556120.pdf', description: 'Inbound goods received note for three-way matching.' },
  { id: 'sample-coa', typeId: 'certificate_of_analysis', fileName: 'Certificate-of-Analysis-Batch-B2026417.pdf', description: 'QC release certificate with 8 specification tests.' },
  { id: 'sample-bl', typeId: 'bill_of_lading', fileName: 'Bill-of-Lading-ONEY7741203-Export.pdf', description: 'Ocean export B/L with container and vessel details.' },
  { id: 'sample-reg', typeId: 'product_registration', fileName: 'Product-Registration-Licence-Malaysia-NPRA.pdf', description: 'Regulatory product licence with validity dates.' },
  { id: 'sample-tm', typeId: 'trademark_certificate', fileName: 'Trademark-Certificate-TIGER-BALM-Class-5.pdf', description: 'IP registration certificate with renewal tracking.' },
  { id: 'sample-lease', typeId: 'tenancy_agreement', fileName: 'Tenancy-Agreement-Haw-Par-Centre-Level-5.pdf', description: 'Multi-page lease contract with rent schedule and 12 clauses.' },
  { id: 'sample-ar', typeId: 'annual_report', fileName: 'Haw-Par-Annual-Report-FY2025-Full.pdf', description: '100+ page annual report with segment tables and audit opinion.' },
  { id: 'sample-bank', typeId: 'bank_statement', fileName: 'Bank-Statement-UOB-Current-Account.pdf', description: 'Treasury statement with transaction ledger reconciliation.' },
  { id: 'sample-claim', typeId: 'employee_claim', fileName: 'Employee-Expense-Claim-CLM-2026-40218.pdf', description: 'HR expense claim with policy cap validation.' },
  { id: 'sample-mkt-claim-pop', typeId: 'marketing_claim', fileName: 'pop-us-summer-Distributor-A&P-Claim-MKT-CLM-2026-US-0412.pdf', description: 'POP (US) distributor A&P claim (A6) — carries date, amount, A&P-code and product-summation exceptions.' },
  { id: 'sample-mkt-support-pop-1', typeId: 'marketing_support', fileName: 'pop-us-summer-support-1-Google-Ads-INV-GOOG-88213.pdf', description: 'Google Ads bill (13,348) with highlighted TBO/TBMP lines for the POP claim.' },
  { id: 'sample-mkt-support-pop-2', typeId: 'marketing_support', fileName: 'pop-us-summer-support-2-AgencyOne-Cover-Letter-A7.pdf', description: 'Agency cover letter hand-stamped A7 (mismatch vs claim A6).' },
  { id: 'sample-mkt-claim-watsons', typeId: 'marketing_claim', fileName: 'watsons-my-ramadan-Distributor-A&P-Claim-MKT-CLM-2026-MY-0335.pdf', description: 'Watsons (MY) distributor A&P claim (A2) — reconciles cleanly across all checks.' },
  { id: 'sample-mkt-support-watsons-1', typeId: 'marketing_support', fileName: 'watsons-my-ramadan-support-1-Google-Ads-INV-GOOG-77120.pdf', description: 'Google Ads bill with highlighted TBO lines for the Watsons claim.' },
  { id: 'sample-mkt-support-watsons-2', typeId: 'marketing_support', fileName: 'watsons-my-ramadan-support-2-Meta-INV-META-4408.pdf', description: 'Meta bill with a highlighted TBMP line for the Watsons claim.' }
]);

export function getSample(sampleId) {
  return SAMPLE_LIBRARY.find((sample) => sample.id === sampleId) ?? null;
}
