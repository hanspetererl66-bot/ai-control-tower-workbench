#!/usr/bin/env node
/**
 * One-time Google sign-in for the Gmail connector. Run on your own machine:
 *   GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... npm run gmail:authorize
 * It opens a loopback listener on 127.0.0.1, prints a Google sign-in URL, and prints the
 * refresh token to this terminal only. Paste it into the connector dialog; never into
 * chat, .env or the repository. Scopes: gmail.readonly + gmail.compose (no send tool exists
 * in the connector, but note that Google's compose scope itself technically allows sending).
 */
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

export const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.compose'];

export function authUrl({ clientId, redirectUri, state, challenge }) {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: SCOPES.join(' '),
    access_type: 'offline', prompt: 'consent', state, code_challenge: challenge, code_challenge_method: 'S256',
  }).toString();
  return url.toString();
}

async function main() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    console.error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET first (see README: Gmail connector).');
    process.exit(1);
  }
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(16).toString('hex');

  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const redirectUri = `http://127.0.0.1:${server.address().port}`;
  console.log('\nOpen this URL in your browser and sign in with the Gmail account to connect:\n');
  console.log(authUrl({ clientId, redirectUri, state, challenge }));
  console.log('\nWaiting for Google (Ctrl+C to cancel)...');

  const code = await new Promise((resolve, reject) => {
    server.on('request', (req, res) => {
      const url = new URL(req.url, redirectUri);
      if (url.searchParams.get('state') !== state) {
        res.writeHead(400).end('State mismatch.');
        return;
      }
      const error = url.searchParams.get('error');
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end(error ? `Google said: ${error}` : 'Done. You can close this tab and return to the terminal.');
      if (error) reject(new Error(`Google said: ${error}`));
      else if (url.searchParams.get('code')) resolve(url.searchParams.get('code'));
    });
  });
  server.close();

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: verifier }),
  });
  const body = await response.json();
  if (!response.ok || !body.refresh_token) {
    console.error(`Google did not return a refresh token (HTTP ${response.status}): ${body.error_description ?? body.error ?? 'unknown'}`);
    process.exit(1);
  }
  console.log('\nRefresh token (paste into the connector dialog, keep it secret):\n');
  console.log(body.refresh_token);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
