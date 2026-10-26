#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { main } from '../node/cli.js';

async function readInput(path: string): Promise<string> {
  if (path !== '-') return readFile(path, 'utf8');
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

process.exitCode = await main(process.argv.slice(2), {
  stdout: (s) => {
    process.stdout.write(s);
  },
  stderr: (s) => {
    process.stderr.write(s);
  },
  readFile: readInput,
});
