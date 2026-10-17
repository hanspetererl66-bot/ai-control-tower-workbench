import assert from 'node:assert/strict';
import test from 'node:test';

import { csvVerificationDigest } from '../src/data-grounding.ts';

test('computes an authoritative digest for shipment return CSV data', () => {
  const digest = csvVerificationDigest({
    name: 'returns.csv',
    extractedText:
      'quarter,shipments,packaging_returns,defect_returns,cost_eur\n' +
      '2024-Q1,100,4,6,1000\n' +
      '2024-Q2,200,5,15,2000\n',
  });

  assert.match(digest, /data rows: 2/);
  assert.match(digest, /shipments: sum=300; first=100; last=200/);
  assert.match(digest, /derived total returns .*all rows=30; first row=10; last row=20/);
  assert.match(digest, /derived return rates: first row=10%; last row=10%; overall=10%/);
});

test('ignores non-CSV and empty attachments', () => {
  assert.equal(csvVerificationDigest({ name: 'notes.txt', extractedText: 'hello' }), '');
  assert.equal(csvVerificationDigest({ name: 'empty.csv', extractedText: '' }), '');
});
