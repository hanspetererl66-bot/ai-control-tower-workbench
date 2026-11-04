#!/usr/bin/env node
/**
 * Notion connector: MCP server over stdio. No dependencies.
 * Newline-delimited JSON-RPC 2.0. stdout carries protocol messages only.
 */
import { createInterface } from 'node:readline';
import { NotionError, TOOL_DEFINITIONS, createNotionHandlers } from './notion.mjs';

const SERVER_INFO = { name: 'notion', version: '0.1.0' };
const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const send = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
const reply = (id, result) => send({ id, result });
const fail = (id, code, message) => send({ id, error: { code, message } });
const handlers = createNotionHandlers();

async function handle({ id, method, params }) {
  const isRequest = id !== undefined && id !== null;
  if (typeof method !== 'string') { if (isRequest) fail(id, -32600, 'Invalid request'); return; }
  switch (method) {
    case 'initialize':
      reply(id, {
        protocolVersion: SUPPORTED_PROTOCOLS.includes(params?.protocolVersion) ? params.protocolVersion : SUPPORTED_PROTOCOLS[0],
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
        instructions: 'Notion, read only: search the pages shared with the integration and read a page as text. Start with notion_check_connection if something fails.',
      });
      return;
    case 'ping': if (isRequest) reply(id, {}); return;
    case 'tools/list': reply(id, { tools: TOOL_DEFINITIONS }); return;
    case 'tools/call': {
      if (!Object.hasOwn(handlers, params?.name)) { fail(id, -32602, `Unknown tool: ${params?.name}`); return; }
      const args = params.arguments ?? {};
      if (typeof args !== 'object' || Array.isArray(args)) { fail(id, -32602, 'arguments must be an object'); return; }
      try {
        reply(id, { content: [{ type: 'text', text: JSON.stringify(await handlers[params.name](args), null, 2) }] });
      } catch (error) {
        if (error instanceof NotionError) reply(id, { content: [{ type: 'text', text: error.message }], isError: true });
        else fail(id, -32603, `Internal error: ${error.message}`);
      }
      return;
    }
    default:
      if (isRequest) fail(id, -32601, `Method not found: ${method}`);
  }
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on('line', (line) => {
  if (!line.trim()) return;
  let message;
  try { message = JSON.parse(line); } catch { fail(null, -32700, 'Parse error'); return; }
  handle(message).catch((error) => {
    console.error('unhandled error:', error.message);
    if (message?.id !== undefined && message?.id !== null) fail(message.id, -32603, 'Internal error');
  });
});
lines.on('close', () => process.exit(0));
