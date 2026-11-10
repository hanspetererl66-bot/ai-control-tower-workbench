/**
 * The gate and the redaction of the agent network, in one place for everyone who needs them:
 *  - src/agent-network.ts (the app) wraps them with types,
 *  - the Space `agent-network` carries a copy between `// @rules-start` and `// @rules-end` (npm run sync:agent-network writes it, a test fails when the page is out of date),
 *  - the tests run both and compare.
 * Plain data in, plain data out, ES5 style, no imports: the function is copied into a page as text.
 */
export function makeNetworkRules() {
  var MAX_HOPS = 3;
  var MAX_CALLS_PER_TRACE = 6;
  var CLASSES = ['public', 'internal', 'confidential', 'personal'];
  var DEFAULT_RELEASES = { public: 'answer', internal: 'answer', confidential: 'approve', personal: 'refuse' };
  var NO_CONTRACT = { callable: false, capability: '', accepts: '', returns: '', releases: DEFAULT_RELEASES, mayCall: [] };
  var ORDER = ['answer', 'redact', 'approve', 'refuse'];
  function contractOf(a) { return (a && a.contract) || NO_CONTRACT; }
  function find(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
  function worst(rs) { var w = 'answer'; for (var i = 0; i < rs.length; i++) if (ORDER.indexOf(rs[i]) > ORDER.indexOf(w)) w = rs[i]; return w; }
  function only(classes, rel, c) { var out = []; for (var i = 0; i < classes.length; i++) if (c.releases[classes[i]] === rel) out.push(classes[i]); return out; }

  /** The gate. Checked in this order; the first failing check refuses with its reason.
   *  env: { trace, from, to, classes }; ctx: { agents, published(id), stopped(id), traces: Map(trace -> { agentId, hop, calls }) }. */
  function decide(env, ctx) {
    function refuse(reason) { return { outcome: 'refused', reason: reason }; }
    var trace = ctx.traces.get(env.trace);
    if (!trace) return refuse('The run id (trace) is unknown or has ended: only a run the app started may ask other agents.');
    if (trace.agentId !== env.from) return refuse('The run id belongs to another agent.');
    var from = find(ctx.agents, env.from), to = find(ctx.agents, env.to);
    if (!from) return refuse('The asking agent no longer exists.');
    if (!to) return refuse('The agent that is asked does not exist.');
    if (env.from === env.to) return refuse('An agent cannot ask itself.');
    if (ctx.stopped(env.from)) return refuse('"' + from.name + '" is stopped.');
    if (ctx.stopped(env.to)) return refuse('"' + to.name + '" is stopped.');
    if (!ctx.published(env.from)) return refuse('"' + from.name + '" is not published, so it may not ask other agents.');
    if (!ctx.published(env.to)) return refuse('"' + to.name + '" is not published, so it cannot be asked.');
    if (contractOf(from).mayCall.indexOf(env.to) < 0) return refuse('"' + from.name + '" is not allowed to ask "' + to.name + '" (see its contract).');
    var c = contractOf(to);
    if (!c.callable) return refuse('"' + to.name + '" does not accept questions from other agents.');
    if (trace.hop >= MAX_HOPS) return refuse('Hop limit reached (' + MAX_HOPS + '): this chain of questions stops here.');
    if (trace.calls >= MAX_CALLS_PER_TRACE) return refuse('This run has already asked ' + MAX_CALLS_PER_TRACE + ' questions: budget used up.');
    var rels = [];
    for (var i = 0; i < env.classes.length; i++) rels.push(c.releases[env.classes[i]]);
    var r = worst(rels);
    if (r === 'refuse') return refuse('"' + to.name + '" never releases ' + only(env.classes, 'refuse', c).join(' or ') + ' data.');
    if (r === 'approve') return { outcome: 'needs_approval', reason: '"' + to.name + '" releases ' + only(env.classes, 'approve', c).join(' and ') + ' data only after its owner approves. There is no approval inbox yet, so nothing was released.' };
    if (r === 'redact') return { outcome: 'redacted', reason: 'Released with amounts and identifiers withheld (' + env.classes.join(', ') + ').' };
    return { outcome: 'answer', reason: 'Released (' + env.classes.join(', ') + ').' };
  }

  /** Replaces addresses, amounts, identifiers and long numbers; used for the release "answer, amounts withheld". */
  function redact(text) {
    return String(text)
      .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[address withheld]')
      .replace(/(?:€|EUR|USD|\$|£)\s?\d[\d.,']*(?:\s?(?:k|m|M|bn|thousand|million))?|\d[\d.,']*\s?(?:€|EUR|USD|\$|£)(?:\s?(?:k|m|M))?/g, '[amount withheld]')
      .replace(/\b[A-Z]{1,5}-?[A-Z0-9]{0,6}-\d{3,}(?:-\d+)*\b/g, '[id withheld]')
      .replace(/\b(?!\d{4}-\d{2}-\d{2}\b)\d{4,}\b/g, '[number withheld]');
  }
  return { MAX_HOPS: MAX_HOPS, MAX_CALLS_PER_TRACE: MAX_CALLS_PER_TRACE, CLASSES: CLASSES, DEFAULT_RELEASES: DEFAULT_RELEASES, decide: decide, redact: redact };
}
