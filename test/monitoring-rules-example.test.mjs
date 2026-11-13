import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readMap, toFindings } from '../shared/monitoring-read.mjs';

/** The example rules in docs/monitoring-read.md must stay valid and must do what the doc says with the typical Zabbix trigger texts. */
const doc = readFileSync(join(import.meta.dirname, '..', 'docs/monitoring-read.md'), 'utf8');
const section = doc.slice(doc.indexOf('### Beispielregeln für übliche Zabbix-Trigger'));
const example = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(section)[1]);
const dir = mkdtempSync(join(tmpdir(), 'rules-'));
const file = join(dir, 'monitoring-map.json');
writeFileSync(file, JSON.stringify(example));

const TEXTS = [
  ['cert-expiry', 14, 'Website certificate: SSL certificate expires soon (less than 14 days)'], ['cert-expiry', 14, 'SSL certificate expires in 5 days'],
  ['cert-expiry', 14, 'Certificate for edge.example.com expires in less than 14 days'], ['cert-expiry', 14, 'TLS certificate of the load balancer is about to expire (certificate expiring)'],
  [null, 0, 'Website certificate: SSL certificate is invalid'],
  ['patch-age', 30, 'Security updates are available'], ['patch-age', 30, 'Pending security updates: 12'], ['patch-age', 30, 'Missing patches: critical updates not installed'],
  ['patch-age', 30, 'Windows updates pending for more than 30 days'], [null, 0, 'System needs reboot'],
  ['disk-trend', 7, '/: Disk space is low (used > 90%)'], ['disk-trend', 7, 'Filesystem /var: Free disk space is less than 10%'], ['disk-trend', 3, '/data: Disk space is critically low (used > 95%)'],
  ['disk-trend', 3, '/: Disk will be full in 24 hours'], ['disk-trend', 7, 'D: volume is almost full (inodes low)'],
  ['dns-stale', 14, 'DNS record mismatch for app.example.com'], ['dns-stale', 14, 'A record points to the old address'], ['dns-stale', 14, 'DNS resolution failed for the intranet name'],
  [null, 0, 'DNS service is down'], [null, 0, 'High CPU utilization (over 90% for 5m)'], [null, 0, 'Zabbix agent is not available (for 3m)'], [null, 0, 'Free memory is less than 10%'], [null, 0, 'Backup job failed'],
];

test('the example rules in the doc are all valid: none is dropped, each is short enough', () => {
  const m = readMap(file);
  assert.equal(m.rulesDropped, 0);
  assert.equal(m.rules.length, example.findingRules.length);
  assert.ok(example.findingRules.every((r) => r.match.length <= 100));
});

test('the example rules do what the doc says with the typical Zabbix trigger texts (kind and deadline), and leave everything else alone', () => {
  const m = readMap(file);
  assert.equal(TEXTS.length, 23);
  TEXTS.forEach(([kind, days, text], i) => {
    const r = toFindings([{ id: 'T' + i, host: 'h' + i, at: '2026-11-13T08:00', text }], m.rules, {});
    assert.equal(r.findings[0]?.kind ?? null, kind, text);
    if (kind) assert.equal(r.findings[0].deadlineDays, days, `${text}: deadline`);
  });
});

test('the order matters: "critically low" gets the short deadline, the general disk rule the standard one', () => {
  const m = readMap(file);
  const one = (text) => toFindings([{ id: 'A', host: 'h', at: '2026-11-13T08:00', text }], m.rules, {}).findings[0];
  assert.equal(one('/: Disk space is critically low (used > 95%)').deadlineDays, 3);
  assert.equal(one('/: Disk space is low (used > 85%)').deadlineDays, 7);
});
