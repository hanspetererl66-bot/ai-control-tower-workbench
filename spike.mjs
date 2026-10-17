// Phase 0 derisk: can a third-party UI drive goosed via @aaif/goose-sdk?
//
//   npm run phase0
//
// Verifies, in order: ACP handshake → session creation → ARC-1 extension load →
// live prompt round-trip against a4h. The last step needs OPENROUTER_API_KEY in .env;
// everything before it runs without a key.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DEFAULT_GOOSE_MCP_HOST_CAPABILITIES, GooseClient } from '@aaif/goose-sdk';
import { PROTOCOL_VERSION } from '@agentclientprotocol/sdk';
import { parseDocument } from 'yaml';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = await new Promise((resolve, reject) => {
  const probe = createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => {
    const address = probe.address();
    probe.close((error) =>
      error ? reject(error) : resolve(typeof address === 'object' && address ? address.port : 0)
    );
  });
});
const BIN = join(ROOT, 'node_modules/@aaif/goose-binary-darwin-arm64/bin/goose');
const WORKDIR = join(ROOT, 'workspace');
const PHASE_HOME = mkdtempSync(join(tmpdir(), 'werkbank-phase0-'));
const phaseConfigPath = join(PHASE_HOME, '.config/goose/config.yaml');

// A smoke test must not authenticate or initialize unrelated production
// connectors. Copy the real config into an ephemeral home and enable only the
// local ARC-1 instance under test; the source file stays byte-for-byte intact.
const phaseConfig = parseDocument(
  readFileSync(join(ROOT, 'goose-home/.config/goose/config.yaml'), 'utf8')
);
for (const name of Object.keys(phaseConfig.get('extensions')?.toJSON?.() ?? {})) {
  phaseConfig.setIn(['extensions', name, 'enabled'], name === 'arc1');
}
mkdirSync(dirname(phaseConfigPath), { recursive: true });
writeFileSync(phaseConfigPath, phaseConfig.toString(), 'utf8');

const hasKey = Boolean(process.env.OPENROUTER_API_KEY);

const server = spawn(BIN, ['serve', '--port', String(PORT)], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    HOME: PHASE_HOME, // isolated — never touches project or user Goose state
    GOOSE_DISABLE_KEYRING: '1',
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY ?? 'sk-dummy-handshake-only',
  },
});
server.stderr.on('data', (d) => {
  const s = String(d);
  if (/ERROR|WARN/.test(s)) process.stderr.write(`[goosed] ${s}`);
});

// ponytail: fixed sleep beats parsing startup logs for a throwaway spike
await new Promise((r) => setTimeout(r, 2500));

// Every tool call the agent makes, in order — this is the stream the real app's
// "Generated" panel will filter for file writes.
const toolCalls = [];
const textChunks = [];

const callbacks = () => ({
  sessionUpdate: async ({ update }) => {
    if (!update) return;
    if (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') {
      toolCalls.push(update);
    }
    if (update.sessionUpdate === 'agent_message_chunk') {
      const t = update.content?.text;
      if (t) textChunks.push(t);
    }
  },
  requestPermission: async () => ({ outcome: { outcome: 'selected', optionId: 'allow' } }),
  writeTextFile: async () => ({}),
  readTextFile: async () => ({ content: '' }),
});

function failureDetail(update) {
  const content = (update.content ?? [])
    .map((item) => (item?.type === 'content' && item.content?.type === 'text' ? item.content.text : ''))
    .filter(Boolean)
    .join(' ');
  const raw =
    typeof update.rawOutput === 'string'
      ? update.rawOutput
      : update.rawOutput == null
        ? ''
        : JSON.stringify(update.rawOutput);
  const reply = textChunks.filter((chunk) => typeof chunk === 'string').join(' ');
  return [content, raw, reply]
    .map((candidate) => candidate.trim().replace(/\s+/g, ' '))
    .find((candidate) => candidate && candidate !== '0')
    ?.slice(0, 240);
}

const client = new GooseClient(callbacks, `http://127.0.0.1:${PORT}`);
let exitCode = 0;

try {
  const init = await client.initialize({
    protocolVersion: PROTOCOL_VERSION,
    _meta: { 'goose/useLoginShellPath': true },
    clientCapabilities: {
      elicitation: { form: {} },
      _meta: {
        goose: {
          mcpHostCapabilities: DEFAULT_GOOSE_MCP_HOST_CAPABILITIES,
          customNotifications: true,
        },
      },
    },
    clientInfo: { name: 'werkbank', version: '0.0.0' },
  });
  console.log('✅ initialize');
  console.log('   mcpCapabilities:', JSON.stringify(init.agentCapabilities?.mcpCapabilities ?? {}));

  const session = await client.newSession({ cwd: WORKDIR, mcpServers: [] });
  const ext = session._meta?.extensionResults ?? [];
  console.log('✅ newSession', session.sessionId);
  console.log('   extensions:', ext.map((e) => `${e.name}=${e.success ? 'ok' : 'FAILED'}`).join(' '));
  console.log('   modes:', (session.modes?.availableModes ?? []).map((m) => m.id).join(' '));
  console.log('   models:', (session.models?.availableModels ?? []).length, 'available');

  const arc1 = ext.find((e) => e.name === 'arc1');
  if (!arc1?.success) throw new Error('local ARC-1 connector failed to initialize');

  if (!hasKey) {
    console.log('\n⏭  no OPENROUTER_API_KEY in .env — skipping the live round-trip.');
    console.log('   Paste your key into .env and re-run to finish Phase 0.');
  } else {
    console.log('\n→ live round-trip against a4h …');
    await client.prompt({
      sessionId: session.sessionId,
      prompt: [
        {
          type: 'text',
          text: 'Use only the local connector named exactly arc1 (never arc1-cf) to list open SAP transport requests, summary only. Reply with just the total count and nothing else.',
        },
      ],
    });
    const failedCall = [...toolCalls]
      .reverse()
      .find((t) => t.sessionUpdate === 'tool_call_update' && t.status === 'failed');
    if (failedCall) {
      const first = toolCalls.find(
        (t) => t.sessionUpdate === 'tool_call' && t.toolCallId === failedCall.toolCallId
      );
      const detail = failureDetail(failedCall);
      throw new Error(
        `live ARC-1 tool call failed: ${first?.title ?? failedCall.title ?? failedCall.toolCallId}` +
          (detail ? ` — ${detail}` : '')
      );
    }
    console.log('✅ prompt completed');
    console.log('   reply:', textChunks.join('').trim().slice(0, 200) || '(empty)');
    console.log(`\n--- ${toolCalls.length} tool-call notifications ---`);
    for (const t of toolCalls.slice(0, 6)) {
      console.log(
        `   ${t.sessionUpdate.padEnd(17)} ${t.title ?? t.toolCallId ?? ''} ` +
          `kind=${t.kind ?? '-'} status=${t.status ?? '-'} ` +
          `locations=${JSON.stringify(t.locations ?? [])}`
      );
    }
    console.log('\n   shape of one notification (for the Generated panel):');
    console.log('  ', JSON.stringify(toolCalls[0] ?? {}, null, 2).slice(0, 900));
  }
} catch (e) {
  exitCode = 1;
  console.log('❌', e?.message ?? e);
  if (e?.data) console.log('   data:', JSON.stringify(e.data).slice(0, 600));
} finally {
  server.kill();
  rmSync(PHASE_HOME, { recursive: true, force: true });
  process.exit(exitCode);
}
