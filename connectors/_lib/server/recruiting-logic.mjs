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
  // ---------- Job posting (step before the process): fill a template from the requisition, check it, prepare one text per channel ----------
  // Joule drafts and prepares; it never publishes. Locked sections of the standard template (company text, equal-opportunity text) stay
  // word for word. Pay is never filled in by Joule: if the person leaves it empty, the posting is flagged.
  var POSTING_GENDER = /\((?:m\/f\/d|m\/w\/d|f\/m\/d|w\/m\/d|all genders|gn)\)/i;
  var POSTING_TRAITS = /\b(age|aged|young|younger|older|gender|sex|sexual|nationality|ethnicity|ethnic|religion|religious|marital|married|pregnant|pregnancy|disability|photo|born|alter|geschlecht|staatsangeh\w*|familienstand|schwanger\w*|behinderung|digital natives?|junges team|young team)\b/i;
  var POSTING_HOLES = /\{\{\s*([a-z_]+)\s*\}\}/g;
  function bullets(list) { return list.map(function (t) { return '• ' + t; }).join('\n'); }
  function companyName() { return String((D.company || '')).replace(/\s*\(fictional\)\s*/i, '').trim() || 'Our company'; }
  /** What a requisition already says: title, department, place, team, and its criteria as bullet lists. */
  function postingBrief(jobId) {
    var j = job(jobId), cr = (D.criteria && D.criteria[jobId]) || [];
    var extra = ((D.posting && D.posting.briefs) || {})[jobId] || {};
    return { job: j ? j.id : '', title: j ? j.title : '', dept: j ? j.dept : '', location: j ? j.location : '', team: j ? j.manager : '',
      role: extra.role || '', must: cr.filter(function (c) { return c.must; }).map(function (c) { return c.text; }),
      nice: cr.filter(function (c) { return !c.must; }).map(function (c) { return c.text; }), pay: '' };
  }
  function templateById(id) { return ((D.posting && D.posting.templates) || []).filter(function (t) { return t.id === id; })[0]; }
  function fillText(text, b) {
    var vals = { company: companyName(), title: b.title, dept: b.dept, location: b.location, team: b.team, role: b.role,
      must: b.must && b.must.length ? bullets(b.must) : '', nice: b.nice && b.nice.length ? bullets(b.nice) : '', pay: b.pay };
    return text.replace(POSTING_HOLES, function (all, k) { return k === 'apply' ? all : (vals[k] ? vals[k] : all); });
  }
  /** A draft from a template: every {{field}} the brief can fill is filled; what it cannot fill stays visible as {{field}}. */
  function draftPosting(tpl, b) {
    return { job: b.job || '', template: tpl.id, sections: tpl.sections.map(function (s) {
      return { key: s.key, label: s.label, locked: !!s.locked, text: fillText(s.text, b) };
    }) };
  }
  function lintPosting(post, tpl) {
    var f = [];
    var t = post.sections.filter(function (s) { return s.key === 'title'; })[0];
    if (!t || !t.text.trim()) f.push({ level: 'error', key: 'title', msg: 'The posting needs a title.' });
    else if (!POSTING_GENDER.test(t.text)) f.push({ level: 'error', key: 'title', msg: 'The title needs a gender-neutral marker such as (m/f/d).' });
    post.sections.forEach(function (s) {
      var holes = []; s.text.replace(POSTING_HOLES, function (all, k) { if (k !== 'apply') holes.push(k); return all; });
      if (holes.length) f.push({ level: 'error', key: s.key, msg: '“' + s.label + '” still has an empty field: ' + holes.map(function (h) { return '{{' + h + '}}'; }).join(', ') + '.' });
      if (!s.locked && POSTING_TRAITS.test(s.text)) f.push({ level: 'error', key: s.key, msg: '“' + s.label + '” names a personal trait (' + s.text.match(POSTING_TRAITS)[0] + '). Describe the work and the skills instead.' });
      if (s.key === 'pay' && !s.text.trim()) f.push({ level: 'warn', key: s.key, msg: 'No pay range. Check whether your country or your company requires one in the posting.' });
      if (s.text.length > 2500) f.push({ level: 'warn', key: s.key, msg: '“' + s.label + '” is long (' + s.text.length + ' characters). Short sections are read more often.' });
    });
    if (tpl) tpl.sections.forEach(function (ts) {
      if (!ts.locked) return;
      var s = post.sections.filter(function (x) { return x.key === ts.key; })[0];
      if (!s || s.text !== fillText(ts.text, { title: '', dept: '', location: '', team: '', role: '', must: [], nice: [], pay: '' })) f.push({ level: 'error', key: ts.key, msg: '“' + ts.label + '” is a locked section of the standard template and has been changed.' });
    });
    return f;
  }
  /** A finished posting back into a template: what came from the brief becomes {{field}} again, so the template works for the next job. */
  function templatize(sections, b) {
    var pairs = [];
    if (b.must && b.must.length) pairs.push([bullets(b.must), '{{must}}']);
    if (b.nice && b.nice.length) pairs.push([bullets(b.nice), '{{nice}}']);
    [['role', 'role'], ['team', 'team'], ['location', 'location'], ['dept', 'dept'], ['title', 'title'], ['pay', 'pay']].forEach(function (k) { if (b[k[0]]) pairs.push([b[k[0]], '{{' + k[1] + '}}']); });
    pairs.push([companyName(), '{{company}}']);
    return sections.map(function (s) {
      var t = s.text;
      pairs.forEach(function (p) { t = t.split(p[0]).join(p[1]); });
      return { key: s.key, label: s.label, locked: !!s.locked, text: t };
    });
  }
  /** One text per channel. A short channel gets title, place, three must-haves and the link; a full channel gets the whole posting. */
  function channelPackage(post, ch, jobId) {
    var link = ((D.posting && D.posting.apply) || '') + (jobId || post.job || 'new') + '?src=' + encodeURIComponent(ch.id);
    var get = function (k) { var s = post.sections.filter(function (x) { return x.key === k; })[0]; return s ? s.text : ''; };
    var text;
    if (ch.format === 'short') {
      var must = get('must').split('\n').filter(function (l) { return l.indexOf('•') === 0; }).slice(0, 3).join('\n');
      text = get('title') + '\n' + must + '\nApply: ' + link;
    } else {
      text = post.sections.map(function (s) { return s.key === 'title' ? s.text : s.label + '\n' + s.text; }).join('\n\n').replace(/\{\{\s*apply\s*\}\}/g, link);
    }
    return { channel: ch.id, name: ch.name, source: ch.source, text: text, length: text.length, limit: ch.limit, fits: text.length <= ch.limit, link: link };
  }
  /** What stands between a draft and "publish": the person's release, a clean check, a chosen channel, a text that fits. */
  function publishReady(post, tpl, channelIds, released, jobId) {
    var why = [];
    if (lintPosting(post, tpl).some(function (x) { return x.level === 'error'; })) why.push('The check still has errors.');
    if (!released) why.push('The hiring manager has not released the posting.');
    if (!channelIds.length) why.push('No channel is selected.');
    (D.posting.channels || []).filter(function (c) { return channelIds.indexOf(c.id) >= 0; }).forEach(function (c) {
      var p = channelPackage(post, c, jobId); if (!p.fits) why.push(c.name + ': the text is ' + (p.length - p.limit) + ' characters too long.');
    });
    return { ok: !why.length, why: why };
  }
  return { STAGES: STAGES, job: job, postingBrief: postingBrief, templateById: templateById, fillText: fillText, draftPosting: draftPosting, templatize: templatize, lintPosting: lintPosting, channelPackage: channelPackage, publishReady: publishReady, companyName: companyName, cands: cands, daysIn: daysIn, over: over, stalled: stalled, baseline: baseline, acceptance: acceptance,
    jobStatus: jobStatus, evalCand: evalCand, hasCriteria: hasCriteria, shortlist: shortlist, topMatches: topMatches, proposals: proposals, funnel: funnel,
    stalledList: stalledList, bestWaiting: bestWaiting, brief: brief, daysBetween: daysBetween };
}
