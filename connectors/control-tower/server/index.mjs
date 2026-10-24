#!/usr/bin/env node
/**
 * AI Control Tower — MCP server over stdio. No dependencies.
 * Newline-delimited JSON-RPC 2.0, as used by MCP's stdio transport.
 * stdout carries protocol messages only; diagnostics go to stderr.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { TICKET_TOOL_DEFINITIONS, createTicketHandlers } from './tickets.mjs';
import { SUB4ME_TOOL_DEFINITIONS, createSub4MeHandlers } from './sub4me.mjs';
import { N8N_TOOL_DEFINITIONS, createN8nHandlers } from './n8n.mjs';
import { SKILL_PROFILE_TOOL_DEFINITIONS, createSkillProfileHandlers } from './skill-profiles.mjs';
import { SKILL_RATING_TOOL_DEFINITIONS, createSkillRatingHandlers } from './skill-ratings.mjs';
import { PREFERENCE_TOOL_DEFINITIONS, createPreferenceHandlers } from './preferences.mjs';
import { SAP_HELP_TOOL_DEFINITIONS, createSapHelpHandlers } from './sap-help.mjs';
import { GRAPH_TOOL_DEFINITIONS, createGraphHandlers } from './graph.mjs';
import { WHAT_IF_TOOL_DEFINITIONS, createWhatIfHandlers } from './what-if.mjs';
import { CROSS_SPACE_TOOL_DEFINITIONS, createCrossSpaceHandlers } from './cross-space.mjs';
import { normalizeSupabaseUrl } from './supabase-url.mjs';
import { SKILL_TOOL_DEFINITIONS, createSkillHandlers } from './skills.mjs';
import { TOOL_DEFINITIONS, ToolError, callTool } from './tools.mjs';

const SERVER_INFO = { name: 'ai-control-tower', version: '0.16.0' };
const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const here = (relative) => fileURLToPath(new URL(relative, import.meta.url));

/** Bundled copy first, then the repository's source of truth when running from a checkout. */
function dataPath() {
  const candidates = [
    process.env.CONTROL_TOWER_DATA,
    here('../data/data.json'),
    here('../../../examples/control-tower/data.json'),
  ].filter(Boolean);
  const found = candidates.find((path) => existsSync(path));
  if (!found) throw new Error(`data.json not found (looked in: ${candidates.join(', ')})`);
  return found;
}

/** Read on every call so edits to data.json show up without restarting the agent. */
function loadFile() {
  return JSON.parse(readFileSync(dataPath(), 'utf8'));
}

const SUPABASE_TIMEOUT_MS = 8000;

/** Call a public RPC function on Supabase with the server-side key. */
async function supabaseRpc(fn, body, url, key) {
  const endpoint = new URL(`/rest/v1/rpc/${fn}`, normalizeSupabaseUrl(url));
  const local = ['localhost', '127.0.0.1'].includes(endpoint.hostname);
  if (endpoint.protocol !== 'https:' && !local) throw new Error('SUPABASE_URL must be https');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(SUPABASE_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Supabase answered HTTP ${response.status}`);
  return response.json();
}

/** Read-only snapshot from Supabase (public.control_tower_snapshot), server-side key only. */
async function loadSupabase(url, key) {
  const data = await supabaseRpc('control_tower_snapshot', {}, url, key);
  if (!data || !Array.isArray(data.risks) || !data.agents || !data.budget) {
    throw new Error('Supabase snapshot has an unexpected shape');
  }
  return data;
}

const ticketRpc = () => {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !key) return null;
  return async (fn, body) => {
    try {
      return await supabaseRpc(fn, body, url, key);
    } catch (error) {
      console.error('supabase call failed:', error.message);
      throw new ToolError(`Supabase call failed: ${error.message}`);
    }
  };
};

/**
 * Supabase when SUPABASE_URL and SUPABASE_SECRET_KEY are set, otherwise the bundled
 * sample data. If Supabase is configured but fails, fall back to the file and say so
 * in the result — never silently.
 */
async function loadData() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !key) return { data: loadFile(), source: 'data.json (Supabase not configured)' };
  try {
    return { data: await loadSupabase(url, key), source: 'supabase' };
  } catch (error) {
    // Never echo the key; error messages above do not contain it.
    console.error('supabase read failed:', error.message);
    return { data: loadFile(), source: `data.json (Supabase unavailable: ${error.message})` };
  }
}

const send = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
const reply = (id, result) => send({ id, result });
const fail = (id, code, message) => send({ id, error: { code, message } });

const n8nHandlers = createN8nHandlers();
const sapHelpHandlers = createSapHelpHandlers();

async function handle(message) {
  const { id, method, params } = message;
  const isRequest = id !== undefined && id !== null;

  if (typeof method !== 'string') {
    if (isRequest) fail(id, -32600, 'Invalid request');
    return;
  }

  switch (method) {
    case 'initialize': {
      const wanted = params?.protocolVersion;
      reply(id, {
        protocolVersion: SUPPORTED_PROTOCOLS.includes(wanted) ? wanted : SUPPORTED_PROTOCOLS[0],
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
        instructions:
          'Read-only access to the AI Control Tower: risk register, agent registry and AI budget. ' +
          'Results include a "view" field naming the Control Tower tab that shows the same information.',
      });
      return;
    }
    case 'ping':
      if (isRequest) reply(id, {});
      return;
    case 'tools/list':
      reply(id, { tools: [...TOOL_DEFINITIONS, ...TICKET_TOOL_DEFINITIONS, ...SKILL_TOOL_DEFINITIONS, ...SUB4ME_TOOL_DEFINITIONS, ...N8N_TOOL_DEFINITIONS, ...SKILL_PROFILE_TOOL_DEFINITIONS, ...GRAPH_TOOL_DEFINITIONS, ...SKILL_RATING_TOOL_DEFINITIONS, ...WHAT_IF_TOOL_DEFINITIONS, ...CROSS_SPACE_TOOL_DEFINITIONS, ...SAP_HELP_TOOL_DEFINITIONS, ...PREFERENCE_TOOL_DEFINITIONS] });
      return;
    case 'tools/call': {
      try {
        const rpcCall = ticketRpc();
        const sub4meHandlers = createSub4MeHandlers(undefined, rpcCall);
        const ticketHandlers = { ...createTicketHandlers(rpcCall), ...createSkillHandlers(rpcCall), ...sub4meHandlers, ...createSkillProfileHandlers(undefined, rpcCall), ...createGraphHandlers(), ...createSkillRatingHandlers(undefined, rpcCall), ...createWhatIfHandlers({ loadTower: loadData, ToolError }), ...createCrossSpaceHandlers({ sub4me: sub4meHandlers, loadTower: loadData, rpc: rpcCall }), ...n8nHandlers, ...sapHelpHandlers, ...createPreferenceHandlers(rpcCall) };
        if (Object.hasOwn(ticketHandlers, params?.name)) {
          const args = params.arguments ?? {};
          if (typeof args !== 'object' || Array.isArray(args)) throw new ToolError('arguments must be an object');
          const result = await ticketHandlers[params.name](args);
          reply(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
          return;
        }
        const { data, source } = await loadData();
        reply(id, callTool(params?.name, params?.arguments, data, source));
      } catch (error) {
        if (error instanceof ToolError) reply(id, { content: [{ type: 'text', text: error.message }], isError: true });
        else if (error instanceof RangeError) fail(id, -32602, error.message);
        else fail(id, -32603, `Internal error: ${error.message}`);
      }
      return;
    }
    default:
      // Notifications (e.g. notifications/initialized) have no id and need no reply.
      if (isRequest) fail(id, -32601, `Method not found: ${method}`);
  }
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on('line', (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    fail(null, -32700, 'Parse error');
    return;
  }
  handle(message).catch((error) => {
    console.error('unhandled error:', error);
    if (message?.id !== undefined && message?.id !== null) fail(message.id, -32603, 'Internal error');
  });
});
lines.on('close', () => process.exit(0));
