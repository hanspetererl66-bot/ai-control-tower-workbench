/**
 * Infrastructure Operations: planning rules for certificate, VM and DNS changes (simulated, no system is touched).
 *
 * A change request becomes a plan: validation against the inventory, pre-checks, a simulated Ansible check-mode diff,
 * blast radius, risk, the number of approvals and the orchestration steps (n8n) around the playbook run (AWX).
 * The code between BEGIN-MODEL and END-MODEL is embedded verbatim into the Space page by scripts/sync-infra-ops.mjs,
 * so the page and the tests run the same rules.
 */
// BEGIN-MODEL
const DAY_MS = 86400000;
const PLAYBOOKS = {
  'renew-certificate': { title: 'Zertifikat erneuern und verteilen', status: 'freigegeben', kind: 'cert', base: 1 },
  'update-dns-record': { title: 'DNS-Eintrag ändern', status: 'freigegeben', kind: 'dns', base: 1 },
  'patch-vm': { title: 'VM patchen und neu starten', status: 'freigegeben', kind: 'vm', base: 2 },
  'move-vm': { title: 'VM in andere Region verschieben', status: 'freigegeben', kind: 'vm', base: 3 },
  'rotate-secret': { title: 'Geheimnis rotieren', status: 'entwurf', kind: 'vm', base: 2 },
};
const STATES = ['geplant', 'in_pruefung', 'freigegeben', 'im_fenster', 'erledigt'];
const ORCHESTRATION = [
  { id: 'trigger', title: 'Auslöser', tool: 'n8n', detail: 'Webhook oder Zeitplan (zum Beispiel Zertifikat läuft in 30 Tagen ab)' },
  { id: 'ticket', title: 'Aufgabe und Ticket anlegen', tool: 'n8n', detail: 'Change-Ticket im ITSM, Aufgabe im Space' },
  { id: 'check', title: 'Vorprüfung im Prüfmodus', tool: 'AWX', detail: 'Playbook mit --check --diff, Abhängigkeiten, Konflikte' },
  { id: 'approve', title: 'Freigabe (Vier-Augen)', tool: 'n8n', detail: 'Anfrage per Teams an die Freigeber, Antwort startet den nächsten Schritt' },
  { id: 'window', title: 'Änderungsfenster abwarten', tool: 'n8n', detail: 'Start nur im freigegebenen Fenster' },
  { id: 'run', title: 'Playbook ausführen', tool: 'AWX', detail: 'Job-Vorlage mit geprüften Parametern, Snapshot vorher' },
  { id: 'verify', title: 'Verifikation', tool: 'AWX', detail: 'Gesundheits- und Zertifikatsprüfung, bei Fehler Rollback' },
  { id: 'evidence', title: 'Beleg und Meldung', tool: 'n8n', detail: 'Protokoll ablegen, Kunde und Team informieren' },
];
/** How many orchestration steps are done in each task state. */
const STEPS_DONE = { geplant: 2, in_pruefung: 3, freigegeben: 5, im_fenster: 6, erledigt: 8 };

const toDay = (iso) => String(iso).slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(toDay(b)) - Date.parse(toDay(a))) / DAY_MS);
const hoursOf = (win) => (Date.parse(win[1] + ':00Z') - Date.parse(win[0] + ':00Z')) / 3600000;
const by = (list) => new Map(list.map((x) => [x.id, x]));

function certStatus(cert, asOf) {
  const left = daysBetween(asOf, cert.notAfter);
  const status = left < 0 ? 'abgelaufen' : left <= 7 ? 'kritisch' : left <= 30 ? 'bald' : left <= 90 ? 'beobachten' : 'ok';
  return { daysLeft: left, status };
}

/** Everything that runs on top of a VM (reverse dependencies, transitive). */
function dependents(data, vmId) {
  const out = [];
  const seen = new Set([vmId]);
  const queue = [vmId];
  while (queue.length) {
    const cur = queue.shift();
    for (const v of data.vms) if (v.dependsOn === cur && !seen.has(v.id)) { seen.add(v.id); out.push(v.id); queue.push(v.id); }
  }
  return out;
}

function findings(data) {
  const asOf = data.asOf;
  const out = [];
  for (const c of data.certs) {
    const s = certStatus(c, asOf);
    if (s.status === 'abgelaufen') out.push({ severity: 'rot', kind: 'cert', target: c.id, template: 'renew-certificate', title: `${c.name} ist abgelaufen`, detail: `Seit ${-s.daysLeft} Tagen ungültig (${c.notAfter}).` });
    else if (s.status === 'kritisch' || s.status === 'bald') out.push({ severity: s.status === 'kritisch' ? 'rot' : 'gelb', kind: 'cert', target: c.id, template: 'renew-certificate', title: `${c.name} läuft in ${s.daysLeft} Tagen ab`, detail: `Gültig bis ${c.notAfter}.` });
  }
  for (const v of data.vms) {
    if (v.criticalPatches > 0) out.push({ severity: 'rot', kind: 'vm', target: v.id, template: 'patch-vm', title: `${v.id}: ${v.criticalPatches} kritische Patches offen`, detail: `${v.pendingPatches} Patches insgesamt, letzter Patch ${v.lastPatch}.` });
    if (daysBetween(v.lastBackup, data.asOf) >= 2) out.push({ severity: 'gelb', kind: 'vm', target: v.id, template: null, title: `${v.id}: Backup ist ${daysBetween(v.lastBackup, data.asOf)} Tage alt`, detail: 'Vor Änderungen ein aktuelles Backup sicherstellen.' });
  }
  const rank = { rot: 0, gelb: 1 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

function overlaps(a, b) { return a[0] < b[1] && b[0] < a[1]; }

/** Validate a change request and plan it. Returns { ok, errors, ... }. */
function planTask(data, req) {
  const errors = [];
  const pb = PLAYBOOKS[req.template];
  if (!pb) return { ok: false, errors: ['Unbekannte Aufgabenvorlage.'] };
  if (pb.status !== 'freigegeben') errors.push(`Das Playbook "${req.template}" ist ein Entwurf und für Produktion nicht freigegeben.`);
  const inventory = { cert: data.certs, dns: data.dns, vm: data.vms }[pb.kind];
  const target = by(inventory).get(req.target);
  if (!target) return { ok: false, errors: [...errors, `Ziel "${req.target}" ist nicht im Bestand (nur geprüfte Ziele sind erlaubt).`] };
  const vmMap = by(data.vms);
  const customer = by(data.customers).get(target.customer);
  const win = req.window;
  if (!win || !win[0] || !win[1] || win[0] >= win[1]) errors.push('Das Änderungsfenster ist ungültig.');
  else {
    if (toDay(win[0]) <= data.asOf && !['im_fenster', 'erledigt'].includes(req.state)) errors.push('Das Fenster muss in der Zukunft liegen.');
    if (hoursOf(win) > 8) errors.push('Ein Änderungsfenster darf höchstens 8 Stunden dauern.');
    for (const f of data.freezes) {
      if ((f.customer === null || f.customer === target.customer) && toDay(win[0]) <= f.to && toDay(win[1]) >= f.from) errors.push(`Das Fenster liegt im Freeze: ${f.reason} (${f.from} bis ${f.to}).`);
    }
  }
  const affectedVmIds = pb.kind === 'cert' ? [...target.vmIds] : pb.kind === 'dns' ? (target.vmId ? [target.vmId] : []) : [target.id];
  const primaryVm = vmMap.get(affectedVmIds[0]);
  const env = primaryVm ? primaryVm.env : 'PRD';
  const checks = [];
  const diff = [];
  const downtime = { minutes: 0, note: '' };
  const extraSteps = [];
  let risk = pb.base + (env === 'PRD' ? 1 : 0) + (primaryVm && primaryVm.role === 'HANA-Datenbank' ? 1 : 0);

  if (pb.kind === 'cert') {
    const s = certStatus(target, data.asOf);
    checks.push({ label: 'Restlaufzeit', status: s.status === 'ok' ? 'warn' : 'ok', detail: s.daysLeft < 0 ? `Abgelaufen seit ${-s.daysLeft} Tagen.` : `${s.daysLeft} Tage, Erneuerung ${s.status === 'ok' ? 'noch nicht nötig' : 'sinnvoll'}.` });
    checks.push({ label: 'Zertifikatskette', status: 'ok', detail: `Aussteller ${target.issuer}, Zwischenzertifikate vollständig.` });
    checks.push({ label: 'Schlüssel', status: 'ok', detail: `Neuer Schlüssel ${target.key}, passt zum Verwendungszweck.` });
    const names = data.dns.filter((d) => affectedVmIds.includes(d.vmId)).map((d) => d.name);
    checks.push({ label: 'Namen im Zertifikat', status: 'ok', detail: names.length ? `Deckt ${names.join(', ')} ab.` : 'Keine DNS-Namen verknüpft.' });
    diff.push({ sign: ' ', text: `certificate: ${target.name}` }, { sign: '-', text: `not_after: ${target.notAfter}` }, { sign: '+', text: `not_after: ${new Date(Date.parse(toDay(win && win[0] ? win[0] : data.asOf) + 'T00:00:00Z') + 365 * DAY_MS).toISOString().slice(0, 10)}` }, { sign: ' ', text: `deploy_to: ${affectedVmIds.join(', ')}` }, { sign: '+', text: 'reload: web dispatcher / application server (ohne Neustart)' });
    downtime.minutes = 0; downtime.note = 'Kein Ausfall: Dienste laden das Zertifikat neu.';
  } else if (pb.kind === 'dns') {
    const nv = req.newValue || (req.params && req.params.newValue) || '';
    const ttl = Number(req.ttl ?? (req.params && req.params.ttl) ?? target.ttl);
    if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(nv) && target.type === 'A') errors.push('Der neue Wert muss eine gültige IPv4-Adresse sein.');
    if (!Number.isFinite(ttl) || ttl < 60 || ttl > 86400) errors.push('Die TTL muss zwischen 60 und 86400 Sekunden liegen.');
    const users = data.dns.filter((d) => d.type === 'CNAME' && d.value === target.name);
    checks.push({ label: 'Nutzer des Namens', status: users.length ? 'warn' : 'ok', detail: users.length ? `${users.length} Alias-Einträge zeigen auf ${target.name}: ${users.map((u) => u.name).join(', ')}.` : 'Keine Alias-Einträge.' });
    checks.push({ label: 'TTL vor dem Umzug', status: target.ttl > 300 ? 'warn' : 'ok', detail: target.ttl > 300 ? `Aktuelle TTL ${target.ttl} s: Cache-Zeit vorher auf 300 s senken, sonst bleibt die alte Adresse bis zu ${Math.round(target.ttl / 60)} Minuten sichtbar.` : 'TTL ist bereits niedrig.' });
    diff.push({ sign: ' ', text: `record: ${target.name} (${target.type})` }, { sign: '-', text: `value: ${target.value}   ttl: ${target.ttl}` }, { sign: '+', text: `value: ${nv || '(neu)'}   ttl: ${ttl}` });
    downtime.minutes = 0; downtime.note = `Namensauflösung wechselt innerhalb von bis zu ${Math.round(target.ttl / 60)} Minuten (TTL).`;
    if (target.ttl > 300) extraSteps.push({ id: 'ttl', title: 'TTL vorab auf 300 s senken', when: 'mindestens eine TTL vor dem Fenster', playbook: 'update-dns-record' });
    risk += users.length ? 1 : 0;
  } else if (req.template === 'patch-vm') {
    const backupAge = daysBetween(target.lastBackup, data.asOf);
    checks.push({ label: 'Backup', status: backupAge >= 2 ? 'fail' : 'ok', detail: backupAge >= 2 ? `Letztes Backup vor ${backupAge} Tagen: vor dem Patchen ein neues Backup erstellen.` : `Letztes Backup ${target.lastBackup}.` });
    checks.push({ label: 'Offene Patches', status: target.criticalPatches ? 'warn' : 'ok', detail: `${target.pendingPatches} offen, davon ${target.criticalPatches} kritisch.` });
    const dep = dependents(data, target.id);
    checks.push({ label: 'Abhängige Systeme', status: dep.length ? 'warn' : 'ok', detail: dep.length ? `Beim Neustart stehen ${dep.join(', ')} still.` : 'Keine abhängigen Systeme.' });
    diff.push({ sign: ' ', text: `vm: ${target.id} (${target.os})` }, { sign: '-', text: `patches_pending: ${target.pendingPatches}` }, { sign: '+', text: 'patches_pending: 0' }, { sign: '+', text: 'reboot: required' });
    downtime.minutes = target.role === 'HANA-Datenbank' ? 25 : 10; downtime.note = `Neustart, geschätzt ${downtime.minutes} Minuten${dep.length ? ' (abhängige Systeme betroffen)' : ''}.`;
    if (backupAge >= 2) errors.push('Backup ist zu alt: Das Playbook läuft nur mit Backup der letzten 24 Stunden.');
  } else {
    const region = by(data.regions).get(req.targetRegion || (req.params && req.params.targetRegion));
    if (!region) errors.push('Zielregion ist nicht erlaubt (nur Regionen aus der Liste).');
    else {
      const cross = region.hyperscaler !== target.hyperscaler;
      checks.push({ label: 'Kapazität in der Zielregion', status: region.freePct < 20 ? 'warn' : 'ok', detail: `${region.label}: ${region.freePct} % frei${region.freePct < 20 ? ', knapp' : ''}.` });
      checks.push({ label: 'Hyperscaler', status: cross ? 'fail' : 'ok', detail: cross ? 'Wechsel des Hyperscalers ist ein Migrationsprojekt, kein Standard-Playbook.' : 'Verschiebung innerhalb desselben Hyperscalers.' });
      if (cross) errors.push('Ein Wechsel des Hyperscalers ist mit diesem Playbook nicht erlaubt.');
      if (region.id === target.region) errors.push('Die Zielregion ist identisch mit der aktuellen Region.');
      diff.push({ sign: ' ', text: `vm: ${target.id}` }, { sign: '-', text: `region: ${target.region}` }, { sign: '+', text: `region: ${region.id}` }, { sign: '+', text: 'snapshot: vor der Änderung' });
    }
    const backupAge = daysBetween(target.lastBackup, data.asOf);
    checks.push({ label: 'Backup', status: backupAge >= 2 ? 'fail' : 'ok', detail: backupAge >= 2 ? `Letztes Backup vor ${backupAge} Tagen.` : `Letztes Backup ${target.lastBackup}.` });
    if (backupAge >= 2) errors.push('Backup ist zu alt: Das Playbook läuft nur mit Backup der letzten 24 Stunden.');
    const dep = dependents(data, target.id);
    checks.push({ label: 'Abhängige Systeme', status: dep.length ? 'warn' : 'ok', detail: dep.length ? `${dep.join(', ')} hängen an dieser VM.` : 'Keine abhängigen Systeme.' });
    const recs = data.dns.filter((d) => d.vmId === target.id);
    checks.push({ label: 'DNS', status: recs.length ? 'warn' : 'ok', detail: recs.length ? `${recs.map((r) => r.name).join(', ')} müssen nach dem Umzug auf die neue Adresse zeigen.` : 'Keine DNS-Einträge betroffen.' });
    downtime.minutes = 90; downtime.note = 'Geschätzt 90 Minuten (Snapshot, Umzug, Start, Verifikation).';
    for (const r of recs) {
      if (r.ttl > 300) extraSteps.push({ id: `ttl-${r.id}`, title: `TTL von ${r.name} vorab auf 300 s senken`, when: 'einen Tag vor dem Fenster', playbook: 'update-dns-record' });
      extraSteps.push({ id: `dns-${r.id}`, title: `${r.name} nach dem Umzug auf die neue Adresse setzen`, when: 'direkt nach dem Umzug', playbook: 'update-dns-record' });
    }
  }

  // conflicts with other open tasks of the same customer
  const conflicts = win && win[0] && win[1] ? (data.tasks ?? []).filter((t) => t.id !== req.id && t.customer === target.customer && t.state !== 'erledigt' && overlaps(win, t.window)) : [];
  checks.push({ label: 'Konflikte im Änderungskalender', status: conflicts.length ? 'warn' : 'ok', detail: conflicts.length ? `Überschneidung mit ${conflicts.map((c) => c.id).join(', ')}.` : 'Keine Überschneidung mit anderen Aufgaben des Kunden.' });

  const affectedVmsAll = [...new Set(affectedVmIds.flatMap((id) => [id, ...(pb.kind === 'cert' || pb.kind === 'dns' ? [] : dependents(data, id))]))];
  const affectedDns = data.dns.filter((d) => affectedVmsAll.includes(d.vmId)).map((d) => d.name);
  const riskLevel = risk >= 5 ? 'hoch' : risk >= 3 ? 'mittel' : 'niedrig';
  const approvalsNeeded = env === 'PRD' || riskLevel === 'hoch' ? 2 : 1;
  return {
    ok: errors.length === 0,
    errors,
    template: req.template,
    playbook: { id: req.template, title: pb.title },
    target: target.id,
    customer: customer ? customer.name : target.customer,
    env,
    risk: riskLevel,
    riskScore: risk,
    approvalsNeeded,
    approvalReason: approvalsNeeded === 2 ? (env === 'PRD' ? 'Produktion: zwei Freigaben (Vier-Augen-Prinzip plus Change Manager).' : 'Hohes Risiko: zwei Freigaben.') : 'Eine Freigabe genügt (kein Produktionssystem, geringes Risiko).',
    checks,
    diff,
    downtime,
    blast: { vms: affectedVmsAll, dns: affectedDns, customers: [customer ? customer.name : target.customer] },
    conflicts: conflicts.map((c) => c.id),
    steps: [...extraSteps, ...ORCHESTRATION.map((s) => ({ id: s.id, title: s.title, tool: s.tool, detail: s.detail }))],
  };
}

/** May this person approve? Technical enforcement of the four-eyes rule. */
function canApprove(task, personId, data) {
  const person = by(data.people).get(personId);
  if (!person) return { ok: false, reason: 'Unbekannte Person.' };
  if (task.state !== 'in_pruefung') return { ok: false, reason: 'Freigabe ist nur in der Phase "In Prüfung" möglich.' };
  if (task.requester === personId) return { ok: false, reason: 'Die antragstellende Person darf nicht selbst freigeben.' };
  if ((task.approvals ?? []).includes(personId)) return { ok: false, reason: 'Diese Person hat bereits freigegeben.' };
  const plan = planTask(data, { ...task, ...(task.params ?? {}) });
  if (!plan.ok) return { ok: false, reason: `Der Plan hat Fehler: ${plan.errors[0]}` };
  const have = (task.approvals ?? []).map((id) => by(data.people).get(id));
  if (plan.approvalsNeeded === 2 && have.length === 1 && have[0].role === person.role && person.role !== 'Change Manager') return { ok: false, reason: 'Die zweite Freigabe muss von einer anderen Rolle kommen als die erste, zum Beispiel vom Change Manager.' };
  return { ok: true, reason: '' };
}

/** A simulated playbook run: Ansible-style output and a recap. No system is touched. */
function simulateRun(plan) {
  const tasks = plan.diff.filter((d) => d.sign === '+').map((d) => d.text.replace(/\s{2,}/g, ' '));
  const lines = [`PLAY [${plan.playbook.title}] ${'*'.repeat(20)}`, 'TASK [Snapshot und Gesundheitsprüfung vorher] ok'];
  tasks.forEach((t) => lines.push(`TASK [${t}] changed`));
  lines.push('TASK [Verifikation nach der Änderung] ok', '', `PLAY RECAP  ok=2  changed=${tasks.length}  failed=0  rolled_back=0`);
  return { lines, recap: { ok: 2, changed: tasks.length, failed: 0 } };
}
// END-MODEL

export { PLAYBOOKS, STATES, ORCHESTRATION, STEPS_DONE, certStatus, dependents, findings, planTask, canApprove, simulateRun };
