/**
 * The one path of an intent-based development, the same for an agent and for an n8n workflow:
 * Intent, Requirements, Specification & Architecture, Build, Test & go live.
 * The agent project keeps its three specification documents (TFD, Architecture, Risk & test) as sub-steps of the third step.
 */
export const FLOW = ['intent', 'requirements', 'specification', 'build', 'test'] as const;
export type FlowStep = (typeof FLOW)[number];
export const FLOW_LABEL: Record<FlowStep, string> = {
  intent: 'Intent',
  requirements: 'Requirements',
  specification: 'Specification & Architecture',
  build: 'Build',
  test: 'Test & go live',
};
