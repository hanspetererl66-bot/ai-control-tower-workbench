/**
 * Renewals Space: three more customers, so the demo shows a portfolio and not three accounts (illustrative, not in the Sub4Me sample data).
 * Each one tells a story; the health, the signals and the next actions are still calculated on the page from the facts below.
 *  - Alpenwerke Maschinenbau AG: the sponsor and expansion customer (a second plant, usage rising, the CIO is a fan).
 *  - Rheinberg Energie GmbH: the stressed customer (executive escalation, a very high ticket, an automatic renewal with a price rise
 *    above the cap and a competitor, low adoption, an overdue invoice).
 *  - Seeland Retail Group AG: the win-back and the race against the clock (a lapsed contract, a renewal in two weeks without an offer,
 *    falling usage after the peak season).
 * Same shape as the cases built from the Sub4Me data in sync-renewals.mjs. All names, numbers and IDs are invented.
 */
const TERMINATION = 'Ends on the end date; renewal requires a new order.';
const AUTO_TERMINATION = 'Renews for 12 months at the then current price unless terminated 90 days before the end.';

export const EXTRA_CUSTOMERS = [
  {
    id: 'alpenwerke', name: 'Alpenwerke Maschinenbau AG', sapCustomerId: '0010090611', since: 2014,
    owner: 'Katrin Vogel', csm: 'Lukas Brandt', customerOwner: 'Dr. Markus Hauser',
    escalation: null,
    topics: [
      { kind: 'commercial', text: 'Plans a second plant in Austria in 2027 and wants to extend S/4HANA to it' },
      { kind: 'people', text: 'New CIO since 2025, a strong SAP sponsor who asked for a three-year roadmap' },
    ],
    mails: [
      { id: 'A-201', subject: 'S/4HANA renewal: extension for the Austrian plant', status: 'waiting-us', intent: 'Renewal', mood: 'positive', contractId: 'C-2025-0710', offerId: 'OFF-2026-0610', side: 'customer', at: '2026-10-16T09:20:00+02:00', count: 3, snippet: 'The CIO would like to include the Austrian plant from 2027. Please send us the extended scope and a price for 4,600 users.' },
      { id: 'A-202', subject: 'Signavio: who owns the process model after the reorganisation?', status: 'waiting-customer', intent: 'Renewal', mood: 'neutral', contractId: 'C-2024-0455', offerId: null, side: 'us', at: '2026-10-12T14:10:00+02:00', count: 2, snippet: 'We asked for the new owner of the process models so the renewal talk can start with the right person.' },
      { id: 'A-203', subject: 'Business Network: 60 more suppliers onboarded', status: 'answered', intent: 'Offer', mood: 'positive', contractId: 'C-2025-0731', offerId: null, side: 'customer', at: '2026-10-08T11:45:00+02:00', count: 2, snippet: 'Thank you, the onboarding of the next 60 suppliers worked without problems. Procurement is very happy.' },
    ],
    contracts: [
      { id: 'C-2025-0710', product: 'SAP S/4HANA Cloud, private edition', status: 'Running', end: '2027-03-31', noticeDays: 90, autoRenew: false, annualEur: 520000, upliftCapPct: 3, termination: 'Ends on the end date unless renewed in writing 90 days before.', used: 3880, licensed: 4000, unit: 'users',
        offer: { id: 'OFF-2026-0610', annualEur: 535600, currentAnnualEur: 520000, discountPct: 0, validUntil: '2026-12-10', stage: 'Negotiation', probabilityPct: 80, competitor: 'None', nextStep: 'Agree the scope for the Austrian plant with the CIO by 2026-11-13', termMonths: 36, priceGuaranteeMonths: 36, approval: 'Deal desk approved' } },
      { id: 'C-2024-0455', product: 'SAP Signavio Process Transformation Suite', status: 'Running', end: '2027-02-28', noticeDays: 60, autoRenew: false, annualEur: 98000, upliftCapPct: 3, termination: TERMINATION, used: 61, licensed: 75, unit: 'seats' },
      { id: 'C-2025-0731', product: 'SAP Business Network (Ariba)', status: 'Running', end: '2027-09-30', noticeDays: 90, autoRenew: false, annualEur: 142000, upliftCapPct: 3, termination: TERMINATION, used: 940, licensed: 1000, unit: 'suppliers' },
      { id: 'C-2026-0803', product: 'SAP Analytics Cloud', status: 'Running', end: '2027-06-30', noticeDays: 60, autoRenew: false, annualEur: 76000, upliftCapPct: 3, termination: TERMINATION, used: 45, licensed: 50, unit: 'users' },
    ],
  },
  {
    id: 'rheinberg', name: 'Rheinberg Energie GmbH', sapCustomerId: '0010090627', since: 2011,
    owner: 'Sabine Lenz', csm: 'Oliver Kranz', customerOwner: 'Thomas Wendt',
    escalation: { level: 'Executive', since: '2026-10-09', topic: 'The smart-meter data import drops 12 % of the readings; the regulatory report is due on 2026-11-30. The new CIO asked for the root cause and a date.', owner: 'Sabine Lenz' },
    topics: [
      { kind: 'people', text: 'New CIO since August runs a vendor consolidation review; SAP is on the list' },
      { kind: 'commercial', text: 'Wants one contract for the core system and the customer portal, with a price cap of 3 %' },
    ],
    mails: [
      { id: 'R-201', subject: 'Renewal S/4HANA for utilities: price rise of 9 % is not acceptable', status: 'waiting-us', intent: 'Renewal', mood: 'negative', contractId: 'C-2023-0610', offerId: 'OFF-2026-0611', side: 'customer', at: '2026-10-17T16:30:00+02:00', count: 4, snippet: 'A rise of 9 % cannot be explained to our supervisory board while 12 % of the meter readings are missing. Please come back with a proposal at the cap and a date for the fix.' },
      { id: 'R-202', subject: 'Customer Experience: adoption after the reorganisation', status: 'waiting-us', intent: 'Renewal', mood: 'mixed', contractId: 'C-2024-0620', offerId: null, side: 'customer', at: '2026-10-14T10:15:00+02:00', count: 2, snippet: 'Only the new service team uses the system since the reorganisation. We need to decide whether we still need 200 seats.' },
      { id: 'R-203', subject: 'Overdue invoice: Integration Suite for the meter-data interfaces', status: 'waiting-customer', intent: 'Payment', mood: 'neutral', contractId: 'C-2026-0811', offerId: null, side: 'us', at: '2026-10-11T09:05:00+02:00', count: 2, snippet: 'We sent a reminder for the invoice that fell due on 2026-09-30 and offered to split the payment.' },
    ],
    contracts: [
      { id: 'C-2023-0610', product: 'SAP S/4HANA for utilities', status: 'Renewal due', end: '2027-01-31', noticeDays: 90, autoRenew: true, annualEur: 780000, upliftCapPct: 3, termination: AUTO_TERMINATION, used: 5200, licensed: 5500, unit: 'users',
        offer: { id: 'OFF-2026-0611', annualEur: 850200, currentAnnualEur: 780000, discountPct: 0, validUntil: '2026-11-09', stage: 'Proposal sent', probabilityPct: 35, competitor: 'Oracle Utilities (evaluation)', nextStep: 'Executive call with the new CIO before the notice date', termMonths: 12, priceGuaranteeMonths: 12, approval: 'Deal desk review open' },
        tickets: [{ id: 'TKT-51022', title: 'Smart-meter data import drops 12 % of the readings (regulatory report due 2026-11-30)', priority: 'Very high', status: 'In processing' }] },
      { id: 'C-2024-0620', product: 'SAP Customer Experience (CX)', status: 'Running', end: '2027-02-28', noticeDays: 60, autoRenew: false, annualEur: 210000, upliftCapPct: 3, termination: TERMINATION, used: 118, licensed: 200, unit: 'seats' },
      { id: 'C-2025-0640', product: 'SAP Analytics Cloud', status: 'Running', end: '2027-06-30', noticeDays: 60, autoRenew: false, annualEur: 64000, upliftCapPct: 3, termination: TERMINATION, used: 70, licensed: 80, unit: 'users' },
      { id: 'C-2026-0811', product: 'SAP Integration Suite (meter-data interfaces)', status: 'Running', end: '2026-12-31', noticeDays: 30, autoRenew: false, annualEur: 48000, upliftCapPct: 3, termination: TERMINATION, used: 9, licensed: 10, unit: 'interfaces',
        offer: { id: 'OFF-2026-0612', annualEur: 49440, currentAnnualEur: 48000, discountPct: 0, validUntil: '2026-11-25', stage: 'Negotiation', probabilityPct: 75, competitor: 'None', nextStep: 'Agree a payment plan for the open invoice, then sign', termMonths: 12, priceGuaranteeMonths: 12, approval: 'Deal desk approved' },
        invoices: [{ id: 'INV-2026-51030', status: 'Overdue', grossEur: 57120, due: '2026-09-30' }] },
    ],
  },
  {
    id: 'seeland', name: 'Seeland Retail Group AG', sapCustomerId: '0010090644', since: 2019,
    owner: 'Marie Dietrich', csm: 'Felix Arndt', customerOwner: 'Anja Köhler',
    escalation: null,
    topics: [
      { kind: 'commercial', text: 'Q4 is peak season: a change freeze for all systems starts on 2026-11-16' },
      { kind: 'commercial', text: 'Wants to move Commerce Cloud to a usage-based model after a short trial elsewhere' },
    ],
    mails: [
      { id: 'S-201', subject: 'Commerce Cloud: would you take us back with a usage-based price?', status: 'waiting-us', intent: 'Offer', mood: 'mixed', contractId: 'C-2022-0701', offerId: 'OFF-2026-0620', side: 'customer', at: '2026-10-15T13:40:00+02:00', count: 3, snippet: 'The trial on the other platform did not scale during the sale weekend. We would come back if the price follows our traffic. Can you send an offer before the freeze?' },
      { id: 'S-202', subject: 'Customer Data Cloud: who signs the renewal?', status: 'waiting-us', intent: 'Renewal', mood: 'neutral', contractId: 'C-2025-0712', offerId: null, side: 'customer', at: '2026-10-13T08:55:00+02:00', count: 1, snippet: 'Our notice deadline is at the beginning of November. Please send the renewal offer so that Legal can review it before the freeze.' },
      { id: 'S-203', subject: 'Emarsys: contacts after the clean-up', status: 'answered', intent: 'Offer', mood: 'neutral', contractId: 'C-2025-0720', offerId: null, side: 'us', at: '2026-10-09T15:20:00+02:00', count: 2, snippet: 'After the list clean-up 180,000 of the 300,000 contacts are active. We can right-size the package at the renewal.' },
    ],
    contracts: [
      { id: 'C-2022-0701', product: 'SAP Commerce Cloud', status: 'Lapsed', end: '2026-06-30', noticeDays: 90, autoRenew: false, annualEur: 310000, upliftCapPct: 3, termination: 'Expired. The storefront runs on a trial platform.', used: 0, licensed: 2500, unit: 'sessions (thousands)',
        offer: { id: 'OFF-2026-0620', annualEur: 288300, currentAnnualEur: 310000, discountPct: 7, validUntil: '2026-11-20', stage: 'Proposal sent', probabilityPct: 55, competitor: 'Shopify Plus (trial)', nextStep: 'Send the usage-based option before the change freeze on 2026-11-16', termMonths: 24, priceGuaranteeMonths: 24, approval: 'Deal desk approved' } },
      { id: 'C-2025-0712', product: 'SAP Customer Data Cloud', status: 'Renewal due', end: '2027-01-31', noticeDays: 90, autoRenew: false, annualEur: 185000, upliftCapPct: 3, termination: TERMINATION, used: 276, licensed: 300, unit: 'profiles (thousands)' },
      { id: 'C-2025-0720', product: 'SAP Emarsys Customer Engagement', status: 'Running', end: '2027-04-30', noticeDays: 60, autoRenew: false, annualEur: 120000, upliftCapPct: 3, termination: TERMINATION, used: 180, licensed: 300, unit: 'contacts (thousands)' },
      { id: 'C-2026-0821', product: 'SAP Commerce pricing add-on', status: 'Running', end: '2027-08-31', noticeDays: 30, autoRenew: false, annualEur: 36000, upliftCapPct: 3, termination: TERMINATION, used: 38, licensed: 40, unit: 'users' },
    ],
  },
];

/** Usage over the last six months (the last value is replaced by the real usage when the data is built). */
export const EXTRA_TRENDS = {
  'C-2025-0710': [72, 79, 86, 91, 95, 97],   // Alpenwerke S/4HANA: grows towards the licence, the second plant comes on top
  'C-2024-0620': [88, 81, 74, 68, 63, 59],   // Rheinberg CX: adoption collapsed after the reorganisation
  'C-2025-0720': [96, 92, 80, 70, 64, 60],   // Seeland Emarsys: falls after the peak season and the list clean-up
};
