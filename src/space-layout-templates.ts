/**
 * Starting points for the Space Designer. Every template is a plain layout (checked by the same function as a stored
 * one) with invented sample content; a person overwrites it. Fictional data, nothing is connected.
 */
import { emptyLayout, normalizeLayout, type Layout } from './space-layout.ts';

export type LayoutTemplate = { id: string; name: string; description: string; title: string; layout: Layout };

const make = (id: string, name: string, description: string, title: string, raw: unknown): LayoutTemplate => ({ id, name, description, title, layout: normalizeLayout(raw) });

export const LAYOUT_TEMPLATES: readonly LayoutTemplate[] = [
  { id: 'blank', name: 'Blank page', description: 'Start with nothing and add blocks yourself.', title: 'New Space', layout: emptyLayout() },
  make('kpi-overview', 'Key figures and trend', 'Four key figures, a chart with its data, and a table with status colours.', 'Quarterly overview', {
    datasets: [
      { id: 'd1', name: 'Revenue by month', columns: ['Month', 'Plan', 'Actual'], rows: [['Jan', '40', '36'], ['Feb', '44', '47'], ['Mar', '48', '51'], ['Apr', '52', '49'], ['May', '57', '61'], ['Jun', '60', '66']] },
      { id: 'd2', name: 'Initiatives', columns: ['Initiative', 'Owner', 'Status', 'Budget'], rows: [['Order portal', 'Ana', '{ok} On track', '120000'], ['Data clean-up', 'Ben', '{warn} At risk', '60000'], ['Partner onboarding', 'Chen', '{bad} Blocked', '45000'], ['Training', 'Dora', '{ok} On track', '30000']] },
    ],
    blocks: [
      { type: 'kpis', items: [
        { label: 'Revenue', value: '4.2M', delta: '+6% vs last quarter', tone: 'ok', trend: '3.1, 3.4, 3.3, 3.8, 4.0, 4.2' },
        { label: 'Open cases', value: '38', delta: '-5 this week', tone: 'ok', trend: '52, 49, 47, 44, 41, 38' },
        { label: 'At risk', value: '7', delta: '+2 this week', tone: 'bad', trend: '3, 3, 4, 5, 5, 7' },
        { label: 'Customer score', value: '4.4', delta: '+0.1', tone: 'ok', trend: '' },
      ] },
      { type: 'chart', title: 'Plan and actual', sub: 'Revenue per month, million euro', kind: 'bar', dataset: 'd1' },
      { type: 'table', title: 'Initiatives', dataset: 'd2', sortable: true, totals: true },
    ],
  }),
  make('three-boxes', 'Three boxes side by side', 'A heading and three boxes with parallel text: situation, options, recommendation.', 'Decision brief', {
    blocks: [
      { type: 'heading', text: 'Decision brief', sub: 'What we know, what we can do, what we suggest.', level: 1 },
      { type: 'columns', title: '', count: 3, boxes: [
        { title: 'Situation', text: 'Two or three sentences on where things stand.\n\n- First fact\n- Second fact' },
        { title: 'Options', text: '- **A** Keep the process\n- **B** Automate the check\n- **C** Hand it to a partner' },
        { title: 'Recommendation', text: '**Option B.** It removes the manual check and keeps a person in charge of the approval.' },
      ] },
      { type: 'callout', tone: 'warn', title: 'Open point', text: 'Name the one thing that still needs a decision and who takes it.' },
    ],
  }),
  make('compare', 'Two options compared', 'Two boxes with pros and cons, a matrix for impact and effort, and an Ask Joule button.', 'Option comparison', {
    blocks: [
      { type: 'heading', text: 'Option comparison', sub: 'Build or buy.', level: 1 },
      { type: 'compare', title: 'Build or buy', left: { title: 'Build', tone: 'ok', lines: '- Fits our process\n- Full control' }, right: { title: 'Buy', tone: 'warn', lines: '- Faster to start\n- Licence cost each year' } },
      { type: 'matrix', title: 'Impact and effort', xLabel: 'Effort', yLabel: 'Impact', points: [{ label: 'Build', x: 75, y: 80 }, { label: 'Buy', x: 30, y: 60 }, { label: 'Do nothing', x: 5, y: 10 }] },
      { type: 'ask', label: 'Ask Joule for a recommendation', prompt: 'Compare the two options on this page and recommend one. Name the assumption that would change your mind.' },
    ],
  }),
  make('process', 'Process explained', 'Steps, a timeline, a progress bar and fold-out answers for an onboarding or a roll-out.', 'How it works', {
    blocks: [
      { type: 'heading', text: 'How it works', sub: 'From request to approval in four steps.', level: 1 },
      { type: 'steps', title: 'The process', items: [{ title: 'Request', text: 'Someone asks.' }, { title: 'Check', text: 'Rules are applied.' }, { title: 'Approve', text: 'A person decides.' }, { title: 'Done', text: 'The result is recorded.' }] },
      { type: 'timeline', title: 'Roll-out', items: [{ when: 'Q1', title: 'Pilot', text: 'One team.' }, { when: 'Q2', title: 'Extend', text: 'Three teams.' }, { when: 'Q3', title: 'All teams', text: 'Everybody.' }] },
      { type: 'progress', title: 'Where we are', mode: 'progress', items: [{ label: 'Pilot', value: 100, max: 100 }, { label: 'Extension', value: 40, max: 100 }, { label: 'All teams', value: 0, max: 100 }] },
      { type: 'accordion', title: 'Questions', items: [{ title: 'Who approves?', text: 'The line manager, within the limit of the role.' }, { title: 'What if the check fails?', text: 'The request goes back with the reason.' }] },
    ],
  }),
];

export const templateById = (id: string): LayoutTemplate | undefined => LAYOUT_TEMPLATES.find((t) => t.id === id);
