export const MAIN_ONLY_OWNERS: Set<string>;
export const MAIN_ONLY_ENV: string[];
export function takeMainOnlyEnv(env: Record<string, string | undefined>): Record<string, string>;
export function agentSecrets(store: Record<string, Record<string, string>>): Record<string, string>;
export const ADAPTER_INFO: Record<string, { label: string; hint: string; tokenHint: string }>;
export interface MonitoringConfigView { configured: boolean; source: 'app' | 'environment' | 'none'; baseUrl: string; tokenSet: boolean; adapter: string; adapters: { id: string; label: string; hint: string; tokenHint: string }[] }
export function createMonitoringConfig(opts: {
  store: { read(name: string): Record<string, string> | undefined; write(name: string, values: Record<string, string>): void; forget(name: string): void };
  env?: Record<string, string | undefined>;
  monitoring: { alerts(args: { sinceHours: number }): Promise<{ adapter: string; alerts: unknown[] }> };
}): { get(): MonitoringConfigView; set(args: { baseUrl: unknown; token?: unknown; adapter?: unknown }): MonitoringConfigView; clear(): MonitoringConfigView; test(): Promise<{ adapter: string; count: number }> };
