const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseLastUsed } = require('../src/appUsage');

test('data de última abertura preserva fuso e rejeita ausência ou datas futuras', () => {
  const now = Date.parse('2026-11-07T20:00:00Z');
  assert.equal(parseLastUsed('2026-10-01 15:30:00 -0300\n', now), '2026-10-01T18:30:00.000Z');
  for(const input of ['(null)', '', null, 'não informado', '2027-01-01 10:00:00 +0000']) assert.equal(parseLastUsed(input, now), null);
});
