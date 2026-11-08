import { useMemo, useState } from 'react';
import controlTowerData from '../../examples/control-tower/data.json';
import infraOpsData from '../../examples/infra-ops/data.json';
import fleetData from '../../examples/it-fleet/fleet.json';
import renewalsData from '../../examples/renewals/renewals.json';
import salesData from '../../examples/sales/pipeline.json';
import { GRIR_ITEMS, classifyGrir } from '../../connectors/sap-mock/server/data.mjs';
import { IC_ITEMS } from '../../examples/databricks-demo/seed/data.mjs';
import { BRIEFING_CATEGORIES, categoryKey, buildBriefing, type BriefingCategoryId, type OpsBriefingData, type RenewalsBriefingData, type SalesBriefingData, type BriefingAction, type BriefingData } from '../briefing';

type Props = {
  disabled: boolean;
  /** Connector installed? The "ask" actions need it; opening a Space does not. */
  canAsk: boolean;
  /** Card ids and "cat:<group>" keys the person switched off in the settings. */
  hidden?: string[];
  onOpen: (target: { space: string; tab?: string }) => void;
  onAsk: (prompt: string, connector?: string) => void;
};

type GrirRow = { grValueEur: number; invoicedValueEur: number; sapLateInvoiceEur?: number; grOffset: number };
/** Figures for the close card, computed from the demo data (the same rows the lakehouse and the mock SAP use). */
function closeFigures() {
  const rows = GRIR_ITEMS as unknown as GrirRow[];
  const kind = (r: GrirRow) => classifyGrir(r) as string;
  const accrue = rows.filter((r) => kind(r) === 'ACCRUE');
  return {
    accrueCount: accrue.length,
    accrueEur: accrue.reduce((sum, r) => sum + r.grValueEur - r.invoicedValueEur, 0),
    staleCount: rows.filter((r) => kind(r) === 'STALE_REVIEW').length,
    icCount: IC_ITEMS.filter((i) => i.buyerAmountEur === null || Math.abs(i.sellerAmountEur - i.buyerAmountEur) > 0.001).length,
    sapDifferences: rows.filter((r) => (r.sapLateInvoiceEur ?? 0) > 0).length,
  };
}

/** Cards under the chat, in groups (AI, Sales, Renewals, Infrastruktur, Board): what needs attention, one click from the answer. */
export default function BriefingCards({ disabled, canAsk, hidden = [], onOpen, onAsk }: Props) {
  const all = useMemo(() => buildBriefing(controlTowerData as unknown as BriefingData, new Date(), {
    ops: { certs: (infraOpsData as { certs: OpsBriefingData['certs'] }).certs, fleet: fleetData as unknown as OpsBriefingData['fleet'] },
    sales: salesData as unknown as SalesBriefingData,
    renewals: renewalsData as unknown as RenewalsBriefingData,
    close: closeFigures(),
  }), []);
  const groups = BRIEFING_CATEGORIES
    .filter((c) => !hidden.includes(categoryKey(c.id)))
    .map((c) => ({ ...c, shown: all.filter((card) => card.category === c.id && !hidden.includes(card.id)) }))
    .filter((c) => c.shown.length > 0);
  const [picked, setPicked] = useState<BriefingCategoryId | null>(null);
  if (groups.length === 0) return null;
  const current = groups.find((g) => g.id === picked) ?? groups[0];

  const run = (action: BriefingAction) => {
    if (action.kind === 'open') onOpen({ space: action.space, tab: action.tab });
    else onAsk(action.prompt, action.connector);
  };

  return (
    <section className="briefing" aria-label="Heute für dich">
      <div className="briefing-head">
        <div className="briefing-title">Heute für dich</div>
        <div className="briefing-tabs" role="tablist" aria-label="Kategorien">
          {groups.map((g) => (
            <button key={g.id} role="tab" aria-selected={g.id === current.id} className={`briefing-tab ${g.id === current.id ? 'briefing-tab-on' : ''}`} onClick={() => setPicked(g.id)}>
              {g.title}
              <span className="briefing-count">{g.shown.length}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="briefing-grid" role="tabpanel">
        {current.shown.map((card) => (
          <article key={card.id} className={`briefing-card briefing-${card.tone}`}>
            <div className="briefing-area">{card.area}</div>
            <h3>{card.title}</h3>
            <p title={card.detail}>{card.detail}</p>
            <div className="briefing-actions">
              {card.actions.map((action) => (
                <button
                  key={action.label}
                  className="briefing-action"
                  disabled={action.kind === 'ask' && (disabled || !canAsk)}
                  onClick={() => run(action)}
                >
                  {action.label}
                </button>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
