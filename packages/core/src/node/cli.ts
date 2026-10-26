import { parseArgs } from 'node:util';
import { parse } from '../parser.js';
import { resolveDocument } from '../runtime.js';
import { normaliseDocument, normaliseResolved, toFixtureJson } from '../serialize.js';
import type { Diagnostic, Limits } from '../types.js';
import { createServerUriPolicy } from './uri-policy.js';

/** I/O seam so the CLI can be tested without touching the process. */
export interface CliIo {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  /** `-` means standard input. */
  readFile: (path: string) => Promise<string>;
}

export const USAGE = `Usage: m2 <command> [options] <file | ->

Commands:
  tree       Print the normalised parse tree (no decoding).
  resolve    Decode resources and print the resolved tree.
  validate   Print diagnostics. Exit status 1 if there are any.

Options:
  --allow-remote        Resolve https: uri resources (SSRF-guarded).
  --max-depth <n>       Nesting depth limit.
  --max-resources <n>   Resource count limit.
  --max-bytes <n>       Total decoded byte limit.
  -h, --help            Show this help.
`;

type Command = 'tree' | 'resolve' | 'validate';

interface CliOptions {
  command: Command;
  file: string;
  allowRemote: boolean;
  limits: Partial<Limits>;
}

class UsageError extends Error {}

const isCommand = (s: string): s is Command => s === 'tree' || s === 'resolve' || s === 'validate';
const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function positiveInt(raw: string | undefined, flag: string): number | undefined {
  if (raw === undefined) return undefined;
  if (!/^[1-9]\d*$/.test(raw)) throw new UsageError(`--${flag} expects a positive integer`);
  return Number(raw);
}

function parseCli(argv: readonly string[]): CliOptions | 'help' {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    strict: true,
    options: {
      help: { type: 'boolean', short: 'h' },
      'allow-remote': { type: 'boolean' },
      'max-depth': { type: 'string' },
      'max-resources': { type: 'string' },
      'max-bytes': { type: 'string' },
    },
  });
  if (values.help) return 'help';
  const [command, file] = positionals;
  if (command === undefined || !isCommand(command)) throw new UsageError(`unknown command ${command ?? '(none)'}`);
  if (file === undefined || positionals.length !== 2) throw new UsageError('expected exactly one input file');

  const limits: Partial<Limits> = {};
  const depth = positiveInt(values['max-depth'], 'max-depth');
  const resources = positiveInt(values['max-resources'], 'max-resources');
  const bytes = positiveInt(values['max-bytes'], 'max-bytes');
  if (depth !== undefined) limits.maxDepth = depth;
  if (resources !== undefined) limits.maxResources = resources;
  if (bytes !== undefined) limits.maxDecodedBytes = bytes;

  return { command, file, allowRemote: values['allow-remote'] === true, limits };
}

/** Run the CLI. Returns the process exit status: 0 ok, 1 diagnostics, 2 usage or I/O error. */
export async function main(argv: readonly string[], io: CliIo): Promise<number> {
  let opts: CliOptions | 'help';
  try {
    opts = parseCli(argv);
  } catch (e) {
    io.stderr(`m2: ${message(e)}\n\n${USAGE}`);
    return 2;
  }
  if (opts === 'help') {
    io.stdout(USAGE);
    return 0;
  }

  let src: string;
  try {
    src = await io.readFile(opts.file);
  } catch (e) {
    io.stderr(`m2: cannot read ${opts.file}: ${message(e)}\n`);
    return 2;
  }

  const doc = parse(src, { limits: opts.limits });
  if (opts.command === 'tree') {
    io.stdout(toFixtureJson(normaliseDocument(doc)));
    return 0;
  }

  const diagnostics: Diagnostic[] = [...doc.diagnostics];
  const resolved = await resolveDocument(doc, {
    limits: opts.limits,
    diagnostics,
    ...(opts.allowRemote ? { uriPolicy: createServerUriPolicy() } : {}),
  });
  if (opts.command === 'resolve') {
    io.stdout(toFixtureJson(normaliseResolved(resolved)));
    return 0;
  }

  for (const d of diagnostics) {
    const where = d.nodeId === undefined ? '' : ` [${d.nodeId}]`;
    io.stdout(`${opts.file}:${d.line + 1}: ${d.code}${where}: ${d.message}\n`);
  }
  return diagnostics.length > 0 ? 1 : 0;
}
