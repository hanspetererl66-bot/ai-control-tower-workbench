/**
 * The comparison logic of the Recruiting Workbench: requisition status, waiting time per stage, the shortlist against the criteria a
 * hiring manager set (with the CV line as proof), and the proposals Joule may make. Pure functions on plain data.
 * One source for three users: the Space page (embedded by `npm run sync:mockups`, the page cannot import), the recruiting tools of the
 * connector (same data from the database) and the tests. The page and this file must never differ.
 * Dates are text (YYYY-MM-DD). Ordering inside a group is stated, never hidden: must-haves met, must-haves partly met, nice-to-haves met,
 * earlier application. Nothing about the person is used, and there is no function that rejects anybody.
 */
export function makeLogic(D) {
  var STAGES = D.stages;
  function ms(s) { var p = s.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
  function daysBetween(a, b) { return Math.round((ms(b) - ms(a)) / 86400000); }
  function job(id) { return D.jobs.filter(function (j) { return j.id === id; })[0]; }
  function cands(id) { return D.candidates.filter(function (c) { return c.job === id; }); }
  function daysIn(c) { return daysBetween(c.since, D.asOf); }
  function over(c) { return daysIn(c) - D.sla[c.stage]; }
  function stalled(c) { return over(c) > 0; }
  function median(a) {
    var s = a.slice().sort(function (x, y) { return x - y; });
    var m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function baseline(dept) {
    var h = D.history.filter(function (x) { return x.dept === dept; });
    return { median: h.length ? median(h.map(function (x) { return x.days; })) : null, n: h.length };
  }
  function acceptance(dept) {
    var h = D.history.filter(function (x) { return dept === 'all' || x.dept === dept; });
    var o = 0, a = 0;
    h.forEach(function (x) { o += x.offers; a += x.accepted; });
    return { offers: o, accepted: a, rate: o ? a / o : null };
  }
  function furthest(list) {
    var f = -1;
    list.forEach(function (c) { f = Math.max(f, STAGES.indexOf(c.stage)); });
    return f < 0 ? null : STAGES[f];
  }
  function jobStatus(j) {
    var list = cands(j.id);
    var elapsed = daysBetween(j.opened, D.asOf);
    var offer = list.some(function (c) { return c.stage === 'Offer'; });
    var st = offer ? 'offer' : elapsed > j.target ? 'late' : elapsed >= 0.7 * j.target ? 'watch' : 'ok';
    var waiting = list.filter(stalled).length;
    var fr = furthest(list);
    return { job: j, elapsed: elapsed, status: st, offer: offer, waiting: waiting, furthest: fr, count: list.length,
      driver: (fr ? 'Furthest candidate: ' + fr : 'No candidates') + (waiting ? ' · ' + waiting + ' past target' : ' · none past target') };
  }
  function evalCrit(crit, cand) {
    if (crit.kind === 'years') {
      var ok = cand.years >= crit.min;
      return { crit: crit, status: ok ? 'met' : 'missing', line: cand.yearsLine, text: cand.cv[cand.yearsLine - 1] };
    }
    function find(list) {
      for (var i = 0; i < cand.cv.length; i++) {
        for (var k = 0; k < (list || []).length; k++) if (cand.cv[i].toLowerCase().indexOf(list[k].toLowerCase()) >= 0) return i + 1;
      }
      return 0;
    }
    var l = find(crit.needles);
    if (l) return { crit: crit, status: 'met', line: l, text: cand.cv[l - 1] };
    var p = find(crit.partial);
    if (p) return { crit: crit, status: 'partly', line: p, text: cand.cv[p - 1] };
    return { crit: crit, status: 'missing', line: 0, text: '' };
  }
  function evalCand(jobId, cand) {
    var crits = D.criteria[jobId] || [];
    var res = crits.map(function (c) { return evalCrit(c, cand); });
    function n(must, s) { return res.filter(function (r) { return r.crit.must === must && r.status === s; }).length; }
    var mustN = crits.filter(function (c) { return c.must; }).length;
    var e = { cand: cand, res: res, mustN: mustN, niceN: crits.length - mustN,
      mustMet: n(true, 'met'), mustPartly: n(true, 'partly'), mustMissing: n(true, 'missing'), niceMet: n(false, 'met') };
    e.group = e.mustMissing >= 2 ? 'C' : (e.mustMissing === 1 || e.mustPartly > 0) ? 'B' : 'A';
    return e;
  }
  function hasCriteria(jobId) { return !!(D.criteria[jobId] && cands(jobId).every(function (c) { return c.cv; })); }
  function shortlist(jobId) {
    var list = cands(jobId).map(function (c) { return evalCand(jobId, c); });
    list.sort(function (a, b) {
      return (a.group < b.group ? -1 : a.group > b.group ? 1 : 0) || (b.mustMet - a.mustMet) || (b.mustPartly - a.mustPartly) ||
        (b.niceMet - a.niceMet) || (ms(a.cand.applied) - ms(b.cand.applied));
    });
    list.forEach(function (e, i) { e.rank = i + 1; });
    return list;
  }
  // The match agent: the best n candidates of a requisition by the stated rule only. onlyNew keeps candidates still in the first stage.
  function topMatches(jobId, n, opts) {
    var o = opts || {};
    var all = shortlist(jobId).filter(function (e) { return !o.onlyNew || e.cand.stage === STAGES[0]; });
    var pool = o.onlyMeets ? all.filter(function (e) { return e.group === 'A'; }) : all.filter(function (e) { return e.group !== 'C'; });
    var want = Math.max(0, Math.min(Math.floor(n) || 0, pool.length));
    return { requested: Math.max(0, Math.floor(n) || 0), candidates: all.length,
      meetsAll: all.filter(function (e) { return e.group === 'A'; }).length, needsLook: all.filter(function (e) { return e.group === 'B'; }).length,
      notAsWritten: all.filter(function (e) { return e.group === 'C'; }).length, shown: want, list: pool.slice(0, want) };
  }
  function nextStage(s) { return STAGES[STAGES.indexOf(s) + 1]; }
  function proposals() {
    var out = [];
    D.jobs.forEach(function (j) {
      if (!hasCriteria(j.id)) return;
      shortlist(j.id).forEach(function (e) {
        var c = e.cand;
        if (e.group === 'A') {
          if (c.stage === 'Applied' || c.stage === 'Screening') {
            out.push({ id: c.id + ':move', job: j.id, cand: c.id, type: 'move', tool: 'recruiting_create_proposal', label: 'Changes something',
              text: 'Move ' + c.id + ' from ' + c.stage + ' to ' + nextStage(c.stage) + '.',
              basis: 'All ' + e.mustN + ' must-haves met, with proof lines.' });
          } else if (stalled(c)) {
            out.push({ id: c.id + ':remind', job: j.id, cand: c.id, type: 'remind', tool: 'recruiting_create_proposal', label: 'Sends a message',
              text: 'Remind the hiring manager about ' + c.id + ': ' + daysIn(c) + ' days in ' + c.stage + ' (target ' + D.sla[c.stage] + ').',
              basis: 'All ' + e.mustN + ' must-haves met. The candidate is waiting.' });
          }
        } else if (e.group === 'B') {
          var parts = e.res.filter(function (r) { return r.crit.must && r.status !== 'met'; }).map(function (r) {
            return (r.status === 'partly' ? 'is this enough for "' : 'is it acceptable that "') + r.crit.text + (r.status === 'partly' ? '"?' : '" is not met?') +
              (r.text ? ' (CV: "' + r.text + '")' : '');
          });
          out.push({ id: c.id + ':ask', job: j.id, cand: c.id, type: 'ask', tool: 'recruiting_create_proposal', label: 'Sends a message',
            text: 'Ask the hiring manager about ' + c.id + ': ' + parts.join(' ; '),
            basis: e.mustMet + ' of ' + e.mustN + ' must-haves met, ' + e.mustPartly + ' partly, ' + e.mustMissing + ' missing.' });
        }
      });
    });
    return out;
  }
  function funnel() {
    return STAGES.map(function (s) {
      var l = D.candidates.filter(function (c) { return c.stage === s; });
      return { stage: s, count: l.length, stalled: l.filter(stalled).length, sla: D.sla[s] };
    });
  }
  function stalledList() {
    return D.candidates.filter(stalled).sort(function (a, b) { return over(b) - over(a); });
  }
  function bestWaiting() {
    var best = null;
    D.jobs.forEach(function (j) {
      if (!hasCriteria(j.id)) return;
      shortlist(j.id).forEach(function (e) {
        if (e.group === 'A' && stalled(e.cand) && (!best || daysIn(e.cand) > daysIn(best.cand))) best = e;
      });
    });
    return best;
  }
  function brief() {
    var st = D.jobs.map(jobStatus);
    var late = st.filter(function (s) { return s.status === 'late'; });
    var st2 = stalledList();
    var best = bestWaiting();
    var offers = D.candidates.filter(function (c) { return c.stage === 'Offer'; });
    var pr = proposals();
    var items = [];
    items.push({ head: 'Late requisitions', text: late.length ? late.map(function (s) { return s.job.id + ' ' + s.job.title + ' (' + s.elapsed + ' of ' + s.job.target + ' days)'; }).join('; ') + '.' : 'None.' });
    items.push({ head: 'Waiting past target', text: st2.length + ' of ' + D.candidates.length + ' candidates have waited longer than the target for their stage. Longest: ' + (st2[0] ? st2[0].id + ', ' + over(st2[0]) + ' days over (' + st2[0].stage + ', ' + D.jobs.filter(function (j) { return j.id === st2[0].job; })[0].id + ')' : 'none') + '.' });
    items.push({ head: 'Best match waiting longest', text: best ? best.cand.id + ' for ' + best.cand.job + ' meets all ' + best.mustN + ' must-haves and has waited ' + daysIn(best.cand) + ' days in ' + best.cand.stage + ' (target ' + D.sla[best.cand.stage] + ').' : 'None.' });
    items.push({ head: 'Offers out', text: offers.map(function (c) { return c.id + ' (' + c.job + '): ' + daysIn(c) + ' days, target ' + D.sla.Offer + (stalled(c) ? ', over target' : ', within target'); }).join('; ') + '.' });
    items.push({ head: 'Waiting for your release', text: pr.length + ' proposals from Joule wait in Approvals. Nothing has been changed.' });
    return items;
  }
  return { STAGES: STAGES, job: job, cands: cands, daysIn: daysIn, over: over, stalled: stalled, baseline: baseline, acceptance: acceptance,
    jobStatus: jobStatus, evalCand: evalCand, hasCriteria: hasCriteria, shortlist: shortlist, topMatches: topMatches, proposals: proposals, funnel: funnel,
    stalledList: stalledList, bestWaiting: bestWaiting, brief: brief, daysBetween: daysBetween };
}
