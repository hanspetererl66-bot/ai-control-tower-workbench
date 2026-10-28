import { useState } from 'react';
import {
  HARNESS_FORMS, HARNESS_MEMORY, HARNESS_PERMISSIONS, activeHarness, allHarnesses, chooseHarness, copyHarness, deleteHarness, harnessNote, isBuiltinHarness, saveHarness,
  type HarnessProfile,
} from '../harness';
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
  const state = prefs.harness;
  const profile = activeHarness(state);
  const builtin = isBuiltinHarness(profile.id);
  const setState = (next: (s: Preferences['harness']) => Preferences['harness']) => onPrefs((p) => ({ ...p, harness: next(p.harness) }));
  const change = (patch: Partial<HarnessProfile>) => setState((s) => saveHarness(s, { ...profile, ...patch }));
  const note = harnessNote(profile);
  return (
    <div className="side-section">
      <h4>Working profile</h4>
      <p className="side-hint">Rules for one kind of work: persona, connectors, rights, memory and the number of steps. Choose it in the chat bar. A profile only narrows what the assistant does.</p>
      <label className="side-field"><span>Profile</span>
        <select value={profile.id} onChange={(e) => setState((s) => chooseHarness(s, e.target.value))}>
          {allHarnesses(state).map((p) => <option key={p.id} value={p.id}>{p.name}{isBuiltinHarness(p.id) ? '' : ' (mine)'}</option>)}
        </select>
      </label>
      {profile.description && <p className="side-hint">{profile.description}</p>}
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
    </div>
  );
}
