import { useEffect, useState } from 'react';
import {
  HARNESS_FORMS, HARNESS_MEMORY, HARNESS_PERMISSIONS, activeHarness, allHarnesses, chooseHarness, copyHarness, deleteHarness, harnessNote, isBuiltinHarness, saveHarness,
  type HarnessProfile,
} from '../harness';
import { HARNESS_FILE_KIND, addImportedHarness, canAddHarness, exportHarness, harnessPreview, harnessWarnings, parseHarnessFile } from '../harness-share';
import type { PrefsUpdate } from './PreferencesPanels';
import type { Preferences } from '../preferences';

const PERMISSION_LABEL = { standard: 'As set in the assistant settings', ask: 'Ask before every change', 'read-only': 'Read only, refuse changes' } as const;
const MEMORY_LABEL = { all: 'All notes', personal: 'About me and style only', none: 'No notes' } as const;
const FORM_LABEL = { free: 'Free', short: 'Short', brief: 'Brief with sources', table: 'Table' } as const;

const toList = (value: string): string[] => value.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);

/**
 * The working profile: chosen in the chat bar, shown and changed here. Ready-made profiles are only chosen or copied;
 * a copy ("my profile") can be changed. The profile only narrows what the assistant does.
 */
export default function HarnessPanel({ prefs, onPrefs }: { prefs: Preferences; onPrefs: PrefsUpdate }) {
  const [copyName, setCopyName] = useState('');
  const [pasted, setPasted] = useState('');
  const [incoming, setIncoming] = useState<{ profile: HarnessProfile; source: string } | null>(null);
  const [shareMessage, setShareMessage] = useState('');
  const state = prefs.harness;
  const profile = activeHarness(state);
  const builtin = isBuiltinHarness(profile.id);
  const setState = (next: (s: Preferences['harness']) => Preferences['harness']) => onPrefs((p) => ({ ...p, harness: next(p.harness) }));
  const [savedAt, setSavedAt] = useState(0);
  useEffect(() => {
    if (!savedAt) return undefined;
    const t = window.setTimeout(() => setSavedAt(0), 2500);
    return () => window.clearTimeout(t);
  }, [savedAt]);
  const change = (patch: Partial<HarnessProfile>) => { setState((s) => saveHarness(s, { ...profile, ...patch })); setSavedAt(Date.now()); };
  const note = harnessNote(profile);
  const download = () => {
    const url = URL.createObjectURL(new Blob([exportHarness(profile)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = `werkbank-profile-${profile.id.replace(/[^a-z0-9_-]/g, '')}.json`; a.click();
    URL.revokeObjectURL(url);
    setShareMessage('Exported. The file contains only this profile, no settings and no keys.');
  };
  const read = (raw: string, source: string) => {
    try {
      setIncoming({ profile: parseHarnessFile(raw), source });
      setShareMessage('');
    } catch (e) {
      setIncoming(null);
      setShareMessage(e instanceof Error ? e.message : String(e));
    }
  };
  const warnings = incoming ? harnessWarnings(incoming.profile) : [];
  return (
    <div className="side-section">
      <h4>Working profile{savedAt ? <small role="status" style={{ marginLeft: 8, fontWeight: 400 }}>Saved ✓</small> : null}</h4>
      <p className="side-hint">Rules for one kind of work: persona, connectors, rights, memory and the number of steps. Choose it in the chat bar. A profile only narrows what the assistant does.</p>
      <label className="side-field"><span>Profile</span>
        <select value={profile.id} onChange={(e) => { setState((s) => chooseHarness(s, e.target.value)); setSavedAt(Date.now()); }}>
          {allHarnesses(state).map((p) => <option key={p.id} value={p.id}>{p.name}{isBuiltinHarness(p.id) ? '' : ' (mine)'}</option>)}
        </select>
      </label>
      {profile.description && <p className="side-hint">{profile.description}</p>}
      {profile.origin && <p className="side-hint">From: {profile.origin}</p>}
      {builtin ? (
        profile.id !== 'standard' && (
          <dl className="approval-params">
            <div><dt>Rights</dt><dd>{PERMISSION_LABEL[profile.permission]}</dd></div>
            <div><dt>Connectors</dt><dd>{profile.connectors.join(', ') || 'No restriction'}</dd></div>
            <div><dt>Memory</dt><dd>{MEMORY_LABEL[profile.memory]}</dd></div>
            <div><dt>Steps</dt><dd>{profile.maxSteps || 'No limit'}</dd></div>
            <div><dt>Answer</dt><dd>{FORM_LABEL[profile.answerForm]}</dd></div>
          </dl>
        )
      ) : (
        <div key={profile.id}>
          <label className="side-field"><span>Persona and working rules</span>
            <textarea className="prefs-area" rows={4} maxLength={600} defaultValue={profile.persona} onBlur={(e) => change({ persona: e.target.value })} />
          </label>
          <label className="side-field"><span>Rights</span>
            <select value={profile.permission} onChange={(e) => change({ permission: e.target.value as HarnessProfile['permission'] })}>
              {HARNESS_PERMISSIONS.map((v) => <option key={v} value={v}>{PERMISSION_LABEL[v]}</option>)}
            </select>
          </label>
          <label className="side-field"><span>Memory</span>
            <select value={profile.memory} onChange={(e) => change({ memory: e.target.value as HarnessProfile['memory'] })}>
              {HARNESS_MEMORY.map((v) => <option key={v} value={v}>{MEMORY_LABEL[v]}</option>)}
            </select>
          </label>
          <label className="side-field"><span>Answer form</span>
            <select value={profile.answerForm} onChange={(e) => change({ answerForm: e.target.value as HarnessProfile['answerForm'] })}>
              {HARNESS_FORMS.map((v) => <option key={v} value={v}>{FORM_LABEL[v]}</option>)}
            </select>
          </label>
          <label className="side-field"><span>Most tool calls per answer (0 = no limit)</span>
            <input type="number" min={0} max={50} defaultValue={profile.maxSteps} onBlur={(e) => change({ maxSteps: Number(e.target.value) || 0 })} />
          </label>
          <label className="side-field"><span>Connectors, comma separated (empty = no restriction)</span>
            <input type="text" defaultValue={profile.connectors.join(', ')} onBlur={(e) => change({ connectors: toList(e.target.value) })} />
          </label>
          <label className="side-field"><span>Preferred skills</span>
            <input type="text" defaultValue={profile.skills.join(', ')} onBlur={(e) => change({ skills: toList(e.target.value) })} />
          </label>
          <label className="side-field"><span>Working Spaces (slugs)</span>
            <input type="text" defaultValue={profile.spaces.join(', ')} onBlur={(e) => change({ spaces: toList(e.target.value) })} />
          </label>
          <button className="ghost-btn" onClick={() => setState((s) => deleteHarness(s, profile.id))}>Delete this profile</button>
        </div>
      )}
      <label className="side-field"><span>Save a copy of “{profile.name}” as my profile</span>
        <input type="text" value={copyName} maxLength={40} placeholder="Name, for example Controlling review" onChange={(e) => setCopyName(e.target.value)} />
      </label>
      <button className="ghost-btn" disabled={!copyName.trim()} onClick={() => { setState((s) => copyHarness(s, profile.id, copyName)); setCopyName(''); }}>Save copy</button>
      <h4 style={{ marginTop: 14 }}>What the profile adds</h4>
      <pre className="side-pre">{note || 'Nothing: the standard profile adds no rules.'}</pre>
      <h4 style={{ marginTop: 14 }}>Hand over a profile</h4>
      <p className="side-hint">Export “{profile.name}” as a file, or add a profile from a file or from pasted text. You see it first, and it is added as a profile of your own. Admins can also publish a profile to a group (Settings → Groups).</p>
      <button className="ghost-btn" onClick={download}>Export “{profile.name}”</button>
      <label className="side-field"><span>Import from a file</span>
        <input type="file" accept="application/json,.json" aria-label="Profile file" onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void file.text().then((raw) => read(raw, 'Imported file'), () => setShareMessage('The file could not be read.'));
        }} />
      </label>
      <label className="side-field"><span>Or paste the profile text</span>
        <textarea className="prefs-area" rows={3} value={pasted} aria-label="Profile text" placeholder={`{ "app": "werkbank", "kind": "${HARNESS_FILE_KIND}", … }`} onChange={(e) => setPasted(e.target.value)} />
      </label>
      <button className="ghost-btn" disabled={!pasted.trim()} onClick={() => read(pasted, 'Pasted text')}>Show profile</button>
      {shareMessage && <p className="side-hint" role="status">{shareMessage}</p>}
      {incoming && (
        <div className="side-section" aria-label="Profile to import">
          <h4>{incoming.profile.name}</h4>
          {incoming.profile.description && <p className="side-hint">{incoming.profile.description}</p>}
          <pre className="side-pre">{harnessPreview(incoming.profile)}</pre>
          {warnings.map((w) => <p key={w} className="side-hint" role="alert">⚠ {w}</p>)}
          {!canAddHarness(state) && <p className="side-hint" role="alert">You have 10 profiles of your own. Delete one first.</p>}
          <button className="ghost-btn" disabled={!canAddHarness(state)} onClick={() => { setState((s) => addImportedHarness(s, incoming.profile, incoming.source)); setIncoming(null); setPasted(''); setShareMessage(`Added “${incoming.profile.name}”. Choose it in the chat bar to use it.`); }}>Add to my profiles</button>
          <button className="ghost-btn" onClick={() => setIncoming(null)}>Cancel</button>
        </div>
      )}
    </div>
  );
}
