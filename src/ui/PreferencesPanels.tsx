import { BRIEFING_CATEGORIES, categoryKey } from '../briefing';
import { useState, type ReactNode } from 'react';
import {
  ACCENT_PRESETS, APP_SCALES, CONTRASTS, DENSITIES, FONTS, LANGUAGES, LENGTHS, PURPOSES, TONES,
  allProfiles, applyProfile, assistantNote, deleteProfile, exportPreferences, importPreferences, isOriginal, isOriginalLook, resetAll, resetLook, saveProfile,
  type Preferences, type Starter,
} from '../preferences';
import { sectionEffect } from '../settings-help';
import { SPACE_SCALES } from '../space-scale';
import { STARTER_PROMPTS } from '../starter-prompts';

export type PrefsUpdate = (change: (current: Preferences) => Preferences) => void;
export type SpaceRef = { slug: string; title: string };
export type SkillRef = { name: string; description: string };

type Common = { prefs: Preferences; update: PrefsUpdate };

/** The "what does this do" line under a section hint, from the shared help text. */
export function SectionEffect({ title }: { title: string }) {
  const effect = sectionEffect(title);
  return effect ? <p className="settings-effect"><b>What it does:</b> {effect}</p> : null;
}

export function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="settings-section">
      <div className="settings-section-copy">
        <h4>{title}</h4>
        {hint && <p>{hint}</p>}
        <SectionEffect title={title} />
      </div>
      {children}
    </div>
  );
}

function Choice<T extends string | number>({ label, value, options, onPick, show }: { label: string; value: T; options: readonly T[]; onPick: (v: T) => void; show?: (v: T) => string }) {
  return (
    <div className="prefs-row" role="radiogroup" aria-label={label}>
      <label>{label}</label>
      {options.map((option) => (
        <button key={String(option)} className={`ghost-btn ${value === option ? 'ghost-btn-on' : ''}`} role="radio" aria-checked={value === option} onClick={() => onPick(option)}>
          {show ? show(option) : String(option)}
        </button>
      ))}
    </div>
  );
}

const FONT_NAMES: Record<(typeof FONTS)[number], string> = { default: 'Original', arial: 'Arial', system: 'System', readable: 'Easy to read', mono: 'Monospace' };
const PURPOSE_NAMES: Record<(typeof PURPOSES)[number], string> = { reports: 'Reports', presentations: 'Presentations', data: 'Data', other: 'Other' };

export function ProfilesPanel({ prefs, update }: Common) {
  const [name, setName] = useState('');
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <Section title="Profiles" hint="A profile bundles look, start view, pinned Spaces, favourite skills and assistant instructions. Switch with one click.">
        <ul className="prefs-list">
          {allProfiles(prefs).map((profile) => {
            const custom = prefs.profiles.some((p) => p.id === profile.id);
            return (
              <li key={profile.id}>
                <span>
                  {profile.name}
                  <small>{custom ? 'Your profile' : 'Ready-made'}{prefs.activeProfile === profile.id ? ' · active' : ''}</small>
                </span>
                <span>
                  <button className="ghost-btn" disabled={JSON.stringify(applyProfile(prefs, profile.id)) === JSON.stringify(prefs)} onClick={() => update((p) => applyProfile(p, profile.id))}>Use</button>
                  {custom && <button className="ghost-btn" onClick={() => update((p) => deleteProfile(p, profile.id))} aria-label={`Delete ${profile.name}`}>Delete</button>}
                </span>
              </li>
            );
          })}
        </ul>
      </Section>
      <Section title="Back to the original" hint="Resets look, start view, pins, domains, favourite skills, starters, assistant instructions and storage locations. Saved profiles and the Supabase key stay.">
        <div className="prefs-row">
          {confirm ? (
            <>
              <span>Really reset everything?</span>
              <button className="ghost-btn ghost-btn-on" onClick={() => { update((p) => resetAll(p)); setConfirm(false); }}>Yes, reset</button>
              <button className="ghost-btn" onClick={() => setConfirm(false)}>Cancel</button>
            </>
          ) : (
            <button className="ghost-btn" disabled={isOriginal(prefs)} onClick={() => setConfirm(true)}>Reset all settings</button>
          )}
        </div>
      </Section>
      <Section title="Save the current settings as a profile">
        <div className="prefs-row">
          <input type="text" value={name} maxLength={40} placeholder="Profile name, for example TechEd demo" onChange={(e) => setName(e.target.value)} aria-label="Profile name" />
          <button className="ghost-btn" disabled={!name.trim()} onClick={() => { update((p) => saveProfile(p, name)); setName(''); }}>Save profile</button>
        </div>
      </Section>
    </>
  );
}

export function LookPanel({ prefs, update }: Common) {
  const custom = prefs.accent && !ACCENT_PRESETS.some((a) => a.hex.toUpperCase() === prefs.accent);
  return (
    <>
      <Section title="Original look" hint="Colour, text sizes, font, density, contrast and motion go back to how the app came. Your profiles, pins and starters stay.">
        <div className="prefs-row">
          <button className="ghost-btn" disabled={isOriginalLook(prefs)} onClick={() => update((p) => resetLook(p))}>Back to the original look</button>
          {isOriginalLook(prefs) && <span className="prefs-note" style={{ margin: 0 }}>This is the original look.</span>}
        </div>
      </Section>
      <Section title="Accent colour" hint="Original is the colour the app came with. Violet is a brighter purple. Light colours are darkened so white text stays readable; the accent is used for buttons and highlights, and in all Spaces.">
        <div className="prefs-row" role="radiogroup" aria-label="Accent colour">
          <button className={`ghost-btn ${!prefs.accent ? 'ghost-btn-on' : ''}`} role="radio" aria-checked={!prefs.accent} onClick={() => update((p) => ({ ...p, accent: '' }))}>Original</button>
          {ACCENT_PRESETS.map((a) => (
            <button key={a.id} className={`prefs-swatch ${prefs.accent === a.hex.toUpperCase() ? 'prefs-swatch-on' : ''}`} style={{ background: a.hex }} role="radio" aria-checked={prefs.accent === a.hex.toUpperCase()} aria-label={a.name} title={a.name} onClick={() => update((p) => ({ ...p, accent: a.hex.toUpperCase() }))} />
          ))}
          <label className="prefs-row" style={{ margin: 0 }}>
            <span>Own colour</span>
            <input type="color" value={prefs.accent || '#A100FF'} aria-label="Own accent colour" onChange={(e) => update((p) => ({ ...p, accent: e.target.value.toUpperCase() }))} />
            {custom && <small>{prefs.accent}</small>}
          </label>
        </div>
      </Section>
      <Section title="Text and layout">
        <Choice label="App text size" value={prefs.appScale} options={APP_SCALES} show={(v) => `${Math.round(v * 100)}%`} onPick={(v) => update((p) => ({ ...p, appScale: v }))} />
        <Choice label="Text size in Spaces" value={prefs.spaceScale} options={SPACE_SCALES} show={(v) => `${Math.round(v * 100)}%`} onPick={(v) => update((p) => ({ ...p, spaceScale: v }))} />
        <Choice label="Font" value={prefs.font} options={FONTS} show={(v) => FONT_NAMES[v]} onPick={(v) => update((p) => ({ ...p, font: v }))} />
        <Choice label="Density" value={prefs.density} options={DENSITIES} show={(v) => v[0].toUpperCase() + v.slice(1)} onPick={(v) => update((p) => ({ ...p, density: v }))} />
      </Section>
      <Section title="Accessibility" hint="High contrast makes lines and secondary text darker and focus rings thicker. Reduced motion switches animations off.">
        <Choice label="Contrast" value={prefs.contrast} options={CONTRASTS} show={(v) => (v === 'high' ? 'High' : 'Normal')} onPick={(v) => update((p) => ({ ...p, contrast: v }))} />
        <label className="voice-option">
          <input type="checkbox" checked={prefs.reduceMotion} onChange={(e) => update((p) => ({ ...p, reduceMotion: e.target.checked }))} />
          <span>Reduce motion</span>
        </label>
      </Section>
    </>
  );
}

export function WorkPanel({ prefs, update, spaces, skills, connectors }: Common & { spaces: SpaceRef[]; skills: SkillRef[]; connectors: string[] }) {
  const [label, setLabel] = useState('');
  const [prompt, setPrompt] = useState('');
  const toggle = (list: string[], item: string, max: number) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item].slice(0, max));
  const add = () => {
    const starter: Starter = { label: label.trim(), prompt: prompt.trim() };
    if (!starter.label || !starter.prompt) return;
    update((p) => ({ ...p, starters: [...p.starters, starter].slice(0, 12) }));
    setLabel(''); setPrompt('');
  };
  return (
    <>
      <Section title="Start view" hint="What opens when the app starts.">
        <div className="prefs-row">
          <label htmlFor="start-view">Open</label>
          <select id="start-view" value={prefs.startView} onChange={(e) => update((p) => ({ ...p, startView: e.target.value }))}>
            <option value="chat">New chat</option>
            <option value="last">Last opened Space</option>
            {spaces.map((s) => <option key={s.slug} value={`space:${s.slug}`}>{s.title}</option>)}
            {prefs.startView.startsWith('space:') && !spaces.some((s) => `space:${s.slug}` === prefs.startView) && <option value={prefs.startView}>{prefs.startView.slice(6)} (not installed)</option>}
          </select>
        </div>
      </Section>
      <Section title="Pinned Spaces" hint="Pinned Spaces stay at the top of the list. You can also pin with the pin button in the list.">
        {spaces.length === 0 ? <p className="prefs-note">No Spaces installed yet.</p> : spaces.map((s) => (
          <label key={s.slug} className="voice-option">
            <input type="checkbox" checked={prefs.pinnedSpaces.includes(s.slug)} onChange={() => update((p) => ({ ...p, pinnedSpaces: toggle(p.pinnedSpaces, s.slug, 20) }))} />
            <span>{s.title}</span>
          </label>
        ))}
      </Section>
      <Section title="Favourite skills" hint="Shown as buttons below the message box. Up to 12.">
        {skills.length === 0 ? <p className="prefs-note">No skills installed yet.</p> : skills.map((s) => (
          <label key={s.name} className="voice-option" title={s.description}>
            <input type="checkbox" checked={prefs.favoriteSkills.includes(s.name)} onChange={() => update((p) => ({ ...p, favoriteSkills: toggle(p.favoriteSkills, s.name, 12) }))} />
            <span>{s.name}</span>
          </label>
        ))}
      </Section>
      <Section title="Suggestions on the empty chat" hint="Untick a built-in suggestion to hide it.">
        {STARTER_PROMPTS.map((s) => (
          <label key={s.label} className="voice-option" title={s.prompt}>
            <input type="checkbox" checked={!prefs.chat.hiddenStarters.includes(s.label)} onChange={() => update((p) => ({ ...p, chat: { ...p.chat, hiddenStarters: p.chat.hiddenStarters.includes(s.label) ? p.chat.hiddenStarters.filter((x) => x !== s.label) : [...p.chat.hiddenStarters, s.label] } }))} />
            <span>{s.label}</span>
          </label>
        ))}
      </Section>
      <Section title="Cards under the chat" hint="The groups of cards under the message box on the empty chat. Untick a group or a single card to hide it.">
        {BRIEFING_CATEGORIES.map((c) => {
          const off = prefs.chat.hiddenBriefing.includes(categoryKey(c.id));
          const flip = (key: string) => update((p) => ({ ...p, chat: { ...p.chat, hiddenBriefing: p.chat.hiddenBriefing.includes(key) ? p.chat.hiddenBriefing.filter((x) => x !== key) : [...p.chat.hiddenBriefing, key] } }));
          return (
            <div key={c.id}>
              <label className="voice-option"><input type="checkbox" checked={!off} onChange={() => flip(categoryKey(c.id))} /><span><b>{c.title}</b></span></label>
              {c.cards.length > 1 && c.cards.map((card) => (
                <label key={card.id} className="voice-option" style={{ marginLeft: 22 }}>
                  <input type="checkbox" disabled={off} checked={!off && !prefs.chat.hiddenBriefing.includes(card.id)} onChange={() => flip(card.id)} />
                  <span>{card.label}</span>
                </label>
              ))}
            </div>
          );
        })}
      </Section>
      <Section title="Own starter prompts" hint="Frequent requests as buttons on the empty chat. Up to 12.">
        <ul className="prefs-list">
          {prefs.starters.map((s, i) => (
            <li key={`${s.label}-${i}`}><span>{s.label}<small>{s.prompt.slice(0, 90)}</small></span><button className="ghost-btn" onClick={() => update((p) => ({ ...p, starters: p.starters.filter((_, j) => j !== i) }))}>Remove</button></li>
          ))}
        </ul>
        <div className="prefs-row">
          <input type="text" value={label} maxLength={40} placeholder="Button text" onChange={(e) => setLabel(e.target.value)} aria-label="Starter label" />
        </div>
        <textarea className="prefs-area" value={prompt} maxLength={600} placeholder="What is sent to the assistant" onChange={(e) => setPrompt(e.target.value)} aria-label="Starter prompt" />
        <div className="prefs-row"><button className="ghost-btn" disabled={!label.trim() || !prompt.trim()} onClick={add}>Add starter</button></div>
      </Section>
      <Section title="Default setup" hint="Connectors the assistant should prefer when several fit. The preferred model is saved with your settings as a reminder; the model itself is switched in the model menu of the message box.">
        {connectors.length === 0 ? <p className="prefs-note">No connectors found.</p> : connectors.map((c) => (
          <label key={c} className="voice-option">
            <input type="checkbox" checked={prefs.setup.connectors.includes(c)} onChange={() => update((p) => ({ ...p, setup: { ...p.setup, connectors: toggle(p.setup.connectors, c, 12) } }))} />
            <span>{c}</span>
          </label>
        ))}
        <div className="prefs-row">
          <label htmlFor="pref-model">Preferred model</label>
          <input id="pref-model" type="text" value={prefs.setup.model} maxLength={80} placeholder="for example openai/gpt-4.1-mini" onChange={(e) => update((p) => ({ ...p, setup: { ...p.setup, model: e.target.value } }))} />
        </div>
      </Section>
    </>
  );
}

export function AssistantPanel({ prefs, update }: Common) {
  const set = (patch: Partial<Preferences['assistant']>) => update((p) => ({ ...p, assistant: { ...p.assistant, ...patch } }));
  const note = assistantNote(prefs);
  const setChat = (patch: Partial<Preferences['chat']>) => update((p) => ({ ...p, chat: { ...p.chat, ...patch } }));
  return (
    <>
      <Section title="Answers" hint="Sent with every message, together with your instructions.">
        <Choice label="Language" value={prefs.assistant.language} options={LANGUAGES} show={(v) => ({ auto: 'Automatic', de: 'German', en: 'English' })[v]} onPick={(v) => set({ language: v })} />
        <Choice label="Length" value={prefs.assistant.length} options={LENGTHS} show={(v) => ({ concise: 'Short', balanced: 'Balanced', detailed: 'Detailed' })[v]} onPick={(v) => set({ length: v })} />
        <Choice label="Tone" value={prefs.assistant.tone} options={TONES} show={(v) => ({ neutral: 'Neutral', friendly: 'Friendly', formal: 'Formal' })[v]} onPick={(v) => set({ tone: v })} />
      </Section>
      <Section title="Standing instructions" hint="For example: always name the source, write numbers in euro, prefer tables.">
        <textarea className="prefs-area" value={prefs.assistant.instructions} maxLength={1000} onChange={(e) => set({ instructions: e.target.value })} aria-label="Standing instructions" />
        <p className="prefs-note">{prefs.assistant.instructions.length} / 1000</p>
      </Section>
      <Section title="Chat window" hint="Helpers that show their result in the chat window once switched on.">
        <label className="voice-option"><input type="checkbox" checked={prefs.chat.askBeforeActions} onChange={(e) => setChat({ askBeforeActions: e.target.checked })} /><span>Ask before actions (approval card for anything that changes something)</span></label>
        <label className="voice-option"><input type="checkbox" checked={prefs.chat.readAloud} onChange={(e) => setChat({ readAloud: e.target.checked })} /><span>Read aloud: “Listen” button under each answer</span></label>
        <label className="voice-option"><input type="checkbox" checked={prefs.chat.privacyBar} onChange={(e) => setChat({ privacyBar: e.target.checked })} /><span>Privacy bar: web search, connectors and model in use</span></label>
        <label className="voice-option"><input type="checkbox" checked={prefs.chat.usage} onChange={(e) => setChat({ usage: e.target.checked })} /><span>Usage and cost estimate for this conversation</span></label>
        {prefs.chat.usage && (
          <div className="prefs-row">
            <label className="prefs-field">Price per 1M input tokens (€)<input type="number" min={0} max={1000} step={0.1} value={prefs.chat.priceInPerM} onChange={(e) => setChat({ priceInPerM: Number(e.target.value) || 0 })} /></label>
            <label className="prefs-field">Price per 1M output tokens (€)<input type="number" min={0} max={1000} step={0.1} value={prefs.chat.priceOutPerM} onChange={(e) => setChat({ priceOutPerM: Number(e.target.value) || 0 })} /></label>
          </div>
        )}
      </Section>
      <Section title="What the assistant receives">
        <pre className="prefs-note" style={{ whiteSpace: 'pre-wrap' }}>{note || 'Nothing: all settings are at their defaults.'}</pre>
      </Section>
    </>
  );
}

export type SyncState = { busy: boolean; message: string };

export function StoragePanel({ prefs, update, syncAvailable, sync, onSave, onLoad }: Common & { syncAvailable: boolean; sync: SyncState; onSave: () => void; onLoad: () => void }) {
  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState<(typeof PURPOSES)[number]>('reports');
  const [location, setLocation] = useState('');
  const [fileMessage, setFileMessage] = useState('');
  const add = () => {
    if (!name.trim() || !location.trim()) return;
    update((p) => ({ ...p, storages: [...p.storages, { id: `loc-${Date.now().toString(36)}`, name: name.trim(), purpose, location: location.trim() }].slice(0, 10) }));
    setName(''); setLocation('');
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([exportPreferences(prefs)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'werkbank-settings.json'; a.click();
    URL.revokeObjectURL(url);
  };
  const upload = async (file: File | undefined) => {
    if (!file) return;
    try {
      const imported = importPreferences(await file.text());
      update(() => imported);
      setFileMessage('Settings imported.');
    } catch (error) {
      setFileMessage(error instanceof Error ? error.message : 'Import failed.');
    }
  };
  return (
    <>
      <Section title="Storage locations" hint="Named places for results, for example a folder for reports. The assistant is told about them and uses one only when you ask it to save something.">
        <ul className="prefs-list">
          {prefs.storages.map((s) => (
            <li key={s.id}><span>{s.name}<small>{PURPOSE_NAMES[s.purpose]} · {s.location}</small></span><button className="ghost-btn" onClick={() => update((p) => ({ ...p, storages: p.storages.filter((x) => x.id !== s.id) }))}>Remove</button></li>
          ))}
        </ul>
        <div className="prefs-row">
          <input type="text" value={name} maxLength={40} placeholder="Name" onChange={(e) => setName(e.target.value)} aria-label="Storage name" />
          <select value={purpose} onChange={(e) => setPurpose(e.target.value as (typeof PURPOSES)[number])} aria-label="Purpose">
            {PURPOSES.map((x) => <option key={x} value={x}>{PURPOSE_NAMES[x]}</option>)}
          </select>
        </div>
        <div className="prefs-row">
          <input type="text" style={{ flex: 1 }} value={location} maxLength={300} placeholder="Folder or address, for example ~/Documents/Reports" onChange={(e) => setLocation(e.target.value)} aria-label="Location" />
          <button className="ghost-btn" disabled={!name.trim() || !location.trim()} onClick={add}>Add</button>
        </div>
      </Section>
      <Section title="Sync with Supabase" hint="Saves these settings (never passwords or keys) in the Supabase table werkbank.preferences through the Werkbank Workspace connector, so every computer can load the same setup. Needs the Supabase connection and migration 016.">
        <div className="prefs-row">
          <label htmlFor="sync-key">Settings name</label>
          <input id="sync-key" type="text" value={prefs.sync.key} maxLength={40} onChange={(e) => update((p) => ({ ...p, sync: { ...p.sync, key: e.target.value.toLowerCase() } }))} />
        </div>
        <div className="prefs-row">
          <button className="ghost-btn" disabled={!syncAvailable || sync.busy} onClick={onSave}>Save to Supabase</button>
          <button className="ghost-btn" disabled={!syncAvailable || sync.busy} onClick={onLoad}>Load from Supabase</button>
        </div>
        <label className="voice-option">
          <input type="checkbox" checked={prefs.sync.auto} onChange={(e) => update((p) => ({ ...p, sync: { ...p.sync, auto: e.target.checked } }))} />
          <span>Load these settings when the app starts</span>
        </label>
        {!syncAvailable && <p className="prefs-note">The Werkbank Workspace connector is not connected yet. Add it under Connectors & Skills.</p>}
        {sync.message && <p className="prefs-note" role="status">{sync.message}</p>}
      </Section>
      <Section title="Export and import" hint="A file with all settings, for backup or to give to a colleague. It contains no passwords or keys.">
        <div className="prefs-row">
          <button className="ghost-btn" onClick={download}>Export to file</button>
          <label className="ghost-btn" style={{ cursor: 'pointer' }}>
            Import from file
            <input type="file" accept="application/json,.json" hidden onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
        </div>
        {fileMessage && <p className="prefs-note" role="status">{fileMessage}</p>}
      </Section>
    </>
  );
}
