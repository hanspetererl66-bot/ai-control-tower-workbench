/** Plain JavaScript data modules of the Databricks demo, imported by the briefing card. */
declare module '*/sap-mock/server/data.mjs' {
  export const GRIR_ITEMS: unknown[];
  export function classifyGrir(item: unknown): string;
}
declare module '*/databricks-demo/seed/data.mjs' {
  export const IC_ITEMS: Array<{ sellerAmountEur: number; buyerAmountEur: number | null }>;
}
