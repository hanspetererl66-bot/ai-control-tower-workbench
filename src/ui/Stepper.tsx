/**
 * The path of an intent-based development as small circles joined by a line: 1, 2, 3 ...
 * A finished step is a filled circle with a check mark, the open step is ringed, a step whose document is out of date shows "!".
 * Used by the Agent project and by the workflow wizard, so both look and behave the same.
 */
export type StepState = 'done' | 'here' | 'todo' | 'stale';
export type StepItem = { id: string; label: string; state: StepState; enabled: boolean };

export default function Stepper({ steps, onSelect, label = 'Steps' }: { steps: StepItem[]; onSelect: (id: string) => void; label?: string }) {
  const finished = steps.filter((s) => s.state === 'done').length;
  const here = steps.findIndex((s) => s.state === 'here');
  return (
    <div className="stepper-wrap">
    <ol className="stepper" aria-label={label} style={{ ['--steps' as string]: steps.length }}>
      {steps.map((s, i) => (
        <li key={s.id} className={`stepper-item stepper-${s.state} ${i > 0 && steps[i - 1].state === 'done' ? 'stepper-linked' : ''}`}>
          <button className="stepper-btn" disabled={!s.enabled} aria-current={s.state === 'here' ? 'step' : undefined} onClick={() => onSelect(s.id)}
            title={s.state === 'done' ? `${s.label}: done` : s.state === 'stale' ? `${s.label}: out of date, check it again` : s.label}>
            <span className="stepper-dot" aria-hidden="true">{s.state === 'done' ? '✓' : s.state === 'stale' ? '!' : i + 1}</span>
            <span className="stepper-label">{s.label}</span>
            <span className="sr-only">{s.state === 'done' ? ', done' : s.state === 'stale' ? ', out of date' : s.state === 'here' ? ', current step' : ''}</span>
          </button>
        </li>
      ))}
      <li className="sr-only" aria-live="polite">{finished} of {steps.length} steps done</li>
    </ol>
    {here >= 0 && <p className="stepper-now" aria-hidden="true">Step {here + 1} of {steps.length}: {steps[here].label}</p>}
    </div>
  );
}
