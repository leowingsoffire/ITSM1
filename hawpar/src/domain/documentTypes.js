/**
 * VGC Group document taxonomy.
 *
 * Each document type declares:
 *  - the business unit that owns it,
 *  - classification signals (keywords / regex) used for auto-routing,
 *  - the fields to extract, with type, criticality and extraction patterns,
 *  - business validation rules applied after extraction.
 *
 * This is the single source of truth shared by the classifier, the extractor,
 * the validator, the demo engine and the UI.
 */

export const BusinessUnit = Object.freeze({
  HEALTHCARE: 'Healthcare (Tiger Balm)',
  LEISURE: 'Leisure & Hospitality',
  PROPERTY: 'Property',
  INVESTMENTS: 'Investments',
  CORPORATE: 'Corporate Services'
});

export const FieldType = Object.freeze({
  STRING: 'string',
  NUMBER: 'number',
  CURRENCY: 'currency',
  DATE: 'date',
  TABLE: 'table'
});

/** Fields flagged `critical` always go to review when confidence is low or the value is missing. */
const f = (key, label, type, options = {}) =>
  Object.freeze({
    key,
    label,
    type,
    critical: options.critical === true,
    // The printed label is always a valid alias: keeping it first means an exact
    // header match wins before any fuzzy fallback is attempted.
    aliases: Object.freeze([...new Set([label, ...(options.aliases ?? [])])]),
    pattern: options.pattern ?? null,
    unit: options.unit ?? null
  });

export const DOCUMENT_TYPES = Object.freeze([
  {
    id: 'supplier_invoice',
    name: 'Supplier Invoice',
    businessUnit: BusinessUnit.CORPORATE,
    process: 'Accounts Payable',
    icon: 'invoice',
    typicalPages: [1, 6],
    keywords: ['tax invoice', 'invoice no', 'invoice number', 'gst', 'amount due', 'remit to', 'payment terms'],
    fields: [
      f('invoiceNumber', 'Invoice Number', FieldType.STRING, {
        critical: true,
        aliases: ['Invoice Number', 'Invoice No', 'Invoice #', 'Tax Invoice No'],
        pattern: /invoice\s*(?:no\.?|number|#)\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-/]{3,24})/i
      }),
      f('invoiceDate', 'Invoice Date', FieldType.DATE, {
        critical: true,
        aliases: ['Invoice Date', 'Date', 'Issue Date'],
        pattern: /invoice\s*date\s*[:\-]?\s*([0-9]{1,2}[ \-/][A-Za-z0-9]{2,9}[ \-/][0-9]{2,4})/i
      }),
      f('dueDate', 'Payment Due Date', FieldType.DATE, {
        aliases: ['Due Date', 'Payment Due', 'Payment Due Date'],
        pattern: /due\s*date\s*[:\-]?\s*([0-9]{1,2}[ \-/][A-Za-z0-9]{2,9}[ \-/][0-9]{2,4})/i
      }),
      f('supplierName', 'Supplier Name', FieldType.STRING, {
        critical: true,
        aliases: ['Supplier', 'Vendor', 'Bill From', 'Sold By']
      }),
      f('supplierUen', 'Supplier UEN / Tax ID', FieldType.STRING, {
        aliases: ['UEN', 'GST Reg No', 'Tax ID', 'Company Reg No'],
        pattern: /(?:uen|gst\s*reg(?:istration)?\s*no\.?|tax\s*id)\s*[:\-]?\s*([A-Z0-9]{8,14})/i
      }),
      f('purchaseOrderRef', 'PO Reference', FieldType.STRING, {
        aliases: ['PO No', 'Purchase Order', 'Your Order No'],
        pattern: /\bP\.?O\.?\s*(?:no\.?|number|ref)?\s*[:\-]?\s*(HP-PO-[0-9]{4}-[0-9]{4,6}|[A-Z0-9\-]{6,20})/i
      }),
      f('currency', 'Currency', FieldType.STRING, {
        aliases: ['Currency', 'CCY'],
        pattern: /\b(SGD|USD|MYR|EUR|GBP|HKD|CNY|THB|AUD|JPY)\b/
      }),
      f('subtotal', 'Subtotal', FieldType.CURRENCY, {
        aliases: ['Subtotal', 'Sub Total', 'Net Amount', 'Total before GST'],
        pattern: /sub\s*-?total\s*[:\-]?\s*(?:[A-Z]{3})?\s*\$?\s*([0-9][0-9,]*\.?[0-9]{0,2})/i
      }),
      f('taxAmount', 'GST / Tax Amount', FieldType.CURRENCY, {
        aliases: ['GST', 'Tax', 'GST Amount', 'VAT'],
        pattern: /\b(?:gst|vat|tax)\b[^0-9\n]{0,20}?([0-9][0-9,]*\.[0-9]{2})/i
      }),
      f('totalAmount', 'Total Amount Payable', FieldType.CURRENCY, {
        critical: true,
        aliases: ['Total', 'Total Amount', 'Amount Due', 'Grand Total', 'Total Payable'],
        pattern: /(?:grand\s*total|total\s*(?:amount)?\s*(?:payable|due)?)\s*[:\-]?\s*(?:[A-Z]{3})?\s*\$?\s*([0-9][0-9,]*\.[0-9]{2})/i
      }),
      f('lineItems', 'Line Items', FieldType.TABLE, { critical: false })
    ],
    rules: ['totals_reconcile', 'gst_rate_singapore', 'due_after_invoice_date', 'currency_present']
  },
  {
    id: 'purchase_order',
    name: 'Purchase Order',
    businessUnit: BusinessUnit.CORPORATE,
    process: 'Procurement',
    icon: 'cart',
    typicalPages: [1, 4],
    keywords: ['purchase order', 'po number', 'ship to', 'requisition', 'delivery date', 'buyer'],
    fields: [
      f('poNumber', 'PO Number', FieldType.STRING, {
        critical: true,
        aliases: ['PO Number', 'Purchase Order No', 'Order No'],
        pattern: /(?:purchase\s*order|p\.?o\.?)\s*(?:no\.?|number)?\s*[:\-]?\s*(HP-PO-[0-9]{4}-[0-9]{4,6}|[A-Z0-9\-]{6,20})/i
      }),
      f('poDate', 'PO Date', FieldType.DATE, { critical: true, aliases: ['PO Date', 'Order Date', 'Date'] }),
      f('supplierName', 'Supplier', FieldType.STRING, { critical: true, aliases: ['Supplier', 'Vendor', 'To'] }),
      f('deliveryDate', 'Required Delivery Date', FieldType.DATE, {
        aliases: ['Delivery Date', 'Required By', 'Ship By']
      }),
      f('deliveryLocation', 'Deliver To', FieldType.STRING, { aliases: ['Ship To', 'Deliver To', 'Delivery Address'] }),
      f('currency', 'Currency', FieldType.STRING, { aliases: ['Currency'] }),
      f('totalAmount', 'Order Value', FieldType.CURRENCY, {
        critical: true,
        aliases: ['Total', 'Order Value', 'Total Amount']
      }),
      f('approver', 'Authorised By', FieldType.STRING, { aliases: ['Approved By', 'Authorised By', 'Buyer'] }),
      f('lineItems', 'Order Lines', FieldType.TABLE)
    ],
    rules: ['totals_reconcile', 'delivery_after_order_date', 'approval_present']
  },
  {
    id: 'delivery_order',
    name: 'Delivery Order / GRN',
    businessUnit: BusinessUnit.HEALTHCARE,
    process: 'Inbound Logistics',
    icon: 'truck',
    typicalPages: [1, 3],
    keywords: ['delivery order', 'goods received', 'do no', 'received by', 'quantity delivered', 'carrier'],
    fields: [
      f('deliveryOrderNumber', 'DO Number', FieldType.STRING, {
        critical: true,
        aliases: ['DO No', 'Delivery Order No', 'Delivery Note No'],
        pattern: /(?:d\.?o\.?|delivery\s*(?:order|note))\s*(?:no\.?|number)?\s*[:\-]?\s*([A-Z0-9\-]{5,20})/i
      }),
      f('deliveryDate', 'Delivery Date', FieldType.DATE, { critical: true, aliases: ['Delivery Date', 'Date'] }),
      f('purchaseOrderRef', 'PO Reference', FieldType.STRING, { critical: true, aliases: ['PO No', 'Your Order No'] }),
      f('carrier', 'Carrier', FieldType.STRING, { aliases: ['Carrier', 'Transporter', 'Forwarder'] }),
      f('receivedBy', 'Received By', FieldType.STRING, { aliases: ['Received By', 'Recipient Name'] }),
      f('totalCartons', 'Total Cartons', FieldType.NUMBER, {
        aliases: ['Total Cartons', 'No. of Cartons', 'Packages'],
        pattern: /(?:total\s*)?(?:cartons|packages|ctns)\s*[:\-]?\s*([0-9]{1,6})/i
      }),
      f('lineItems', 'Delivered Items', FieldType.TABLE)
    ],
    rules: ['quantities_positive', 'po_reference_present']
  },
  {
    id: 'certificate_of_analysis',
    name: 'Certificate of Analysis',
    businessUnit: BusinessUnit.HEALTHCARE,
    process: 'Quality Assurance',
    icon: 'flask',
    typicalPages: [2, 8],
    keywords: ['certificate of analysis', 'batch no', 'specification', 'test result', 'assay', 'complies', 'shelf life'],
    fields: [
      f('productName', 'Product', FieldType.STRING, {
        critical: true,
        aliases: ['Product', 'Product Name', 'Material']
      }),
      f('batchNumber', 'Batch / Lot Number', FieldType.STRING, {
        critical: true,
        aliases: ['Batch No', 'Lot No', 'Batch Number'],
        pattern: /(?:batch|lot)\s*(?:no\.?|number)?\s*[:\-]?\s*([A-Z0-9\-]{4,20})/i
      }),
      f('manufactureDate', 'Manufacture Date', FieldType.DATE, { aliases: ['Manufacture Date', 'Mfg Date', 'Date of Manufacture'] }),
      f('expiryDate', 'Expiry Date', FieldType.DATE, {
        critical: true,
        aliases: ['Expiry Date', 'Exp Date', 'Best Before', 'Use By']
      }),
      f('batchQuantity', 'Batch Quantity', FieldType.NUMBER, { aliases: ['Batch Size', 'Quantity', 'Batch Quantity'] }),
      f('overallResult', 'Overall Disposition', FieldType.STRING, {
        critical: true,
        aliases: ['Result', 'Disposition', 'Conclusion', 'Status'],
        pattern: /\b(pass|passed|complies|conforms|approved|released|fail|failed|rejected|quarantine)\b/i
      }),
      f('approvedBy', 'Approved By (QA)', FieldType.STRING, { aliases: ['Approved By', 'QA Manager', 'Authorised Signatory'] }),
      f('testResults', 'Test Results', FieldType.TABLE, { critical: true })
    ],
    rules: ['expiry_after_manufacture', 'qa_disposition_valid', 'all_tests_within_spec']
  },
  {
    id: 'bill_of_lading',
    name: 'Bill of Lading',
    businessUnit: BusinessUnit.HEALTHCARE,
    process: 'Export Logistics',
    icon: 'ship',
    typicalPages: [1, 4],
    keywords: ['bill of lading', 'shipper', 'consignee', 'port of loading', 'port of discharge', 'vessel', 'container no'],
    fields: [
      f('blNumber', 'B/L Number', FieldType.STRING, {
        critical: true,
        aliases: ['B/L No', 'Bill of Lading No', 'Document No'],
        pattern: /b\/?l\s*(?:no\.?|number)?\s*[:\-]?\s*([A-Z0-9\-]{6,22})/i
      }),
      f('shipper', 'Shipper', FieldType.STRING, { critical: true, aliases: ['Shipper', 'Exporter'] }),
      f('consignee', 'Consignee', FieldType.STRING, { critical: true, aliases: ['Consignee', 'Deliver To'] }),
      f('vessel', 'Vessel / Voyage', FieldType.STRING, { aliases: ['Vessel', 'Vessel/Voyage', 'Voyage No'] }),
      f('portOfLoading', 'Port of Loading', FieldType.STRING, { aliases: ['Port of Loading', 'POL'] }),
      f('portOfDischarge', 'Port of Discharge', FieldType.STRING, { aliases: ['Port of Discharge', 'POD'] }),
      f('containerNumber', 'Container Number', FieldType.STRING, {
        aliases: ['Container No', 'Container Number'],
        pattern: /\b([A-Z]{4}\s?[0-9]{7})\b/
      }),
      f('grossWeight', 'Gross Weight', FieldType.NUMBER, { aliases: ['Gross Weight', 'G.W.'], unit: 'KG' }),
      f('shippedOnBoardDate', 'Shipped On Board', FieldType.DATE, { aliases: ['Shipped On Board', 'On Board Date'] })
    ],
    rules: ['container_format_valid', 'ports_present']
  },
  {
    id: 'product_registration',
    name: 'Product Registration / Licence',
    businessUnit: BusinessUnit.HEALTHCARE,
    process: 'Regulatory Affairs',
    icon: 'shield',
    typicalPages: [2, 12],
    keywords: ['product registration', 'licence', 'license no', 'health authority', 'registration number', 'valid until', 'marketing authorisation'],
    fields: [
      f('registrationNumber', 'Registration Number', FieldType.STRING, {
        critical: true,
        aliases: ['Registration No', 'Licence No', 'Approval No'],
        pattern: /(?:registration|licen[cs]e|approval)\s*(?:no\.?|number)?\s*[:\-]?\s*([A-Z0-9\-/]{5,24})/i
      }),
      f('productName', 'Product Name', FieldType.STRING, { critical: true, aliases: ['Product', 'Product Name', 'Brand'] }),
      f('country', 'Jurisdiction', FieldType.STRING, { critical: true, aliases: ['Country', 'Jurisdiction', 'Territory'] }),
      f('authority', 'Issuing Authority', FieldType.STRING, { aliases: ['Authority', 'Issued By', 'Regulator'] }),
      f('issueDate', 'Issue Date', FieldType.DATE, { aliases: ['Issue Date', 'Date of Issue'] }),
      f('expiryDate', 'Valid Until', FieldType.DATE, {
        critical: true,
        aliases: ['Valid Until', 'Expiry Date', 'Renewal Date']
      }),
      f('licenceHolder', 'Licence Holder', FieldType.STRING, { aliases: ['Licence Holder', 'Registrant', 'Applicant'] })
    ],
    rules: ['expiry_in_future', 'jurisdiction_known']
  },
  {
    id: 'trademark_certificate',
    name: 'Trademark Certificate',
    businessUnit: BusinessUnit.CORPORATE,
    process: 'Legal & IP',
    icon: 'trademark',
    typicalPages: [1, 6],
    keywords: ['trade mark', 'trademark', 'registration certificate', 'nice classification', 'class', 'proprietor', 'renewal due'],
    fields: [
      f('trademarkNumber', 'Trademark Number', FieldType.STRING, {
        critical: true,
        aliases: ['Trade Mark No', 'Registration No', 'Application No'],
        pattern: /(?:trade\s*mark|registration|application)\s*(?:no\.?|number)?\s*[:\-]?\s*([A-Z0-9\-/]{5,20})/i
      }),
      f('markText', 'Mark', FieldType.STRING, { critical: true, aliases: ['Mark', 'Trade Mark', 'Word Mark'] }),
      f('proprietor', 'Proprietor', FieldType.STRING, { critical: true, aliases: ['Proprietor', 'Owner', 'Registered Owner'] }),
      f('niceClasses', 'Nice Class(es)', FieldType.STRING, {
        aliases: ['Class', 'Classes', 'Nice Classification'],
        pattern: /class(?:es)?\s*[:\-]?\s*([0-9]{1,2}(?:\s*,\s*[0-9]{1,2})*)/i
      }),
      f('country', 'Territory', FieldType.STRING, { critical: true, aliases: ['Country', 'Territory', 'Jurisdiction'] }),
      f('registrationDate', 'Registration Date', FieldType.DATE, { aliases: ['Registration Date', 'Date of Registration'] }),
      f('renewalDueDate', 'Renewal Due', FieldType.DATE, {
        critical: true,
        aliases: ['Renewal Date', 'Renewal Due', 'Expiry Date']
      })
    ],
    rules: ['renewal_in_future', 'proprietor_is_group_entity']
  },
  {
    id: 'tenancy_agreement',
    name: 'Tenancy / Lease Agreement',
    businessUnit: BusinessUnit.PROPERTY,
    process: 'Property Management',
    icon: 'building',
    typicalPages: [12, 48],
    keywords: ['tenancy agreement', 'lease', 'landlord', 'tenant', 'rent', 'security deposit', 'term of lease', 'premises'],
    fields: [
      f('agreementReference', 'Agreement Reference', FieldType.STRING, {
        critical: true,
        aliases: ['Agreement No', 'Reference', 'Contract No']
      }),
      f('landlord', 'Landlord', FieldType.STRING, { critical: true, aliases: ['Landlord', 'Lessor'] }),
      f('tenant', 'Tenant', FieldType.STRING, { critical: true, aliases: ['Tenant', 'Lessee'] }),
      f('premises', 'Demised Premises', FieldType.STRING, { critical: true, aliases: ['Premises', 'Property', 'Unit'] }),
      f('leaseStartDate', 'Lease Commencement', FieldType.DATE, {
        critical: true,
        aliases: ['Commencement Date', 'Start Date', 'Lease From']
      }),
      f('leaseEndDate', 'Lease Expiry', FieldType.DATE, {
        critical: true,
        aliases: ['Expiry Date', 'End Date', 'Lease To']
      }),
      f('monthlyRent', 'Monthly Rent', FieldType.CURRENCY, { critical: true, aliases: ['Monthly Rent', 'Rent', 'Rental'] }),
      f('securityDeposit', 'Security Deposit', FieldType.CURRENCY, { aliases: ['Security Deposit', 'Deposit'] }),
      f('lettableArea', 'Lettable Area', FieldType.NUMBER, { aliases: ['Area', 'Lettable Area', 'Floor Area'], unit: 'sq ft' }),
      f('optionToRenew', 'Option to Renew', FieldType.STRING, { aliases: ['Option to Renew', 'Renewal Option'] })
    ],
    rules: ['lease_end_after_start', 'deposit_vs_rent_ratio', 'rent_positive']
  },
  {
    id: 'annual_report',
    name: 'Annual Report / Financial Statements',
    businessUnit: BusinessUnit.INVESTMENTS,
    process: 'Group Reporting',
    icon: 'chart',
    typicalPages: [110, 220],
    keywords: ['annual report', 'consolidated statement', 'financial position', 'auditor', 'earnings per share', 'directors report', 'notes to the financial statements'],
    fields: [
      f('financialYear', 'Financial Year', FieldType.STRING, {
        critical: true,
        aliases: ['Financial Year', 'FY', 'Year Ended'],
        pattern: /(?:financial\s*year|year\s*ended)[^0-9]{0,20}(20[0-9]{2})/i
      }),
      f('entityName', 'Reporting Entity', FieldType.STRING, { critical: true, aliases: ['Company', 'Entity', 'Group'] }),
      f('revenue', 'Revenue', FieldType.CURRENCY, { critical: true, aliases: ['Revenue', 'Turnover', 'Total Revenue'] }),
      f('profitBeforeTax', 'Profit Before Tax', FieldType.CURRENCY, { aliases: ['Profit Before Tax', 'PBT'] }),
      f('netProfit', 'Profit Attributable to Shareholders', FieldType.CURRENCY, {
        critical: true,
        aliases: ['Net Profit', 'Profit for the year', 'Profit Attributable to Owners']
      }),
      f('totalAssets', 'Total Assets', FieldType.CURRENCY, { critical: true, aliases: ['Total Assets'] }),
      f('totalEquity', 'Total Equity', FieldType.CURRENCY, { aliases: ['Total Equity', 'Shareholders Funds'] }),
      f('earningsPerShare', 'Earnings Per Share', FieldType.NUMBER, { aliases: ['Earnings Per Share', 'EPS'], unit: 'cents' }),
      f('dividendPerShare', 'Dividend Per Share', FieldType.NUMBER, { aliases: ['Dividend Per Share', 'DPS'], unit: 'cents' }),
      f('auditor', 'Independent Auditor', FieldType.STRING, { aliases: ['Auditor', 'Independent Auditor'] }),
      f('auditOpinion', 'Audit Opinion', FieldType.STRING, {
        critical: true,
        aliases: ['Opinion', 'Audit Opinion'],
        pattern: /\b(unqualified|unmodified|qualified|adverse|disclaimer)\s+opinion\b/i
      }),
      f('segmentResults', 'Segment Results', FieldType.TABLE, { critical: true })
    ],
    rules: ['assets_equal_liabilities_plus_equity', 'audit_opinion_clean', 'financial_year_plausible']
  },
  {
    id: 'bank_statement',
    name: 'Bank Statement',
    businessUnit: BusinessUnit.CORPORATE,
    process: 'Treasury',
    icon: 'bank',
    typicalPages: [3, 40],
    keywords: ['statement of account', 'opening balance', 'closing balance', 'value date', 'withdrawal', 'deposit', 'account no'],
    fields: [
      f('accountNumber', 'Account Number', FieldType.STRING, {
        critical: true,
        aliases: ['Account No', 'Account Number'],
        pattern: /account\s*(?:no\.?|number)\s*[:\-]?\s*([0-9\-\s]{6,24})/i
      }),
      f('bankName', 'Bank', FieldType.STRING, { critical: true, aliases: ['Bank', 'Bank Name'] }),
      f('statementPeriod', 'Statement Period', FieldType.STRING, { critical: true, aliases: ['Period', 'Statement Period'] }),
      f('currency', 'Currency', FieldType.STRING, { aliases: ['Currency'] }),
      f('openingBalance', 'Opening Balance', FieldType.CURRENCY, { critical: true, aliases: ['Opening Balance', 'Balance B/F'] }),
      f('totalCredits', 'Total Credits', FieldType.CURRENCY, { aliases: ['Total Credits', 'Total Deposits'] }),
      f('totalDebits', 'Total Debits', FieldType.CURRENCY, { aliases: ['Total Debits', 'Total Withdrawals'] }),
      f('closingBalance', 'Closing Balance', FieldType.CURRENCY, { critical: true, aliases: ['Closing Balance', 'Balance C/F'] }),
      f('transactions', 'Transactions', FieldType.TABLE, { critical: true })
    ],
    rules: ['bank_balance_reconciles', 'account_number_masked']
  },
  {
    id: 'employee_claim',
    name: 'Employee Expense Claim',
    businessUnit: BusinessUnit.CORPORATE,
    process: 'Human Resources',
    icon: 'receipt',
    typicalPages: [1, 12],
    keywords: ['expense claim', 'claim form', 'employee no', 'reimbursement', 'receipt attached', 'claim period'],
    fields: [
      f('claimNumber', 'Claim Number', FieldType.STRING, { critical: true, aliases: ['Claim No', 'Claim Reference'] }),
      f('employeeName', 'Employee Name', FieldType.STRING, { critical: true, aliases: ['Employee', 'Name', 'Claimant'] }),
      f('employeeId', 'Employee ID', FieldType.STRING, { critical: true, aliases: ['Employee No', 'Staff ID', 'Employee ID'] }),
      f('department', 'Department', FieldType.STRING, { aliases: ['Department', 'Cost Centre', 'Division'] }),
      f('claimPeriod', 'Claim Period', FieldType.STRING, { aliases: ['Period', 'Claim Period', 'Month'] }),
      f('totalAmount', 'Total Claimed', FieldType.CURRENCY, { critical: true, aliases: ['Total', 'Total Claimed', 'Amount'] }),
      f('approver', 'Approved By', FieldType.STRING, { critical: true, aliases: ['Approved By', 'Supervisor', 'Manager'] }),
      f('lineItems', 'Claim Lines', FieldType.TABLE)
    ],
    rules: ['totals_reconcile', 'approval_present', 'claim_within_policy_cap']
  },
  {
    id: 'marketing_claim',
    name: 'Marketing Claim Summary',
    businessUnit: BusinessUnit.CORPORATE,
    process: 'Trade Marketing (A&P)',
    icon: 'tag',
    typicalPages: [1, 4],
    keywords: [
      'marketing claim',
      'marketing expense claim',
      'advertising & promotion',
      'a&p code',
      'a&p reference',
      'claim summary',
      'distributor claim',
      'co-op advertising',
      'campaign'
    ],
    fields: [
      f('claimNumber', 'Claim Number', FieldType.STRING, {
        critical: true,
        aliases: ['Claim Number', 'Claim No', 'Claim Reference', 'Claim Ref'],
        pattern: /claim\s*(?:no\.?|number|ref(?:erence)?)\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-/]{4,28})/i
      }),
      f('distributorName', 'Distributor', FieldType.STRING, {
        critical: true,
        aliases: ['Distributor', 'Distributor Name', 'Claimant', 'Dealer']
      }),
      f('claimDate', 'Claim Date', FieldType.DATE, {
        critical: true,
        aliases: ['Claim Date', 'Summary Date', 'Invoice Date', 'Date'],
        pattern: /claim\s*date\s*[:\-]?\s*([0-9]{1,2}[ \-/][A-Za-z0-9]{2,9}[ \-/][0-9]{2,4})/i
      }),
      f('apCode', 'A&P Code', FieldType.STRING, {
        critical: true,
        aliases: ['A&P Code', 'AP Code', 'A&P Reference', 'Marketing Code', 'A&P Ref'],
        pattern: /a\s*&?\s*p\s*(?:code|ref(?:erence)?)\s*[:\-]?\s*(A[1-9]\b|[A-Z0-9][A-Z0-9\-]{4,28})/i
      }),
      f('productCodes', 'Product Type Codes', FieldType.STRING, {
        critical: false,
        aliases: ['Product Type Codes', 'Product Codes', 'Product Type', 'SKUs']
      }),
      f('campaignName', 'Campaign', FieldType.STRING, {
        aliases: ['Campaign', 'Campaign Name', 'Programme']
      }),
      f('claimAmount', 'Claim Amount', FieldType.CURRENCY, {
        critical: true,
        aliases: ['Claim Amount', 'Total Claim', 'Amount Claimed', 'Total Claimed', 'Total'],
        pattern: /(?:claim\s*amount|total\s*claim(?:ed)?)\s*[:\-]?\s*[A-Z]{3}?\s*\$?\s*([0-9][0-9,]*\.[0-9]{2})/i
      }),
      f('claimCurrency', 'Currency', FieldType.STRING, {
        aliases: ['Currency', 'Claim Currency']
      }),
      f('supportingCount', 'Supporting Documents', FieldType.NUMBER, {
        aliases: ['Supporting Documents', 'Attachments', 'No of Attachments']
      }),
      f('productSummary', 'Product Type Summary', FieldType.TABLE, { critical: false }),
      f('lineItems', 'Claim Line Items', FieldType.TABLE, { critical: false })
    ],
    rules: ['claim_has_ap_code', 'claim_amount_positive', 'claim_products_present']
  },
  {
    id: 'marketing_support',
    name: 'A&P Supporting Document',
    businessUnit: BusinessUnit.CORPORATE,
    process: 'Trade Marketing (A&P)',
    icon: 'invoice',
    typicalPages: [1, 6],
    keywords: [
      'advertising supporting invoice',
      'a&p supporting document',
      'campaign material',
      'proof of performance',
      'media invoice',
      'advertising invoice',
      'a&p code',
      'distributor claim cover letter'
    ],
    fields: [
      f('vendorName', 'Vendor', FieldType.STRING, {
        critical: true,
        aliases: ['Vendor', 'Vendor Name', 'Supplier', 'Issued By', 'From']
      }),
      f('documentReference', 'Reference', FieldType.STRING, {
        critical: true,
        aliases: ['Reference', 'Invoice No', 'Document Reference', 'Ref No', 'Invoice Number']
      }),
      f('documentDate', 'Document Date', FieldType.DATE, {
        critical: true,
        aliases: ['Document Date', 'Date', 'Invoice Date', 'Issue Date']
      }),
      f('amount', 'Amount', FieldType.CURRENCY, {
        critical: true,
        aliases: ['Amount', 'Total', 'Total Amount', 'Amount Payable', 'Grand Total']
      }),
      f('apCodeRef', 'A&P Code', FieldType.STRING, {
        critical: true,
        aliases: ['A&P Code', 'AP Code', 'A&P Reference', 'Marketing Code', 'A&P Ref'],
        pattern: /a\s*&?\s*p\s*(?:code|ref(?:erence)?)\s*[:\-]?\s*(A[1-9]\b|[A-Z0-9][A-Z0-9\-]{4,28})/i
      }),
      f('productType', 'Product Type', FieldType.STRING, {
        aliases: ['Product Type', 'Product', 'Product Category']
      }),
      f('documentKind', 'Document Kind', FieldType.STRING, {
        aliases: ['Document Kind', 'Type', 'Category']
      }),
      f('lineItems', 'Highlighted Line Items', FieldType.TABLE, { critical: false })
    ],
    rules: ['support_has_ap_code']
  },
  {
    id: 'unclassified',
    name: 'Unclassified Document',
    businessUnit: BusinessUnit.CORPORATE,
    process: 'Manual Triage',
    icon: 'question',
    typicalPages: [1, 20],
    keywords: [],
    fields: [],
    rules: []
  }
]);

const TYPE_INDEX = new Map(DOCUMENT_TYPES.map((type) => [type.id, type]));

/** @param {string} id @returns {typeof DOCUMENT_TYPES[number]} */
export function getDocumentType(id) {
  return TYPE_INDEX.get(id) ?? TYPE_INDEX.get('unclassified');
}

export function listClassifiableTypes() {
  return DOCUMENT_TYPES.filter((type) => type.id !== 'unclassified');
}

/** Business rule catalogue surfaced in the UI so reviewers understand each failure. */
export const RULE_CATALOGUE = Object.freeze({
  totals_reconcile: 'Subtotal + tax must equal the stated total (±0.02 tolerance).',
  gst_rate_singapore: 'Singapore GST must be 9% of the subtotal (±0.5% tolerance).',
  due_after_invoice_date: 'Payment due date must not precede the invoice date.',
  currency_present: 'An ISO-4217 currency code must be present.',
  delivery_after_order_date: 'Required delivery date must not precede the order date.',
  approval_present: 'An approver name must be captured for segregation of duties.',
  quantities_positive: 'All delivered quantities must be greater than zero.',
  po_reference_present: 'A purchase order reference is mandatory for three-way matching.',
  expiry_after_manufacture: 'Expiry date must be after the manufacture date.',
  qa_disposition_valid: 'QA disposition must be an approved release status.',
  all_tests_within_spec: 'Every QC test result must be within specification.',
  container_format_valid: 'Container number must follow the ISO 6346 format (4 letters + 7 digits).',
  ports_present: 'Both port of loading and port of discharge are required.',
  expiry_in_future: 'Registration must not be expired.',
  jurisdiction_known: 'Jurisdiction must be a market VGC operates in.',
  renewal_in_future: 'Trademark renewal date must be in the future.',
  proprietor_is_group_entity: 'Proprietor should be a VGC group entity.',
  lease_end_after_start: 'Lease expiry must be after commencement.',
  deposit_vs_rent_ratio: 'Security deposit should be between 1 and 6 months of rent.',
  rent_positive: 'Monthly rent must be greater than zero.',
  assets_equal_liabilities_plus_equity: 'Total assets must be at least total equity.',
  audit_opinion_clean: 'Audit opinion should be unqualified / unmodified.',
  financial_year_plausible: 'Financial year must be within the last 20 years.',
  bank_balance_reconciles: 'Opening + credits − debits must equal the closing balance.',
  account_number_masked: 'Bank account numbers must be masked at rest (PDPA).',
  claim_within_policy_cap: 'Expense claim must not exceed the S$5,000 policy cap without escalation.',
  claim_has_ap_code: 'A marketing claim must carry a valid Advertising & Promotion (A&P) code.',
  claim_amount_positive: 'The claimed marketing amount must be greater than zero.',
  claim_products_present: 'At least one product type code must be named on the claim.',
  support_has_ap_code: 'Each supporting document must reference the parent A&P code for traceability.',
  // Cross-document reconciliation checks (evaluated by the claims engine).
  claim_amount_matches_support: 'The claimed amount must equal the total of the supporting invoices (±0.02).',
  line_invoice_amounts_match: 'Each invoice amount on the summary must equal the amount on the matching attachment.',
  line_invoice_dates_match: 'Each invoice date on the summary must match the date on the matching attachment.',
  product_type_summation: 'Highlighted lines per product type must sum back to the page-one product-type subtotal.',
  ap_code_within_budget: 'The claimed amount must fit within the remaining annual budget for the A&P code.',
  support_dates_align: 'Supporting invoice dates must not fall after the claim summary date.',
  support_ap_code_matches: 'Every supporting document must quote the same A&P code as the claim.',
  distributor_referenced: 'At least one supporting document should reference the claiming distributor.',
  product_codes_supported: 'Claimed product type codes should be evidenced in the supporting documents.'
});
