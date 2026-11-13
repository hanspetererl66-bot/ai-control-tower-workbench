import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { PROJECTS_PULLED, schedule as scheduleWorkSync } from '../work-sync-runner';
import SharedSaveLine from './SharedSaveLine';
import { emptyIntent, extendProject, loadProjects, newProject, saveProjects, upsertProject, type Project } from '../develop';
import { loadMap } from '../work-sync';
import DevelopWizard from './DevelopWizard';
import DictateButton from './DictateButton';
import { appendDictation } from '../voice-text';
import SourcesView from './SourcesView';
import { localTarget, newExtension, requirementLines, SOURCES, type Handover } from '../requirements';
import { featureArgs, hostApi, newFeature } from '../registry';
import { FIT_WIDTH, fitScale } from '../develop-fit';

/**
 * Fits the start page to its window: the page is laid out at the design width and scaled as a whole (see develop-fit.ts).
 * `null` means the window is too small for that: the responsive grid and scrolling take over.
 */
function useFit(active: boolean) {
  const mainRef = useRef<HTMLElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ scale: number; h: number } | null>({ scale: 1, h: 0 });
  const fitted = useRef(true);
  const height = useRef(0);
  fitted.current = fit !== null;
  useLayoutEffect(() => {
    const main = mainRef.current, inner = innerRef.current;
    if (!active || !main || !inner) return;
    const measure = () => {
      const css = getComputedStyle(main);
      const w = main.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight);
      const h = main.clientHeight - parseFloat(css.paddingTop) - parseFloat(css.paddingBottom);
      if (fitted.current) height.current = inner.offsetHeight; /* the natural height at the design width; a transform does not change it */
      const scale = fitScale({ w, h }, { w: FIT_WIDTH, h: height.current });
      setFit((cur) => {
        if (scale === null) return cur === null ? cur : null;
        return cur && cur.scale === scale && cur.h === height.current ? cur : { scale, h: height.current };
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(main);
    observer.observe(inner);
    return () => observer.disconnect();
  }, [active]);
  return { mainRef, innerRef, fit };
}

type Props = {
  onAgentIntent: (intent: string) => void;
  onAgent: () => void;
  onOpenN8n: () => void;
  onOpenSkills: () => void;
  onOpenConnectors: () => void;
  generate: (prompt: string, title: string, session?: string) => Promise<string>;
  onStop: () => void;
  ready: boolean;
  onRestartAgent: () => Promise<void> | void;
  /** An agent from a cluster of requirements: the Agent Studio takes over. */
  onAgentFrom: (h: Handover) => void;
  onOpenRegistry: () => void;
};

/**
 * Start page of "Develop": four tiles. Agent and Workflow start from a goal ("intent"): the person says what should be
 * achieved. An agent goes into the Agent Studio (confirmed steps up to the build). A workflow goes through requirements,
 * specification and solution architecture in the guided process and ends as an importable n8n workflow.
 * Skills and Connectors are two tiles of their own: each explains the building block and opens it.
 */
export default function DevelopHub(props: Props) {
  const [projects, setProjects] = useState<Project[]>(() => loadProjects(window.localStorage));
  const [openId, setOpenId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState({ ok: true, at: 0 });
  useEffect(() => { const ok = saveProjects(window.localStorage, projects); setSaveState((s) => ({ ok, at: ok ? Date.now() : s.at })); scheduleWorkSync(); }, [projects]);
  // Projects taken over from the shared database while this view is open.
  useEffect(() => {
    const reload = () => setProjects(loadProjects(window.localStorage));
    window.addEventListener(PROJECTS_PULLED, reload);
    return () => window.removeEventListener(PROJECTS_PULLED, reload);
  }, []);
  const open = projects.find((p) => p.id === openId) ?? null;
  const [mode, setMode] = useState<'hub' | 'sources' | 'agent'>('hub');
  const { mainRef, innerRef, fit } = useFit(!open && mode === 'hub');

  const startWorkflow = (goal: string) => {
    const p = newProject('workflow');
    p.intent = { ...emptyIntent(), goal };
    setProjects((list) => upsertProject(list, p));
    setOpenId(p.id);
  };

  /** Where a cluster from the Sources tile goes: Agent Studio, the workflow process, or the registry (features). */
  const handOver = async (h: Handover): Promise<string> => {
    if (h.base === 'agent') { props.onAgentFrom(h); return ''; }
    if (h.base === 'workflow') {
      // An extension of a workflow that is on this computer: add it to that project (the next save is a new revision of the same entry).
      const here = h.extends ? localTarget(loadMap(window.localStorage), h.extends.id) : null;
      const mine = here?.kind === 'dev' ? projects.find((x) => x.id === here.id && x.kind === 'workflow') : undefined;
      if (mine) {
        const next = extendProject(mine, newExtension(h));
        setProjects((list) => upsertProject(list, next));
        setMode('hub');
        setOpenId(next.id);
        return '';
      }
      const p = newProject('workflow');
      const lines = requirementLines(h);
      p.intent = { ...emptyIntent(), name: h.name, goal: `${h.goal}${lines ? `\n\nRequirements from the sources:\n${lines}` : ''}`.slice(0, 1500) };
      if (h.refs.length) p.sources = h.refs;
      if (h.extends) p.extends = h.extends;
      setProjects((list) => upsertProject(list, p));
      setMode('hub');
      setOpenId(p.id);
      return '';
    }
    const api = hostApi();
    if (!api) throw new Error('A feature is kept in the registry. That needs the desktop app and the shared database (connector "werkbank-workspace").');
    const res = await api.call('save_work_item', featureArgs(newFeature(h), { note: `Created from Sources: ${h.refs.length} requirement${h.refs.length === 1 ? '' : 's'}` }));
    return `"${h.name}" is a feature in the registry now (revision ${Number(res?.rev) || 1}).`;
  };

  if (open) {
    return (
      <main className="main develop-main develop-top">
        <DevelopWizard
          project={open}
          onChange={(p) => setProjects((list) => upsertProject(list, p))}
          saveState={saveState}
          onClose={() => setOpenId(null)}
          generate={props.generate}
          onStop={props.onStop}
          ready={props.ready}
          onOpenN8n={props.onOpenN8n}
          onOpenConnectors={props.onOpenConnectors}
          onRestartAgent={props.onRestartAgent}
        />
      </main>
    );
  }

  if (mode === 'sources') {
    return <SourcesView generate={props.generate} onStop={props.onStop} ready={props.ready} onBack={() => setMode('hub')} onHandover={handOver} onOpenRegistry={props.onOpenRegistry} />;
  }

  if (mode === 'agent') {
    return (
      <main className="main develop-main">
        <div className="develop">
          <button className="develop-back" onClick={() => setMode('hub')} aria-label="Back to Develop">← Develop</button>
          <h1 className="develop-title">Agent Studio</h1>
          <p className="develop-sub">Three ways to get an agent: build a new one, extend an SAP standard agent, or bring in an agent that lives elsewhere. Each starts a project in the Agent Studio that you confirm step by step.</p>
          <div className="develop-cards develop-cards-three">
            <IntentCard
              kind="agent-new" logo={<AgentNewMark />} title="Create new agent" brand="from a goal"
              text="From goal to agent in confirmed steps: requirements, design, architecture, test plan, build."
              placeholder="e.g. Watch our renewals and tell me every Monday which ones are at risk"
              action="Start from this goal" other="or open the Agent Studio"
              onIntent={props.onAgentIntent} onOther={props.onAgent}
            />
            <IntentCard
              kind="agent-ext" logo={<AgentExtendMark />} title="Extend existing SAP standard agent" brand="add what the standard agent lacks"
              text="Name the SAP standard agent and say what it should do in addition. Your extension is planned and built on top of it, the standard agent stays as it is."
              placeholder="e.g. Let the purchase-order agent also check our supplier blocks before it proposes an order"
              action="Start the extension"
              onIntent={(g) => props.onAgentIntent(`Extend the existing SAP standard agent: ${g}`)}
            />
            <IntentCard
              kind="agent-int" logo={<AgentIntegrateMark />} title="Integrate external agent" brand="bring in an agent from outside"
              text="Say which agent from outside should work with Joule and what it should do for you. The Agent Studio plans how it is connected, what it may see and who approves."
              placeholder="e.g. Connect the supplier's order agent so that it answers delivery questions for us"
              action="Start the integration"
              onIntent={(g) => props.onAgentIntent(`Integrate an external agent: ${g}`)}
            />
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="main develop-main" ref={mainRef}>
      <div className={`develop-fit ${fit ? 'develop-fit-on' : ''}`} style={fit ? { width: FIT_WIDTH * fit.scale, height: fit.h * fit.scale } : undefined}>
      <div className="develop" ref={innerRef} style={fit ? { transform: `scale(${fit.scale})` } : undefined}>
        <h1 className="develop-title">Develop</h1>
        <SharedSaveLine />
        <p className="develop-sub">Say what you want to achieve. Joule turns the goal into a draft, you refine and approve it.</p>
        <section className="develop-card develop-card-wide" aria-label="Start from requirements">
          <div className="develop-wide-text">
            <span className="develop-card-title">Start from requirements</span>
            <span className="develop-card-brand">from {SOURCES.map((s) => s.label).join(', ')}</span>
            <span className="develop-card-text">Read the requirements you already have, tick the ones that belong together, and let Joule cluster them and propose what each cluster is: an agent, a workflow, an extension of one, or a feature.</span>
          </div>
          <button className="dialog-btn dialog-btn-primary develop-go develop-go-wide" onClick={() => setMode('sources')}>Open Sources</button>
        </section>
        <div className="develop-cards">
          <BlockCard
            kind="agent" logo={<AgentMark />} title="Agent Studio" brand="build, extend, integrate" label="Agent Studio"
            text="Everything about agents in one place: create a new one, extend an SAP standard agent or integrate an external agent."
            points={['Confirmed steps from requirements to build', 'Three ways in, one studio']}
            action="Open Agent Studio" onOpen={() => setMode('agent')}
          />
          <IntentCard
            kind="n8n" logo={<N8nSymbol />} title="Create a Workflow" brand="with n8n"
            text="From intent through requirements and specification to an importable n8n workflow."
            placeholder="e.g. When a contract is uploaded, check the notice period and mail the owner"
            action="Start the guided process" other="Direct access to n8n"
            onIntent={startWorkflow} onOther={props.onOpenN8n}
          />
          <BlockCard
            kind="skills" logo={<SkillMark />} title="Skills" brand="the know-how" label="Skills"
            text="Instructions that tell Joule how to do a task, and scripts or templates that come with them."
            points={['Written once, shared by team and organization', 'Checked and approved before others use them']}
            action="Open Skills" onOpen={props.onOpenSkills}
          />
          <BlockCard
            kind="connectors" logo={<ConnectorMark />} title="Connectors" brand="the tools" label="Connectors"
            text="A safe link to an app or a data source, so that Joule can read from it or act in it."
            points={['SAP, Salesforce, Jira, Slack, Databricks and more', 'You decide which tools ask first']}
            action="Open Connectors" onOpen={props.onOpenConnectors}
          />
        </div>
        <p className="develop-explain">
          Build an agent from a goal, or a workflow that runs on its own in n8n. Agents combine skills (the know-how) with connectors (the tools),
          so open Skills and Connectors to see, add and manage what is available. Nothing is used before you have confirmed it.
        </p>
      </div>
      </div>
    </main>
  );
}

function BlockCard(p: {
  kind: 'agent' | 'skills' | 'connectors'; logo: React.ReactNode; title: string; brand: string; label: string; text: string;
  points: string[]; action: string; onOpen: () => void;
}) {
  return (
    <section className="develop-card develop-card-block" aria-label={p.label}>
      <span className={`develop-logo develop-logo-${p.kind}`} aria-hidden="true">{p.logo}</span>
      <span className="develop-card-title">{p.title}</span>
      <span className="develop-card-brand">{p.brand}</span>
      <span className="develop-card-text">{p.text}</span>
      <ul className="develop-blocks">
        {p.points.map((x) => <li key={x}><span>{x}</span></li>)}
      </ul>
      <button className="dialog-btn dialog-btn-primary develop-go" onClick={p.onOpen}>{p.action}</button>
    </section>
  );
}

function IntentCard(p: {
  kind: 'agent-new' | 'agent-ext' | 'agent-int' | 'n8n'; logo: React.ReactNode; title: string; brand: string; text: string; placeholder: string;
  action: string; other?: string; onIntent: (intent: string) => void; onOther?: () => void;
}) {
  const [goal, setGoal] = useState('');
  const ok = goal.trim().length >= 8;
  return (
    <section className="develop-card" aria-label={p.title}>
      <span className={`develop-logo develop-logo-${p.kind}`} aria-hidden="true">{p.logo}</span>
      <span className="develop-card-title">{p.title}</span>
      <span className="develop-card-brand">{p.brand}</span>
      <span className="develop-card-text">{p.text}</span>
      <label className="develop-goal">
        <span>What should be achieved?</span>
        <span className="dictate-wrap">
          <textarea value={goal} rows={3} maxLength={400} placeholder={p.placeholder} onChange={(e) => setGoal(e.target.value)} />
          <DictateButton label="Dictate the goal" onText={(heard) => setGoal((g) => appendDictation(g, heard, 400))} />
        </span>
      </label>
      <button className="dialog-btn dialog-btn-primary develop-go" disabled={!ok} onClick={() => { p.onIntent(goal.trim()); setGoal(''); }}>{p.action}</button>
      {p.other && p.onOther && <button className="develop-other" onClick={p.onOther}>{p.other}</button>}
    </section>
  );
}

/** A robot with a plus: a new agent. */
function AgentNewMark() {
  return (
    <svg viewBox="0 0 64 64" width="64" height="64" fill="none">
      <rect x="8" y="16" width="40" height="32" rx="11" fill="currentColor" />
      <circle cx="20" cy="31" r="4.2" fill="#fff" /><circle cx="36" cy="31" r="4.2" fill="#fff" />
      <path d="M22 40c1.8 1.6 3.6 2.4 6 2.4s4.2-.8 6-2.4" stroke="#fff" strokeWidth="2.8" strokeLinecap="round" />
      <path d="M28 6v7" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" />
      <circle cx="49" cy="15" r="10" fill="currentColor" opacity=".55" />
      <path d="M49 10v10M44 15h10" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/** A block with a part plugged on top: an extension of an existing agent. */
function AgentExtendMark() {
  return (
    <svg viewBox="0 0 64 64" width="64" height="64" fill="none">
      <rect x="8" y="30" width="48" height="26" rx="8" fill="currentColor" />
      <path d="M18 43h28" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" />
      <path d="M22 30v-6a6 6 0 0 1 12 0v6" fill="currentColor" opacity=".55" />
      <rect x="22" y="6" width="26" height="20" rx="6" fill="currentColor" opacity=".55" transform="rotate(8 35 16)" />
      <path d="M33 14l4 4-4 4" stroke="#fff" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Two agents linked across a gap: an external agent brought in. */
function AgentIntegrateMark() {
  return (
    <svg viewBox="0 0 64 64" width="64" height="64" fill="none">
      <rect x="4" y="20" width="22" height="24" rx="8" fill="currentColor" />
      <rect x="38" y="20" width="22" height="24" rx="8" fill="currentColor" opacity=".55" />
      <circle cx="11" cy="31" r="2.6" fill="#fff" /><circle cx="19" cy="31" r="2.6" fill="#fff" />
      <circle cx="45" cy="31" r="2.6" fill="#fff" /><circle cx="53" cy="31" r="2.6" fill="#fff" />
      <path d="M26 32h12" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeDasharray="1 6" />
      <path d="M29 26l-4 6 4 6M35 26l4 6-4 6" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The n8n symbol (the node mark of the brand), drawn here at icon size. */
function N8nSymbol() {
  return (
    <svg viewBox="0 0 304 160" width="88" height="46" role="img" aria-label="n8n">
      <path fillRule="evenodd" clipRule="evenodd" d="M272 64C257.089 64 244.561 53.8018 241.008 40H204.331C196.51 40 189.835 45.6546 188.549 53.3696L187.234 61.2608C185.985 68.7531 182.195 75.2738 176.835 80C182.195 84.7262 185.985 91.2469 187.234 98.7392L188.549 106.63C189.835 114.345 196.51 120 204.331 120H209.008C212.561 106.198 225.089 96 240 96C257.673 96 272 110.327 272 128C272 145.673 257.673 160 240 160C225.089 160 212.56 149.802 209.008 136H204.331C188.688 136 175.338 124.691 172.766 109.261L171.451 101.37C170.165 93.6546 163.49 88 155.669 88H142.992C139.44 101.802 126.911 112 112 112C97.0893 112 84.5605 101.802 81.0081 88H62.9919C59.4395 101.802 46.9107 112 32 112C14.3269 112 0 97.6731 0 80C0 62.3269 14.3269 48 32 48C46.9107 48 59.4395 58.1982 62.9919 72H81.0081C84.5605 58.1982 97.0893 48 112 48C126.911 48 139.44 58.1982 142.992 72H155.669C163.49 72 170.165 66.3454 171.451 58.6304L172.766 50.7392C175.338 35.3092 188.688 24 204.331 24L241.008 24C244.56 10.1982 257.089 0 272 0C289.673 0 304 14.3269 304 32C304 49.6731 289.673 64 272 64ZM272 48C280.837 48 288 40.8366 288 32C288 23.1634 280.837 16 272 16C263.163 16 256 23.1634 256 32C256 40.8366 263.163 48 272 48ZM32 96C40.8366 96 48 88.8366 48 80C48 71.1634 40.8366 64 32 64C23.1634 64 16 71.1634 16 80C16 88.8366 23.1634 96 32 96ZM128 80C128 88.8366 120.837 96 112 96C103.163 96 96 88.8366 96 80C96 71.1634 103.163 64 112 64C120.837 64 128 71.1634 128 80ZM256 128C256 136.837 248.837 144 240 144C231.163 144 224 136.837 224 128C224 119.163 231.163 112 240 112C248.837 112 256 119.163 256 128Z" fill="#EA4B71" />
    </svg>
  );
}

/** An open book with a spark: a generic skill mark. */
function SkillMark() {
  return (
    <svg viewBox="0 0 64 64" width="64" height="64" fill="none">
      <path d="M8 16c8-3 16-2 24 3v30c-8-5-16-6-24-3z" fill="currentColor" />
      <path d="M56 16c-8-3-16-2-24 3v30c8-5 16-6 24-3z" fill="currentColor" opacity=".55" />
      <path d="M46 4l1.8 4.2L52 10l-4.2 1.8L46 16l-1.8-4.2L40 10l4.2-1.8z" fill="currentColor" />
    </svg>
  );
}

/** Two plugs meeting: a generic connector mark. */
function ConnectorMark() {
  return (
    <svg viewBox="0 0 64 64" width="64" height="64" fill="none">
      <rect x="8" y="22" width="22" height="20" rx="8" fill="currentColor" />
      <rect x="34" y="22" width="22" height="20" rx="8" fill="currentColor" opacity=".55" />
      <path d="M30 28h4M30 36h4" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" />
    </svg>
  );
}

/** A friendly agent: head with antenna, eyes and a spark. */
function AgentMark() {
  return (
    <svg viewBox="0 0 64 64" width="64" height="64" fill="none">
      <path d="M32 6v7" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" />
      <circle cx="32" cy="5.5" r="3.2" fill="currentColor" />
      <rect x="10" y="14" width="44" height="34" rx="12" fill="currentColor" />
      <circle cx="23" cy="30" r="4.6" fill="#fff" />
      <circle cx="41" cy="30" r="4.6" fill="#fff" />
      <path d="M25 40c2 2 4.2 3 7 3s5-1 7-3" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
      <path d="M5 28v8M59 28v8" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" />
      <path d="M32 54l2 4 4 2-4 2-2 4-2-4-4-2 4-2z" fill="currentColor" opacity=".55" />
    </svg>
  );
}
