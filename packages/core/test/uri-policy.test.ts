import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DecodeError, isForbiddenAddress, LimitExceeded, parse, resolveDocument } from '../src/index.js';
import { createServerUriPolicy, ForbiddenAddressError, type HostResolver } from '../src/node/index.js';
import { asResource } from './helpers.js';

let server: Server;
let port = 0;
let hits = 0;

beforeAll(async () => {
  server = createServer((req, res) => {
    hits++;
    if (req.url === '/redirect-evil') {
      res.writeHead(302, { location: `http://evil.test:${port}/` });
      res.end();
      return;
    }
    if (req.url === '/loop') {
      res.writeHead(302, { location: '/loop' });
      res.end();
      return;
    }
    if (req.url === '/big') {
      res.writeHead(200);
      res.end(Buffer.alloc(4096));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<b>hi</b>');
  });
  await new Promise<void>((r) => {
    server.listen(0, '127.0.0.1', r);
  });
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => {
    server.close(() => {
      r();
    });
  });
});

const resolver =
  (map: Record<string, string>): HostResolver =>
  (host) => {
    const address = map[host];
    return address === undefined
      ? Promise.reject(new Error(`ENOTFOUND ${host}`))
      : Promise.resolve([{ address, family: address.includes(':') ? 6 : 4 }]);
  };

/** Test hook: lets the local test server through, keeps every other rule. */
const loopbackForTests = (ip: string) => ip !== '127.0.0.1' && isForbiddenAddress(ip);

describe('server-side uri policy (§5.5)', () => {
  it('statically allows only public https URIs by default', () => {
    const p = createServerUriPolicy();
    expect(p.allows('https://example.org/logo.svg')).toBe(true);
    for (const u of [
      'http://example.org/',
      'file:///etc/passwd',
      'logo.svg',
      'https://127.0.0.1/',
      'https://[::1]/',
      'https://10.1.2.3/',
      'https://user:pw@example.org/',
    ]) {
      expect(p.allows(u), u).toBe(false);
    }
  });

  it('refuses a name resolving to 127.0.0.1 without connecting (H.5)', async () => {
    const p = createServerUriPolicy({ schemes: ['http:'], resolveHost: resolver({ 'internal.test': '127.0.0.1' }) });
    const before = hits;
    await expect(p.resolve(`http://internal.test:${port}/`)).rejects.toBeInstanceOf(ForbiddenAddressError);
    expect(hits).toBe(before);
  });

  it('H.5 through the runtime: the resource fails', async () => {
    const uriPolicy = createServerUriPolicy({
      schemes: ['http:'],
      resolveHost: resolver({ 'internal.test': '127.0.0.1' }),
    });
    const doc = parse(`<<<U type="image/png" encoding="uri"\nhttp://internal.test:${port}/\nU\n`);
    const [r] = await resolveDocument(doc, { uriPolicy });
    expect(asResource(r).result.state).toBe('failed');
  });

  it('returns bytes only, ignoring Content-Type', async () => {
    const p = createServerUriPolicy({
      schemes: ['http:'],
      resolveHost: resolver({ 'good.test': '127.0.0.1' }),
      isForbidden: loopbackForTests,
    });
    const bytes = await p.resolve(`http://good.test:${port}/`);
    expect(new TextDecoder().decode(bytes)).toBe('<b>hi</b>');
  });

  it('re-checks the target of every redirect', async () => {
    const p = createServerUriPolicy({
      schemes: ['http:'],
      resolveHost: resolver({ 'good.test': '127.0.0.1', 'evil.test': '10.0.0.1' }),
      isForbidden: loopbackForTests,
    });
    const before = hits;
    await expect(p.resolve(`http://good.test:${port}/redirect-evil`)).rejects.toBeInstanceOf(ForbiddenAddressError);
    expect(hits).toBe(before + 1);
  });

  it('limits redirects and body size', async () => {
    const base = {
      schemes: ['http:'],
      resolveHost: resolver({ 'good.test': '127.0.0.1' }),
      isForbidden: loopbackForTests,
    };
    await expect(
      createServerUriPolicy({ ...base, maxRedirects: 2 }).resolve(`http://good.test:${port}/loop`),
    ).rejects.toThrow(/redirects/);
    await expect(
      createServerUriPolicy({ ...base, maxBytes: 1024 }).resolve(`http://good.test:${port}/big`),
    ).rejects.toBeInstanceOf(LimitExceeded);
  });

  it('rejects relative references and unresolvable hosts', async () => {
    const p = createServerUriPolicy({ schemes: ['http:'], resolveHost: resolver({}) });
    await expect(p.resolve('logo.svg')).rejects.toBeInstanceOf(DecodeError);
    await expect(p.resolve(`http://nowhere.test:${port}/`)).rejects.toBeInstanceOf(DecodeError);
  });
});
