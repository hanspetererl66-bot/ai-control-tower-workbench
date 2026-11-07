/**
 * The numbers of the Automation Dashboard: period figures with the change against the period before, the rules behind "Needs attention",
 * failures, duration, time saved, estimated model cost, capacity, schedules, app dependencies, builders and governance. Pure functions on
 * the embedded data (`D`, the shape `buildDashboardData` returns plus `D.settings`).
 * One source for two users: the Space page (embedded by `npm run sync:automation`, the page cannot import) and the tests.
 * The page and this file must never differ.
 * Honesty rules built in: a figure that n8n does not give us stays `null` (never 0), a period without a period before it has no change,
 * and the model cost is always an estimate from assumptions in settings.json, never a measurement.
 */
export function makeMetrics(D) {
  var W = D.workflows;
  var N = D.days.length;
  var S = D.settings || {};
  var LLM = S.llm || {};
  var TARGET = typeof S.successTargetPct === 'number' ? S.successTargetPct : 98;
  var RATE = typeof S.hourlyRateEur === 'number' ? S.hourlyRateEur : 65;
  var FALLBACK_CATEGORY = D.categories[D.categories.length - 1].name;
  var minPer = {};
  D.categories.forEach(function (c) { minPer[c.name] = c.minutesPerRun; });

  function pct(a, b) { return b ? Math.round((a / b) * 100) : null; }
  function round1(v) { return Math.round(v * 10) / 10; }
  function sum(list, pick) { return list.reduce(function (s, x) { return s + pick(x); }, 0); }
  function ms(s) { var p = s.slice(0, 10).split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
  function daysSince(iso) { return Math.round((ms(D.asOf) - ms(iso)) / 86400000); }
  function bounds(p, back) { var end = N - (back || 0); return [Math.max(0, end - p), end]; }
  /** Can the period before exist inside the window? 7 days can (7 + 7 <= 14), the whole window cannot. */
  function hasPrevious(p) { return p * 2 <= N; }

  /* ---------- sums over a period ---------- */
  function aggWorkflow(w, p, back) {
    var b = bounds(p, back), a = { runs: 0, ok: 0, bad: 0, other: 0, sec: 0, n: 0, minutes: 0 };
    for (var i = b[0]; i < b[1]; i++) {
      var d = w.daily[i];
      a.ok += d.success; a.bad += d.error; a.other += d.other; a.sec += d.sec || 0; a.n += d.n || 0;
    }
    a.runs = a.ok + a.bad + a.other;
    a.minutes = Math.round(a.ok * (minPer[w.category] != null ? minPer[w.category] : 0));
    a.rate = pct(a.ok, a.ok + a.bad);
    a.avg = a.n ? round1(a.sec / a.n) : null;
    return a;
  }
  function agg(list, p, back) {
    var t = { runs: 0, ok: 0, bad: 0, other: 0, sec: 0, n: 0, minutes: 0 };
    list.forEach(function (w) {
      var a = aggWorkflow(w, p, back);
      ['runs', 'ok', 'bad', 'other', 'sec', 'n', 'minutes'].forEach(function (k) { t[k] += a[k]; });
    });
    t.rate = pct(t.ok, t.ok + t.bad);
    t.avg = t.n ? round1(t.sec / t.n) : null;
    return t;
  }
  /** One value per day of the period (for the small trend lines). */
  function series(list, p, pick) {
    var b = bounds(p, 0), out = [];
    for (var i = b[0]; i < b[1]; i++) {
      var t = { ok: 0, bad: 0, other: 0, sec: 0, n: 0, minutes: 0 };
      list.forEach(function (w) {
        var d = w.daily[i];
        t.ok += d.success; t.bad += d.error; t.other += d.other; t.sec += d.sec || 0; t.n += d.n || 0;
        t.minutes += d.success * (minPer[w.category] != null ? minPer[w.category] : 0);
      });
      t.runs = t.ok + t.bad + t.other;
      t.rate = pct(t.ok, t.ok + t.bad);
      t.avg = t.n ? round1(t.sec / t.n) : null;
      out.push(pick(t));
    }
    return out;
  }

  /* ---------- change against the period before ---------- */
  /** polarity: 'up' = more is better, 'down' = more is worse, 'none' = neither. Small moves count as flat. */
  function change(cur, prev, polarity, unit) {
    if (cur === null || cur === undefined || prev === null || prev === undefined) return null;
    var diff = unit === 'pp' ? cur - prev : prev === 0 ? (cur === 0 ? 0 : null) : ((cur - prev) / prev) * 100;
    if (diff === null) return { value: null, dir: 'up', tone: 'flat' }; // from nothing: no percentage
    var limit = unit === 'pp' ? 1 : 3;
    var dir = Math.abs(diff) < limit ? 'flat' : diff > 0 ? 'up' : 'down';
    var tone = dir === 'flat' || polarity === 'none' ? 'flat' : (dir === 'up') === (polarity === 'up') ? 'good' : 'bad';
    return { value: Math.round(diff * 10) / 10, dir: dir, tone: tone, unit: unit };
  }

  function kpis(p) {
    var cur = agg(W, p, 0), prev = hasPrevious(p) ? agg(W, p, p) : null;
    var activeNow = W.filter(function (w) { return w.active; });
    var silent = activeNow.filter(function (w) { return w.trigger !== 'Manual' && aggWorkflow(w, Math.min(7, N), 0).runs === 0; });
    return {
      period: p,
      hasPrevious: !!prev,
      active: { value: activeNow.length, total: W.length, silent: silent.length },
      executions: { value: cur.runs, change: prev && change(cur.runs, prev.runs, 'none', '%'), spark: series(W, p, function (t) { return t.runs; }) },
      rate: { value: cur.rate, ok: cur.ok, bad: cur.bad, target: TARGET, change: prev && change(cur.rate, prev.rate, 'up', 'pp'), spark: series(W, p, function (t) { return t.rate; }) },
      failed: { value: cur.bad, change: prev && change(cur.bad, prev.bad, 'down', '%'), spark: series(W, p, function (t) { return t.bad; }) },
      duration: { value: cur.avg, change: prev && change(cur.avg, prev.avg, 'down', '%'), spark: series(W, p, function (t) { return t.avg; }) },
      saved: { minutes: cur.minutes, hours: round1(cur.minutes / 60), eur: Math.round((cur.minutes / 60) * RATE), change: prev && change(cur.minutes, prev.minutes, 'up', '%'), spark: series(W, p, function (t) { return t.minutes; }) },
    };
  }

  /* ---------- needs attention ---------- */
  function attention(p, limit) {
    var items = [];
    W.forEach(function (w) {
      var a = aggWorkflow(w, p, 0), week = aggWorkflow(w, Math.min(7, N), 0);
      if (w.errorStreak >= 3 && w.executions > 0) items.push({ key: 'streak', severity: 3, id: w.id, title: w.name, detail: 'Failed ' + w.errorStreak + ' runs in a row', score: w.errorStreak });
      else if (a.ok + a.bad >= 10 && a.rate !== null && a.rate < TARGET && a.bad >= 3) items.push({ key: 'target', severity: 2, id: w.id, title: w.name, detail: 'Success rate ' + a.rate + '%, target ' + TARGET + '%', score: TARGET - a.rate });
      else if (w.active && w.trigger !== 'Manual' && week.runs === 0) items.push({ key: 'silent', severity: 1, id: w.id, title: w.name, detail: 'Active, but no runs in the last ' + Math.min(7, N) + ' days', score: 0 });
    });
    items.sort(function (a, b) { return b.severity - a.severity || b.score - a.score || a.title.localeCompare(b.title); });
    return { items: items.slice(0, limit || 3), total: items.length };
  }

  /* ---------- rankings and breakdowns ---------- */
  function top(p, pick, n) {
    return W.map(function (w) { return { w: w, v: pick(aggWorkflow(w, p, 0), w) }; })
      .filter(function (x) { return x.v > 0; })
      .sort(function (a, b) { return b.v - a.v || a.w.name.localeCompare(b.w.name); })
      .slice(0, n || 5);
  }
  function rankings(p) {
    return {
      runs: top(p, function (a) { return a.runs; }),
      errors: top(p, function (a) { return a.bad; }),
      saved: top(p, function (a) { return a.minutes; }),
    };
  }
  function group(list, keyOf, p) {
    var map = {}, order = [];
    list.forEach(function (w) {
      var k = keyOf(w);
      if (!map[k]) { map[k] = { key: k, workflows: [], active: 0 }; order.push(k); }
      map[k].workflows.push(w);
      if (w.active) map[k].active += 1;
    });
    return order.map(function (k) {
      var g = map[k], a = agg(g.workflows, p, 0);
      return { key: k, count: g.workflows.length, active: g.active, runs: a.runs, ok: a.ok, bad: a.bad, rate: a.rate, minutes: a.minutes, workflows: g.workflows };
    });
  }
  function byTrigger(p) {
    return group(W, function (w) { return w.trigger; }, p).sort(function (a, b) { return b.runs - a.runs || b.count - a.count; });
  }
  function activeDetail(p) {
    var week = Math.min(7, N);
    var silent = W.filter(function (w) { return w.active && w.trigger !== 'Manual' && aggWorkflow(w, week, 0).runs === 0; });
    return {
      active: W.filter(function (w) { return w.active; }),
      inactive: W.filter(function (w) { return !w.active; }),
      silent: silent,
      silentDays: week,
      triggers: byTrigger(p),
    };
  }
  function executionsDetail(p) {
    var total = agg(W, p, 0).runs;
    return {
      total: total,
      byWorkflow: top(p, function (a) { return a.runs; }, 10).map(function (x) { return { w: x.w, runs: x.v, share: pct(x.v, total) }; }),
      byTrigger: byTrigger(p),
      byCategory: group(W, function (w) { return w.category; }, p).filter(function (g) { return g.runs > 0; }).sort(function (a, b) { return b.runs - a.runs; }),
      waiting: D.executions.filter(function (e) { return e.status === 'running'; }),
    };
  }
  function successDetail(p) {
    var rows = W.map(function (w) { var a = aggWorkflow(w, p, 0); return { w: w, runs: a.ok + a.bad, ok: a.ok, bad: a.bad, rate: a.rate }; })
      .filter(function (r) { return r.runs > 0; })
      .sort(function (a, b) { return a.rate - b.rate || b.bad - a.bad; });
    return { target: TARGET, rows: rows, below: rows.filter(function (r) { return r.rate < TARGET; }).length, perDay: series(W, p, function (t) { return t.rate; }) };
  }
  function failedDetail(p) {
    var rows = W.map(function (w) { var a = aggWorkflow(w, p, 0); return { w: w, bad: a.bad, runs: a.ok + a.bad, rate: pct(a.bad, a.ok + a.bad), streak: w.errorStreak, lastErrorAt: w.lastErrorAt, lastSuccessAt: w.lastSuccessAt }; })
      .filter(function (r) { return r.bad > 0; })
      .sort(function (a, b) { return b.streak - a.streak || b.bad - a.bad || a.w.name.localeCompare(b.w.name); });
    return { rows: rows, total: sum(rows, function (r) { return r.bad; }), perDay: series(W, p, function (t) { return t.bad; }) };
  }
  /** Which apps the failing workflows share. A hint where to look first, not a cause: n8n gives us no error text here. */
  function suspectApps(p) {
    var failing = failedDetail(p).rows, map = {};
    failing.forEach(function (r) {
      r.w.apps.forEach(function (app) {
        if (!map[app]) map[app] = { app: app, workflows: 0, errors: 0 };
        map[app].workflows += 1; map[app].errors += r.bad;
      });
    });
    return Object.keys(map).map(function (k) { return map[k]; })
      .sort(function (a, b) { return b.workflows - a.workflows || b.errors - a.errors || a.app.localeCompare(b.app); })
      .map(function (x) { return { app: x.app, workflows: x.workflows, errors: x.errors, shareOfFailing: pct(x.workflows, failing.length) }; });
  }
  function durationDetail() {
    var edges = D.durationEdges || [], buckets = Array(edges.length + 1).fill(0);
    W.forEach(function (w) { (w.buckets || []).forEach(function (n, i) { buckets[i] += n; }); });
    var labels = buckets.map(function (_n, i) { return i === 0 ? '< ' + edges[0] + ' s' : i < edges.length ? edges[i - 1] + '–' + edges[i] + ' s' : '> ' + edges[edges.length - 1] + ' s'; });
    var slow = W.filter(function (w) { return w.avgSeconds !== null && w.executions >= 3; });
    return {
      p50: D.stats ? D.stats.p50Seconds : null,
      p95: D.stats ? D.stats.p95Seconds : null,
      buckets: buckets, labels: labels,
      slowest: slow.slice().sort(function (a, b) { return b.avgSeconds - a.avgSeconds; }).slice(0, 8),
      perDay: series(W, N, function (t) { return t.avg; }),
    };
  }
  function savedDetail(p) {
    var rows = group(W, function (w) { return w.category; }, p).filter(function (g) { return g.ok > 0; })
      .map(function (g) { return { name: g.key, ok: g.ok, perRun: minPer[g.key], minutes: g.minutes, workflows: g.count }; })
      .sort(function (a, b) { return b.minutes - a.minutes; });
    var total = sum(rows, function (r) { return r.minutes; });
    var cost = llm(p).total;
    return { rows: rows, minutes: total, hours: round1(total / 60), rate: RATE, eur: Math.round((total / 60) * RATE), llmCost: cost, net: Math.round((total / 60) * RATE - cost), perDay: series(W, p, function (t) { return t.minutes; }) };
  }

  /* ---------- estimated model cost ---------- */
  function price(provider) {
    var table = LLM.pricePer1MTokensEur || {};
    return table[provider] || table.Other || { input: 2, output: 8 };
  }
  /** runs x model nodes x assumed tokens x assumed price per provider. An estimate: n8n gives no token counts in this data. */
  function llm(p) {
    var tin = (LLM.tokensPerCall && LLM.tokensPerCall.input) || 2500, tout = (LLM.tokensPerCall && LLM.tokensPerCall.output) || 600;
    var rows = W.filter(function (w) { return w.llm && w.llm.calls > 0; }).map(function (w) {
      var a = aggWorkflow(w, p, 0), calls = a.runs * w.llm.calls;
      var per = w.llm.providers.length ? sum(w.llm.providers, function (pr) { var pp = price(pr); return (tin * pp.input + tout * pp.output) / 1e6; }) / w.llm.providers.length : 0;
      var cost = calls * per;
      var spike = (function () {
        var recent = 0, before = 0, k = Math.min(3, N - 1);
        for (var i = N - k; i < N; i++) recent += w.daily[i].success + w.daily[i].error + w.daily[i].other;
        for (var j = 0; j < N - k; j++) before += w.daily[j].success + w.daily[j].error + w.daily[j].other;
        var r = recent / k, b = before / (N - k);
        return b > 0 ? r > b * 2 && r - b >= 3 : r >= 5;
      })();
      return { w: w, runs: a.runs, modelNodes: w.llm.calls, providers: w.llm.providers, calls: calls, tokensIn: calls * tin, tokensOut: calls * tout, cost: cost, minutes: a.minutes, spike: spike };
    }).sort(function (a, b) { return b.cost - a.cost || a.w.name.localeCompare(b.w.name); });
    var total = sum(rows, function (r) { return r.cost; });
    var runsAll = agg(W, p, 0).runs, llmRuns = sum(rows, function (r) { return r.runs; });
    var projected = (total / p) * 30;
    var budget = typeof LLM.monthlyBudgetEur === 'number' ? { monthly: LLM.monthlyBudgetEur, usedPct: Math.round((projected / LLM.monthlyBudgetEur) * 100) } : null;
    var providers = {};
    rows.forEach(function (r) {
      r.providers.forEach(function (pr) {
        if (!providers[pr]) providers[pr] = { provider: pr, workflows: 0, calls: 0, cost: 0 };
        providers[pr].workflows += 1; providers[pr].calls += r.calls / r.providers.length; providers[pr].cost += r.cost / r.providers.length;
      });
    });
    return {
      assumptions: { tokensIn: tin, tokensOut: tout, prices: LLM.pricePer1MTokensEur || {}, budget: budget && budget.monthly },
      rows: rows,
      total: total,
      projected: projected,
      budget: budget,
      perRun: llmRuns ? total / llmRuns : null,
      llmShareOfRuns: pct(llmRuns, runsAll),
      hoursSaved: round1(sum(rows, function (r) { return r.minutes; }) / 60),
      byProvider: Object.keys(providers).map(function (k) { return providers[k]; }).sort(function (a, b) { return b.cost - a.cost; }),
      byCategory: group(rows.map(function (r) { return r.w; }), function (w) { return w.category; }, p).map(function (g) {
        return { key: g.key, workflows: g.count, cost: sum(rows.filter(function (r) { return r.w.category === g.key; }), function (r) { return r.cost; }) };
      }).sort(function (a, b) { return b.cost - a.cost; }),
      byProject: group(rows.map(function (r) { return r.w; }), function (w) { return w.project || ''; }, p).map(function (g) {
        return { key: g.key, workflows: g.count, cost: sum(rows.filter(function (r) { return (r.w.project || '') === g.key; }), function (r) { return r.cost; }) };
      }).sort(function (a, b) { return b.cost - a.cost; }),
    };
  }
  function costOf(w, p) {
    var r = llm(p).rows.filter(function (x) { return x.w.id === w.id; })[0];
    return r ? r.cost : 0;
  }

  /* ---------- capacity ---------- */
  function heatPeak(kind) {
    var grid = D.heat[kind], best = { weekday: 0, hour: 0, value: 0 };
    grid.forEach(function (row, d) { row.forEach(function (v, h) { if (v > best.value) best = { weekday: d, hour: h, value: v }; }); });
    return best;
  }
  function capacity(p) {
    var cur = agg(W, p, 0), perDay = cur.runs / p, plan = S.plan && typeof S.plan.executionsPerMonth === 'number' ? S.plan.executionsPerMonth : null;
    var projected = Math.round(perDay * 30);
    var topFive = top(p, function (a) { return a.runs; }, 5);
    var days = D.days.slice(-p), perDayRuns = series(W, p, function (t) { return t.runs; });
    var busiest = perDayRuns.reduce(function (b, v, i) { return v > b.runs ? { date: days[i].date, runs: v } : b; }, { date: '', runs: 0 });
    return {
      runs: cur.runs, perDay: Math.round(perDay), projected: projected, plan: plan,
      usedPct: plan ? Math.round((projected / plan) * 100) : null,
      peak: heatPeak('runs'), busiest: busiest,
      topFive: topFive.map(function (x) { return { w: x.w, runs: x.v, share: pct(x.v, cur.runs) }; }),
      topShare: pct(sum(topFive, function (x) { return x.v; }), cur.runs),
      runSeconds: series(W, p, function (t) { return t.sec; }),
      perDaySeries: perDayRuns,
      longest: D.executions.filter(function (e) { return e.seconds !== null; }).slice().sort(function (a, b) { return b.seconds - a.seconds; }).slice(0, 5),
    };
  }

  /* ---------- schedules ---------- */
  function schedules(p) {
    var list = W.filter(function (w) { return w.trigger === 'Schedule'; });
    var hours = Array(24).fill(0);
    list.forEach(function (w) { (w.hours || []).forEach(function (n, h) { hours[h] += n; }); });
    var total = sum(hours, function (n) { return n; }), peak = hours.reduce(function (b, n, h) { return n > b.n ? { hour: h, n: n } : b; }, { hour: 0, n: 0 });
    return {
      workflows: list.map(function (w) { var a = aggWorkflow(w, p, 0); return { w: w, perDay: round1(a.runs / p), runs: a.runs, rate: pct(a.ok, a.ok + a.bad), avg: a.n ? round1(a.sec / a.n) : null }; })
        .sort(function (a, b) { return b.perDay - a.perDay || a.w.name.localeCompare(b.w.name); }),
      hours: hours, total: total, peak: peak, peakShare: pct(peak.n, total),
      triggers: byTrigger(p),
    };
  }

  /* ---------- app dependencies ---------- */
  function connections(p) {
    var map = {};
    W.forEach(function (w) {
      var a = aggWorkflow(w, p, 0);
      w.apps.forEach(function (app) {
        if (!map[app]) map[app] = { app: app, workflows: [], active: 0, runs: 0, ok: 0, bad: 0 };
        var m = map[app];
        m.workflows.push(w); if (w.active) m.active += 1; m.runs += a.runs; m.ok += a.ok; m.bad += a.bad;
      });
    });
    return Object.keys(map).map(function (k) {
      var m = map[k];
      return { app: m.app, count: m.workflows.length, active: m.active, runs: m.runs, bad: m.bad, rate: pct(m.ok, m.ok + m.bad), failing: m.workflows.filter(function (w) { return aggWorkflow(w, p, 0).bad > 0; }).length, workflows: m.workflows };
    }).sort(function (a, b) { return b.count - a.count || b.runs - a.runs || a.app.localeCompare(b.app); });
  }

  /* ---------- builders and projects ---------- */
  function builders(p) {
    var rows = group(W, function (w) { return w.project || ''; }, p).map(function (g) {
      var owners = {};
      g.workflows.forEach(function (w) { if (w.owner) owners[w.owner] = true; });
      var created = g.workflows.map(function (w) { return w.createdAt; }).filter(Boolean).sort();
      return {
        project: g.key || null, count: g.count, active: g.active,
        builders: D.peopleIncluded ? Object.keys(owners).length : null,
        withOwner: g.workflows.filter(function (w) { return w.hasOwner; }).length,
        runs: g.runs, rate: g.rate, minutes: g.minutes,
        cost: sum(g.workflows, function (w) { return costOf(w, p); }),
        newest: created.length ? created[created.length - 1] : null,
        workflows: g.workflows,
      };
    }).sort(function (a, b) { return (a.project === null) - (b.project === null) || a.project && a.project.localeCompare(b.project); });
    var people = null, matrix = null;
    if (D.peopleIncluded) {
      var persons = group(W.filter(function (w) { return w.owner; }), function (w) { return w.owner; }, p).map(function (g) {
        var projects = {};
        g.workflows.forEach(function (w) { projects[w.project || '(no project)'] = (projects[w.project || '(no project)'] || 0) + 1; });
        return { owner: g.key, count: g.count, active: g.active, runs: g.runs, rate: g.rate, minutes: g.minutes, cost: sum(g.workflows, function (w) { return costOf(w, p); }), projects: projects };
      }).sort(function (a, b) { return a.owner.localeCompare(b.owner); }); // alphabetical on purpose: no ranking of people
      people = persons;
      var cols = {};
      persons.forEach(function (x) { Object.keys(x.projects).forEach(function (k) { cols[k] = true; }); });
      matrix = { projects: Object.keys(cols).sort(), rows: persons.map(function (x) { return { owner: x.owner, cells: x.projects }; }) };
    }
    var weeks = [], end = ms(D.asOf) + 86400000;
    for (var i = 7; i >= 0; i--) weeks.push({ from: end - (i + 1) * 7 * 86400000, to: end - i * 7 * 86400000, count: 0 });
    var dated = W.filter(function (w) { return w.createdAt; });
    dated.forEach(function (w) { var t = Date.parse(w.createdAt); weeks.forEach(function (wk) { if (t >= wk.from && t < wk.to) wk.count += 1; }); });
    return { projects: rows, people: people, matrix: matrix, newPerWeek: dated.length ? weeks.map(function (wk) { return { from: new Date(wk.from).toISOString().slice(0, 10), count: wk.count }; }) : null, withoutOwner: W.filter(function (w) { return !w.hasOwner; }).length };
  }

  /* ---------- governance ---------- */
  var REVIEW_DAYS = 180;
  function governance() {
    var rows = W.map(function (w) {
      var recent = aggWorkflow(w, N, 0).runs > 0;
      var checks = [
        { key: 'owner', label: 'Owner', ok: w.hasOwner },
        { key: 'project', label: 'Project', ok: w.project !== null },
        { key: 'errorWorkflow', label: 'Error workflow', ok: w.errorWorkflow }, // null = unknown, left out of the score
        { key: 'category', label: 'Category', ok: w.category !== FALLBACK_CATEGORY },
        { key: 'reviewed', label: 'Reviewed in ' + REVIEW_DAYS + ' days', ok: w.reviewedAt !== null && daysSince(w.reviewedAt) <= REVIEW_DAYS },
        { key: 'running', label: 'Runs in the window', ok: w.active ? recent : null }, // an inactive workflow is not expected to run
      ];
      var known = checks.filter(function (c) { return c.ok !== null; });
      var passed = known.filter(function (c) { return c.ok; }).length;
      return { w: w, checks: checks, passed: passed, of: known.length, score: known.length ? Math.round((passed / known.length) * 100) : null, idleDays: !w.active && w.updatedAt ? daysSince(w.updatedAt) : null };
    }).sort(function (a, b) { return a.score - b.score || a.w.name.localeCompare(b.w.name); });
    function share(key) {
      var known = rows.filter(function (r) { return r.checks.filter(function (c) { return c.key === key; })[0].ok !== null; });
      var ok = known.filter(function (r) { return r.checks.filter(function (c) { return c.key === key; })[0].ok; }).length;
      return { ok: ok, of: known.length, pct: pct(ok, known.length) };
    }
    return {
      rows: rows,
      owner: share('owner'), project: share('project'), errorWorkflow: share('errorWorkflow'), reviewed: share('reviewed'),
      needWork: rows.filter(function (r) { return r.score !== null && r.score < 100; }).length,
      reviewDays: REVIEW_DAYS,
    };
  }

  /* ---------- when it runs ---------- */
  function heatmap(kind) {
    var grid = D.heat[kind], max = 0;
    grid.forEach(function (row) { row.forEach(function (v) { if (v > max) max = v; }); });
    return { grid: grid, max: max, peak: heatPeak(kind), total: sum(grid, function (row) { return sum(row, function (v) { return v; }); }) };
  }

  return {
    target: TARGET, rate: RATE, hasPrevious: hasPrevious,
    agg: agg, aggWorkflow: aggWorkflow, series: series, change: change, kpis: kpis, attention: attention, rankings: rankings,
    byTrigger: byTrigger, activeDetail: activeDetail, executionsDetail: executionsDetail, successDetail: successDetail, failedDetail: failedDetail,
    suspectApps: suspectApps, durationDetail: durationDetail, savedDetail: savedDetail, llm: llm, capacity: capacity, schedules: schedules,
    connections: connections, builders: builders, governance: governance, heatmap: heatmap,
  };
}
