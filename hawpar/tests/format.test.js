/**
 * Unit tests for the shared formatting and parsing helpers.
 */
import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import {
  addDays,
  addMonths,
  formatDate,
  formatMoney,
  maskIdentifier,
  parseAmount,
  parseDate,
  titleCase,
  toIsoDate
} from '../src/lib/format.js';

describe('format helpers', () => {
  test('should_parse_amounts_with_thousand_separators_and_currency_prefixes', () => {
    assert.equal(parseAmount('SGD 1,234.56'), 1234.56);
    assert.equal(parseAmount('US$ 89.10'), 89.1);
    assert.equal(parseAmount('0'), 0);
  });

  test('should_return_null_for_values_that_are_not_amounts', () => {
    assert.equal(parseAmount('not a number'), null);
    assert.equal(parseAmount(null), null);
    assert.equal(parseAmount(''), null);
  });

  test('should_parse_dates_in_the_formats_haw_par_documents_use', () => {
    assert.equal(toIsoDate(parseDate('15 Mar 2026')), '2026-03-15');
    assert.equal(toIsoDate(parseDate('2026-03-15')), '2026-03-15');
    assert.equal(toIsoDate(parseDate('15/03/2026')), '2026-03-15');
  });

  test('should_return_null_for_unparseable_dates', () => {
    assert.equal(parseDate('not a date'), null);
    assert.equal(parseDate(''), null);
  });

  test('should_format_dates_consistently_for_generated_documents', () => {
    assert.equal(formatDate(new Date(Date.UTC(2026, 2, 15))), '15 Mar 2026');
  });

  test('should_add_days_and_months_without_mutating_the_source_date', () => {
    const source = new Date(Date.UTC(2026, 0, 31));
    assert.equal(toIsoDate(addDays(source, 1)), '2026-02-01');
    assert.equal(toIsoDate(addMonths(source, 1)).slice(0, 7), '2026-02');
    assert.equal(toIsoDate(source), '2026-01-31');
  });

  test('should_format_money_with_two_decimals_and_grouping', () => {
    assert.equal(formatMoney(1234.5), '1,234.50');
    assert.equal(formatMoney(0), '0.00');
  });

  test('should_mask_all_but_the_last_four_characters_of_an_identifier', () => {
    const masked = maskIdentifier('451903221999');
    assert.ok(masked.endsWith('1999'));
    assert.ok(!masked.includes('451903'));
  });

  test('should_title_case_lowercase_input', () => {
    assert.equal(titleCase('sunrise logistics group'), 'Sunrise Logistics Group');
  });
});
