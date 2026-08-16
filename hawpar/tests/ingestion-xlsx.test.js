/**
 * Unit tests for ingestion guard rails and the zero-dependency workbook writer.
 */
import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { buildWorkbook } from '../src/lib/xlsx.js';
import { sanitiseFileName, validateUpload } from '../src/services/ingestion.service.js';

const PDF_BYTES = Buffer.from('%PDF-1.7\n%âãÏÓ\n1 0 obj\n', 'latin1');
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const ZIP_LOCAL_HEADER = 0x04034b50;
const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;

describe('upload validation', () => {
  test('should_accept_a_pdf_with_a_matching_signature_and_extension', () => {
    const result = validateUpload({ buffer: PDF_BYTES, fileName: 'invoice.pdf', mimeType: 'application/pdf' });
    assert.equal(result.detectedFormat, 'pdf');
    assert.equal(result.extension, '.pdf');
  });

  test('should_reject_an_empty_file', () => {
    assert.throws(() => validateUpload({ buffer: Buffer.alloc(0), fileName: 'empty.pdf', mimeType: 'application/pdf' }));
  });

  test('should_reject_an_unsupported_extension', () => {
    assert.throws(
      () => validateUpload({ buffer: PDF_BYTES, fileName: 'payload.exe', mimeType: 'application/octet-stream' }),
      /not a supported file type/
    );
  });

  test('should_reject_a_file_whose_contents_do_not_match_its_extension', () => {
    assert.throws(
      () => validateUpload({ buffer: PNG_BYTES, fileName: 'disguised.pdf', mimeType: 'application/pdf' }),
      /do not match/
    );
  });

  test('should_reject_content_with_no_recognised_document_signature', () => {
    assert.throws(
      () => validateUpload({ buffer: Buffer.from('just some text'), fileName: 'notes.pdf', mimeType: 'application/pdf' }),
      /recognised document signature/
    );
  });

  test('should_strip_directory_traversal_from_supplied_file_names', () => {
    assert.equal(sanitiseFileName('../../etc/passwd'), 'passwd');
    assert.equal(sanitiseFileName('C:\\Windows\\system32\\cmd.exe'), 'cmd.exe');
    assert.equal(sanitiseFileName(''), 'document');
  });
});

describe('workbook writer', () => {
  test('should_produce_a_valid_zip_container_with_a_central_directory', () => {
    const buffer = buildWorkbook([
      { name: 'Documents', rows: [['Name', 'Pages'], ['Invoice', 3]] }
    ]);

    assert.ok(Buffer.isBuffer(buffer));
    assert.equal(buffer.readUInt32LE(0), ZIP_LOCAL_HEADER);
    assert.ok(buffer.length > 500);
    assert.equal(buffer.subarray(buffer.length - 22).readUInt32LE(0), ZIP_END_OF_CENTRAL_DIRECTORY);
  });

  test('should_build_a_workbook_containing_xml_sensitive_characters_without_throwing', () => {
    const buffer = buildWorkbook([
      { name: 'Sheet1', rows: [['Note'], ['Tiger & Balm <ointment> "regular"']] }
    ]);
    assert.equal(buffer.readUInt32LE(0), ZIP_LOCAL_HEADER);
  });

  test('should_support_multiple_sheets_and_sanitise_illegal_sheet_names', () => {
    const buffer = buildWorkbook([
      { name: 'One', rows: [['A'], ['x']] },
      { name: 'Two/Invalid:Name', rows: [['B'], ['y']] },
      { name: '', rows: [['C'], [1234.56, true, null]] }
    ]);
    assert.equal(buffer.readUInt32LE(0), ZIP_LOCAL_HEADER);
    assert.equal(buffer.subarray(buffer.length - 22).readUInt32LE(0), ZIP_END_OF_CENTRAL_DIRECTORY);
  });
});
