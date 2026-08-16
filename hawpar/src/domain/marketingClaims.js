/**
 * Distributor A&P (Advertising & Promotion) claim scenarios.
 *
 * A claim is a distributor's marketing-expense submission for reimbursement:
 * a consistent page-one summary (distributor, claim date, A&P code A1–A9, a
 * product-type spend summary and a line listing of the attached invoices) plus a
 * variable set of supporting attachments — vendor invoices (e.g. a Google Ads
 * bill), agency letters and handwritten/annotated notes. The A&P code is the
 * join key that binds a claim to its attachments.
 *
 * These two scenarios are authored to exercise the validation engine against the
 * exact discrepancy classes the marketing team checks by hand today:
 *   (a) an invoice date on the summary that does not tally with the attachment;
 *   (b) an amount mismatch to the dollar (13,349 claimed vs 13,348 on the bill);
 *   (c) an A&P code mismatch (A6 on the claim vs A7 on an attachment);
 *   (d) a product-type summation error (highlighted TBO/TBMP lines that do not
 *       sum back to the page-one subtotal).
 * Scenario A carries all of these; Scenario B reconciles cleanly. The demo
 * generators render these into real PDFs and the engine reasons over the
 * extracted fields — nothing is mocked at the API layer.
 *
 * Mark-up conventions (yellow highlight, circling, handwriting) are recorded on
 * each line so the extracted text mirrors how distributors annotate attachments.
 */

export const CLAIM_SCENARIOS = Object.freeze([
  {
    id: 'pop-us-summer',
    currency: 'USD',
    apCode: 'A6',
    claim: {
      claimNumber: 'MKT-CLM-2026-US-0412',
      distributor: 'POP Marketing LLC (USA)',
      claimDate: '10 Jun 2026',
      campaign: 'Tiger Balm Summer Sports Push 2026',
      claimAmount: 13349.0,
      // Page-one product-type spend summary as stated by the distributor.
      productSummary: [
        { productType: 'TBO', amount: 8000.0 },
        { productType: 'TBMP', amount: 5349.0 }
      ],
      // Page-one listing of the attached invoices (the figures the distributor
      // typed onto the summary — deliberately at odds with the attachments).
      lineItems: [
        {
          lineNo: 1,
          vendor: 'Google LLC',
          invoiceRef: 'INV-GOOG-88213',
          invoiceDate: '12 Jun 2026',
          apCode: 'A6',
          productType: 'Mixed (TBO, TBMP)',
          amount: 13349.0,
          annotation: 'Yellow highlight'
        },
        {
          lineNo: 2,
          vendor: 'AgencyOne Creative',
          invoiceRef: 'LT-AGO-2231',
          invoiceDate: '08 Jun 2026',
          apCode: 'A6',
          productType: 'Creative services',
          amount: 0.0,
          annotation: 'Handwritten note'
        }
      ]
    },
    supporting: [
      {
        kind: 'Vendor Tax Invoice',
        vendor: 'Google LLC',
        reference: 'INV-GOOG-88213',
        date: '05 Jun 2026', // (a) differs from the 12 Jun date on the summary
        amount: 13348.0, // (b) one dollar under the 13,349 claimed
        apCodeRef: 'A6',
        productType: 'Mixed (TBO, TBMP)',
        note: 'Google Ads billing for the Summer Sports campaign. Highlighted lines grouped by product type.',
        lineItems: [
          { label: 'Search — Summer Sports (TBO)', productType: 'TBO', amount: 4000.0, annotation: 'Yellow highlight' },
          { label: 'YouTube — Summer Sports (TBO)', productType: 'TBO', amount: 3500.0, annotation: 'Yellow highlight' },
          { label: 'Display — Plaster Promo (TBMP)', productType: 'TBMP', amount: 5848.0, annotation: 'Yellow highlight' }
        ]
      },
      {
        kind: 'Agency Cover Letter',
        vendor: 'AgencyOne Creative',
        reference: 'LT-AGO-2231',
        date: '08 Jun 2026',
        amount: null,
        apCodeRef: 'A7', // (c) A7 on the attachment vs A6 on the claim
        productType: null,
        note: 'Creative production cover letter accompanying the campaign artwork. A&P code hand-stamped as A7.',
        lineItems: []
      }
    ]
  },
  {
    id: 'watsons-my-ramadan',
    currency: 'SGD',
    apCode: 'A2',
    claim: {
      claimNumber: 'MKT-CLM-2026-MY-0335',
      distributor: 'Watsons Personal Care Stores (M) Sdn Bhd',
      claimDate: '20 May 2026',
      campaign: 'Tiger Balm Ramadan Digital 2026',
      claimAmount: 9600.0,
      productSummary: [
        { productType: 'TBO', amount: 6600.0 },
        { productType: 'TBMP', amount: 3000.0 }
      ],
      lineItems: [
        {
          lineNo: 1,
          vendor: 'Google LLC',
          invoiceRef: 'INV-GOOG-77120',
          invoiceDate: '16 May 2026',
          apCode: 'A2',
          productType: 'TBO',
          amount: 6600.0,
          annotation: 'Yellow highlight'
        },
        {
          lineNo: 2,
          vendor: 'Meta Platforms Inc',
          invoiceRef: 'INV-META-4408',
          invoiceDate: '15 May 2026',
          apCode: 'A2',
          productType: 'TBMP',
          amount: 3000.0,
          annotation: 'Circled'
        }
      ]
    },
    supporting: [
      {
        kind: 'Vendor Tax Invoice',
        vendor: 'Google LLC',
        reference: 'INV-GOOG-77120',
        date: '16 May 2026',
        amount: 6600.0,
        apCodeRef: 'A2',
        productType: 'TBO',
        note: 'Google Ads billing for the Ramadan digital campaign.',
        lineItems: [
          { label: 'Search — Ramadan Wellness (TBO)', productType: 'TBO', amount: 3600.0, annotation: 'Yellow highlight' },
          { label: 'YouTube — Ramadan Wellness (TBO)', productType: 'TBO', amount: 3000.0, annotation: 'Yellow highlight' }
        ]
      },
      {
        kind: 'Vendor Tax Invoice',
        vendor: 'Meta Platforms Inc',
        reference: 'INV-META-4408',
        date: '15 May 2026',
        amount: 3000.0,
        apCodeRef: 'A2',
        productType: 'TBMP',
        note: 'Meta (Instagram/Facebook) billing for the plaster promotion.',
        lineItems: [
          { label: 'Reels — Plaster Promo (TBMP)', productType: 'TBMP', amount: 3000.0, annotation: 'Circled' }
        ]
      }
    ]
  }
]);

const SCENARIO_INDEX = new Map(CLAIM_SCENARIOS.map((scenario) => [scenario.id, scenario]));

export function getClaimScenario(id) {
  return SCENARIO_INDEX.get(id) ?? null;
}
