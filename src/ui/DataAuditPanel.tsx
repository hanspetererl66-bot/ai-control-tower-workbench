import { useMemo, useState } from 'react';
import { AGENT_GOV_KEY, AGENTS_KEY, loadAgents } from '../agent-studio';
import { MEMORY_GOV_KEY, loadGov } from '../skill-governance';
import { loadMemory } from '../memory';
import { loadProjects, projectEvents } from '../agent-project';
import { PERSONAL_KEYS, auditCsv, buildAudit, clearPersonal, exportPersonal } from '../personalization';
import { Section } from './PreferencesPanels';

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Export and delete everything personal on this computer, and read the trail of who approved what. */
export default function DataAuditPanel() {
  const [tick, setTick] = useState(0);
  const [confirm, setConfirm] = useState(false);
  const [message, setMessage] = useState('');
  const events = useMemo(() => {
    const mem = loadMemory(window.localStorage);
    const agents = loadAgents(window.localStorage);
    return buildAudit([
      { kind: 'Skill', gov: loadGov(), nameOf: (id) => id },
      { kind: 'Memory', gov: loadGov(undefined, MEMORY_GOV_KEY), nameOf: (id) => mem.entries.find((e) => e.id === id)?.text.slice(0, 60) ?? id },
      { kind: 'Agent', gov: loadGov(undefined, AGENT_GOV_KEY), nameOf: (id) => agents.find((a) => a.id === id)?.name ?? id },
    ], projectEvents(loadProjects(window.localStorage)));
  }, [tick]);
  const present = PERSONAL_KEYS.filter((k) => { try { return window.localStorage.getItem(k) != null; } catch { return false; } }).length;
  void AGENTS_KEY;

  return (
    <>
      <Section title="Your data" hint="Everything personal lives on this computer: memory, personas, commands, approvals, agents, groups and schedules. Nothing is sent to a server by this app.">
        <p className="prefs-note">{present} of {PERSONAL_KEYS.length} data sets contain something right now. Conversations and look settings are not included.</p>
        <div className="prefs-row">
          <button className="ghost-btn" onClick={() => { download(`personalisation-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(exportPersonal(window.localStorage), null, 2), 'application/json'); setMessage('Export saved as a JSON file.'); }}>Export everything (JSON)</button>
          {confirm
            ? <>
                <button className="ghost-btn ghost-btn-on" onClick={() => { const n = clearPersonal(window.localStorage); setMessage(`${n} data sets deleted. The app reloads.`); setTimeout(() => window.location.reload(), 900); }}>Yes, delete everything</button>
                <button className="ghost-btn" onClick={() => setConfirm(false)}>Cancel</button>
              </>
            : <button className="ghost-btn" onClick={() => setConfirm(true)}>Delete everything…</button>}
        </div>
        {confirm && <p className="prefs-note"><b>This cannot be undone.</b> Export first if you may need it again.</p>}
        {message && <p className="prefs-note" role="status">{message}</p>}
      </Section>
      <Section title="Audit trail" hint="Who asked to move a skill, a memory entry or an agent to a higher level, who decided and when. Built from the approval records.">
        <div className="prefs-row">
          <button className="ghost-btn" onClick={() => setTick((t) => t + 1)}>Refresh</button>
          <button className="ghost-btn" disabled={!events.length} onClick={() => download('audit-trail.csv', auditCsv(events), 'text/csv')}>Export as CSV</button>
        </div>
        {events.length === 0
          ? <p className="prefs-note">No approvals yet. Requests and decisions from Skills, Memory and the Agent Studio appear here.</p>
          : <ul className="prefs-list" aria-label="Audit trail">
              {events.slice(0, 100).map((e, i) => (
                <li key={i}><div><b>{e.kind}: {e.what}</b> <small>{e.action}{e.from || e.to ? `: ${e.from} → ${e.to}` : ''} · {new Date(e.at).toLocaleString()}{e.note ? ` · ${e.note}` : ''}</small></div></li>
              ))}
            </ul>}
        <p className="prefs-note">In this prototype one person plays every role, so the trail shows the process, not independent control. A real roll-out needs a server with separate approvers.</p>
      </Section>
    </>
  );
}
