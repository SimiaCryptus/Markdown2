import { describe, expect, it } from 'vitest';
import { isForbiddenAddress } from '../src/index.js';

describe('SSRF guard (§5.5, H.5)', () => {
  it.each([
    '127.0.0.1',
    '127.1.2.3',
    '10.0.0.1',
    '192.168.1.5',
    '172.20.0.1',
    '169.254.169.254',
    '224.0.0.1',
    '255.255.255.255',
    '::1',
    '[::1]',
    '0:0:0:0:0:0:0:1',
    '::',
    '::ffff:10.0.0.1',
    '::ffff:7f00:1',
    'fe80::1%eth0',
    'fd12:3456::1',
    '64:ff9b::7f00:1',
    '2002:7f00:1::',
  ])('forbids %s', (ip) => {
    expect(isForbiddenAddress(ip)).toBe(true);
  });

  it.each(['93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946', '::ffff:93.184.216.34'])('allows %s', (ip) => {
    expect(isForbiddenAddress(ip)).toBe(false);
  });

  it.each(['not-an-ip', '256.1.1.1', '010.0.0.1', '1:2:3', '1::2::3', ''])('fails closed on %j', (ip) => {
    expect(isForbiddenAddress(ip)).toBe(true);
  });
});
