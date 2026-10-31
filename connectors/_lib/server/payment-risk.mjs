/**
 * Late-payment forecast for the Sub4Me Invoices tab: which open invoices will probably be paid more than 14 days
 * after the due date. The numbers come from the TabPFN service (services/tabpfn); this module only fetches the
 * customer's invoices, sends them there and checks the answer. Read-only. Without a configured service the tool
 * says so — it never invents a forecast.
 */

export const PAYMENT_RISK_TOOL_DEFINITIONS = [
  {
    name: 'predict_late_payments',
    description:
      'Forecast which open Sub4Me invoices will probably be paid more than 14 days after their due date. Returns the late probability per open invoice (highest first) with the main drivers, and which model engine produced it (TabPFN or a fallback baseline). Trained on synthetic invoice history, so it demonstrates the method and is not a real credit assessment. Use it for questions such as "which invoices will be paid late?" or "where should we send a reminder first?". Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        customer: { type: 'string', description: 'Sub4Me customer id, for example "muster" or "hanse". Defaults to the primary customer.' },
      },
      additionalProperties: false,
    },
  },
];

const TIMEOUT_MS = 20000;
const RISKS = ['high', 'medium', 'low'];

/** The service URL must be https, or plain http on this machine. */
export function serviceUrl(raw) {
  if (!raw || !raw.trim()) return null;
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error('TABPFN_SERVICE_URL is not a valid URL');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new Error('TABPFN_SERVICE_URL must be https (or http on localhost)');
  return url;
}

const text = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');
const number = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** Keep only the fields the Space and the chat render; reject answers that do not look like the contract. */
export function checkForecast(body) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.items)) throw new Error('the forecast service returned an unexpected answer');
  return {
    asOf: text(body.asOf, 10),
    engine: text(body.engine, 20),
    engineNote: text(body.engineNote, 300),
    trainedOn: text(body.trainedOn, 80),
    lateMeansDaysAfterDue: number(body.lateMeansDaysAfterDue) ?? 14,
    customerHabit: body.customerHabit && typeof body.customerHabit === 'object'
      ? { avgDelayDays: number(body.customerHabit.avgDelayDays), lateShare: number(body.customerHabit.lateShare), paidInvoicesSeen: number(body.customerHabit.paidInvoicesSeen) }
      : null,
    items: body.items.slice(0, 200).filter((i) => i && typeof i === 'object').map((i) => ({
      id: text(i.id, 40),
      contractId: text(i.contractId, 40),
      grossEur: number(i.grossEur),
      due: text(i.due, 10),
      daysToDue: number(i.daysToDue),
      alreadyOverdue: i.alreadyOverdue === true,
      alreadyLate: i.alreadyLate === true,
      lateProbability: Math.min(1, Math.max(0, number(i.lateProbability) ?? 0)),
      risk: RISKS.includes(i.risk) ? i.risk : 'low',
      drivers: (Array.isArray(i.drivers) ? i.drivers : []).slice(0, 3).filter((d) => d && typeof d === 'object').map((d) => ({
        label: text(d.label, 60), value: typeof d.value === 'number' ? d.value : text(String(d.value ?? ''), 40), effectPct: number(d.effectPct) ?? 0,
      })),
    })),
  };
}

export function createPaymentRiskHandlers({ sub4me, ToolError, env = process.env, fetchImpl = fetch }) {
  return {
    async predict_late_payments(args = {}) {
      let url;
      try {
        url = serviceUrl(env.TABPFN_SERVICE_URL);
      } catch (error) {
        throw new ToolError(error.message);
      }
      if (!url) {
        throw new ToolError('The late-payment forecast service is not configured. Start services/tabpfn (see its README) and set TABPFN_SERVICE_URL, for example http://127.0.0.1:8808.');
      }
      const listed = await sub4me.list_invoices(args.customer === undefined ? {} : { customer: args.customer });
      const headers = { 'Content-Type': 'application/json' };
      if (env.TABPFN_SERVICE_TOKEN?.trim()) headers.Authorization = `Bearer ${env.TABPFN_SERVICE_TOKEN.trim()}`;

      let response;
      try {
        response = await fetchImpl(new URL('/predict/late-payment', url), {
          method: 'POST',
          headers,
          body: JSON.stringify({ customer: listed.customerId ?? args.customer ?? 'muster', as_of: listed.asOf, invoices: listed.invoices }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (error) {
        throw new ToolError(`The late-payment forecast service did not answer (${error.name === 'TimeoutError' ? 'timeout' : 'not reachable'}). Is services/tabpfn running?`);
      }
      if (!response.ok) throw new ToolError(`The late-payment forecast service answered HTTP ${response.status}.`);
      let forecast;
      try {
        forecast = checkForecast(await response.json());
      } catch (error) {
        throw new ToolError(error.message);
      }
      return {
        customer: listed.customer,
        ...forecast,
        highRisk: forecast.items.filter((i) => i.risk === 'high').length,
        invoiceSource: listed.source,
        disclaimer: 'Demo: trained on synthetic data, not a credit assessment.',
        view: { space: 'sub4me', tab: 'invoices' },
      };
    },
  };
}
