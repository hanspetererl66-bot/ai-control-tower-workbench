import { spawn } from 'node:child_process';

/** Minimal stdio MCP client: one JSON-RPC message per line, responses matched by id. */
export function startStdioServer(scriptPath, env = {}) {
  const child = spawn(process.execPath, [scriptPath], {
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const waiting = new Map();
  let buffer = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      const message = JSON.parse(line); // stdout must contain protocol JSON only
      if (message.id !== null && message.id !== undefined && waiting.has(message.id)) {
        waiting.get(message.id)(message);
        waiting.delete(message.id);
      }
    }
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  let nextId = 1;
  const request = (method, params, timeoutMs = 8000) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), timeoutMs);
      waiting.set(id, (message) => {
        clearTimeout(timer);
        resolve(message);
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  return {
    request,
    /** Call a tool and return { isError, text, json } with the first text block parsed when it is JSON. */
    async tool(name, args = {}) {
      const response = await request('tools/call', { name, arguments: args });
      if (response.error) return { rpcError: response.error };
      const text = response.result?.content?.[0]?.text ?? '';
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
      return { isError: response.result?.isError === true, text, json };
    },
    stderr: () => stderr,
    close() {
      child.kill();
    },
  };
}
