#!/usr/bin/env node
/**
 * Creates the Sub4Me sample tickets of both fictional customers in a Zammad instance.
 * ZAMMAD_URL=https://support.firma.de ZAMMAD_TOKEN=... [ZAMMAD_GROUP=Users] npm run seed:zammad
 * Every ticket starts as "New" in Zammad (the sample status is not copied). Run it once on an empty test instance.
 */
import { createZammadRpc } from '../connectors/control-tower/server/zammad.mjs';
import { customerRecords, loadSub4MeData } from '../connectors/control-tower/server/sub4me.mjs';

const { ZAMMAD_URL, ZAMMAD_TOKEN, ZAMMAD_GROUP } = process.env;
if (!ZAMMAD_URL || !ZAMMAD_TOKEN) {
  console.error('Set ZAMMAD_URL and ZAMMAD_TOKEN first.');
  process.exit(1);
}
const rpc = createZammadRpc({ url: ZAMMAD_URL, token: ZAMMAD_TOKEN, group: ZAMMAD_GROUP || 'Users' });
let count = 0;
for (const record of customerRecords(loadSub4MeData())) {
  for (const t of [...record.tickets].reverse()) {
    const made = await rpc('sub4me_create_ticket', { p_title: t.title, p_product: t.product, p_priority: t.priority, p_description: t.description ?? '', p_customer: record.id });
    console.log(`${record.id}: ${t.id} -> ${made.id}`);
    count += 1;
  }
}
console.log(`Created ${count} tickets.`);
