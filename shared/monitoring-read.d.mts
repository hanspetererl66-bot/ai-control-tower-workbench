export class MonitoringError extends Error {}
export interface MonitoringAlert { id: string; customer: string; host: string; service: string; severity: 'critical' | 'high' | 'medium' | 'low'; impact: 'high' | 'medium' | 'low'; customerFacing: boolean; repeat24h: number; text: string; at: string }
export interface MonitoringAdapter { name: string; listAlerts(args: { since: string; limit: number }): Promise<unknown[]> }
export const clip: (v: unknown, n: number) => string;
export function toMinute(v: unknown): string;
export function normalizeAlert(raw: unknown, hosts?: Record<string, unknown>): MonitoringAlert | null;
export function normalizeAll(list: unknown, hosts?: Record<string, unknown>, limit?: number): MonitoringAlert[];
export function checkBaseUrl(raw: unknown): string;
export function checkToken(raw: unknown): string;
export function assertReadOnly(adapter: unknown): MonitoringAdapter;
export function createHttpJsonAdapter(opts: { baseUrl: string; token: string; fetchImpl?: typeof fetch; timeoutMs?: number }): MonitoringAdapter;
export function createZabbixAdapter(opts: { baseUrl: string; token: string; fetchImpl?: typeof fetch; timeoutMs?: number }): MonitoringAdapter;
export const ADAPTERS: Record<string, (opts: { baseUrl: string; token: string; fetchImpl?: typeof fetch }) => MonitoringAdapter>;
export function adapterFromEnv(env: Record<string, string | undefined> | null | undefined, fetchImpl?: typeof fetch): MonitoringAdapter | null;
export interface FindingRule { match: string; kind: string; template: string; deadlineDays: number }
export interface Finding { id: string; customer: string; customerName: string; host: string; env: 'PRD' | 'QAS' | 'DEV'; kind: string; template: string; deadlineDays: number; signal: string; evidence: string; live: true }
export const FINDING_KINDS: Readonly<Record<string, { template: string; days: number }>>;
export function toFindings(alerts: MonitoringAlert[], rules?: FindingRule[], hosts?: Record<string, any>): { findings: Finding[]; skipped: number; withheld: number };
export function readMap(file: string): { hosts: Record<string, any>; topology: Record<string, string[]>; rules: FindingRule[] };
export function createMonitoringRead(opts: { adapter: MonitoringAdapter | null | (() => MonitoringAdapter | null); mapFile: string; now?: () => Date; log?: (e: Record<string, unknown>) => void }): {
  status(): { configured: boolean; adapter: string };
  alerts(args?: { sinceHours?: number }): Promise<{ source: 'live'; adapter: string; fetchedAt: string; sinceHours: number; alerts: MonitoringAlert[]; topology: Record<string, string[]> }>;
  findings(args?: { sinceHours?: number }): Promise<{ source: 'live'; adapter: string; fetchedAt: string; sinceHours: number; alerts: number; findings: Finding[]; skipped: number; withheld: number }>;
};
