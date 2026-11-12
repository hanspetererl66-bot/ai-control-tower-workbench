/** Which small icon a domain tile of the Spaces overview gets. Chosen from the domain name (German or English); unknown names get a neutral icon. */
export type DomainIconKey = 'sales' | 'operations' | 'governance' | 'people' | 'finance' | 'marketplace' | 'service' | 'development' | 'automation' | 'data' | 'generic';

const RULES: [RegExp, DomainIconKey][] = [
  [/autonom|operation|\bops\b|infra|\bit\b|betrieb/i, 'operations'],
  [/governance|compliance|security|sicherheit|risk|risiko|legal|recht/i, 'governance'],
  [/\bhr\b|people|personal|recruit|hiring|talent|onboarding/i, 'people'],
  [/financ|finanz|account|buchhalt|controlling|treasury|billing|payment/i, 'finance'],
  [/market|shop|store|katalog|catalog/i, 'marketplace'],
  [/service|support|help|ticket/i, 'service'],
  [/develop|entwickl|engineer|code|build|platform/i, 'development'],
  [/automat|workflow|process|prozess/i, 'automation'],
  [/data|daten|analytic|insight|report|knowledge|wissen/i, 'data'],
  [/sales|vertrieb|customer|kunde|revenue|crm|account exec/i, 'sales'],
];

export function domainIconKey(name: string): DomainIconKey {
  for (const [pattern, key] of RULES) if (pattern.test(name)) return key;
  return 'generic';
}
