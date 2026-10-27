import { escapeHtml } from './html.js';

/**
 * WaveDrom, DOM-free: WaveJSON in, standalone SVG out.
 *
 * - The source is read by a small relaxed-JSON (JSON5 subset) reader and never
 *   evaluated, so an expression such as `(function(){…})()` is a parse error.
 * - Supported: timing diagrams (`signal`, `head`, `foot`, `config.hscale`) and
 *   register maps (`reg`, `config.bits`, `config.lanes`, `config.hspace`).
 * - The result is meant to be shown through <img>, where nothing in it can run.
 */

const MAX_DEPTH = 32;
const MAX_LANES = 256;
const MAX_STEPS = 512;
const MAX_FIELDS = 256;
const MAX_REG_BITS = 1024;

type Obj = Record<string, unknown>;

const isObject = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
const int = (v: unknown): number | undefined => (typeof v === 'number' && Number.isInteger(v) ? v : undefined);
const text = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

// ------------------------------------------------------------------ relaxed JSON

const NUMBER = /[-+]?(?:Infinity|0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/y;
const IDENT = /[A-Za-z_$][\w$]*/y;

/** JSON5 subset: comments, unquoted keys, single quotes, trailing commas, hex and signed numbers. */
class Reader {
  private i = 0;

  constructor(private readonly s: string) {}

  read(): unknown {
    const v = this.value(0);
    this.ws();
    if (this.i < this.s.length) this.fail('unexpected text after the value');
    return v;
  }

  private fail(message: string): never {
    throw new Error(`WaveJSON: ${message} at offset ${this.i}`);
  }

  private peek(): string {
    return this.s.charAt(this.i);
  }

  private ws(): void {
    for (;;) {
      const c = this.peek();
      if (c === '') return;
      if (/\s/.test(c) || c === '\ufeff') {
        this.i++;
        continue;
      }
      if (c === '/' && this.s.charAt(this.i + 1) === '/') {
        const e = this.s.indexOf('\n', this.i);
        this.i = e < 0 ? this.s.length : e + 1;
        continue;
      }
      if (c === '/' && this.s.charAt(this.i + 1) === '*') {
        const e = this.s.indexOf('*/', this.i + 2);
        if (e < 0) this.fail('unterminated comment');
        this.i = e + 2;
        continue;
      }
      return;
    }
  }

  private value(depth: number): unknown {
    if (depth > MAX_DEPTH) this.fail('nested too deeply');
    this.ws();
    const c = this.peek();
    if (c === '{') return this.object(depth);
    if (c === '[') return this.array(depth);
    if (c === '"' || c === "'") return this.string();
    return this.scalar();
  }

  private object(depth: number): Obj {
    this.i++;
    const entries: [string, unknown][] = [];
    for (;;) {
      this.ws();
      if (this.peek() === '}') {
        this.i++;
        break;
      }
      const key = this.key();
      this.ws();
      if (this.peek() !== ':') this.fail('expected ":"');
      this.i++;
      entries.push([key, this.value(depth + 1)]);
      this.ws();
      const c = this.peek();
      if (c === ',') {
        this.i++;
        continue;
      }
      if (c === '}') {
        this.i++;
        break;
      }
      this.fail('expected "," or "}"');
    }
    // fromEntries defines own properties, so a "__proto__" key stays plain data.
    return Object.fromEntries(entries);
  }

  private array(depth: number): unknown[] {
    this.i++;
    const out: unknown[] = [];
    for (;;) {
      this.ws();
      if (this.peek() === ']') {
        this.i++;
        break;
      }
      out.push(this.value(depth + 1));
      this.ws();
      const c = this.peek();
      if (c === ',') {
        this.i++;
        continue;
      }
      if (c === ']') {
        this.i++;
        break;
      }
      this.fail('expected "," or "]"');
    }
    return out;
  }

  private key(): string {
    const c = this.peek();
    if (c === '"' || c === "'") return this.string();
    IDENT.lastIndex = this.i;
    const m = IDENT.exec(this.s);
    if (!m) this.fail('expected a property name');
    this.i += m[0].length;
    return m[0];
  }

  private hex(n: number): string {
    const h = this.s.slice(this.i, this.i + n);
    if (h.length !== n || !/^[0-9a-fA-F]+$/.test(h)) this.fail('bad escape sequence');
    this.i += n;
    return String.fromCharCode(Number.parseInt(h, 16));
  }

  private string(): string {
    const quote = this.peek();
    this.i++;
    let out = '';
    for (;;) {
      if (this.i >= this.s.length) this.fail('unterminated string');
      const c = this.s.charAt(this.i++);
      if (c === quote) return out;
      if (c === '\n') this.fail('newline in string');
      if (c !== '\\') {
        out += c;
        continue;
      }
      const e = this.s.charAt(this.i++);
      switch (e) {
        case 'n':
          out += '\n';
          break;
        case 'r':
          out += '\r';
          break;
        case 't':
          out += '\t';
          break;
        case 'b':
          out += '\b';
          break;
        case 'f':
          out += '\f';
          break;
        case 'v':
          out += '\v';
          break;
        case '0':
          out += '\0';
          break;
        case 'u':
          out += this.hex(4);
          break;
        case 'x':
          out += this.hex(2);
          break;
        case '\n':
          break; // line continuation
        case '':
          this.fail('unterminated string');
          break;
        default:
          out += e;
      }
    }
  }

  private scalar(): unknown {
    NUMBER.lastIndex = this.i;
    const n = NUMBER.exec(this.s);
    if (n) {
      this.i += n[0].length;
      const negative = n[0].startsWith('-');
      const body = n[0].replace(/^[-+]/, '');
      const v = body === 'Infinity' ? Infinity : Number(body);
      return negative ? -v : v;
    }
    IDENT.lastIndex = this.i;
    const word = IDENT.exec(this.s)?.[0];
    if (word === 'true' || word === 'false' || word === 'null' || word === 'NaN') {
      this.i += word.length;
      return word === 'true' ? true : word === 'false' ? false : word === 'null' ? null : Number.NaN;
    }
    return this.fail('unexpected character');
  }
}

// ------------------------------------------------------------------ drawing

const INK = '#25222c';
const LANE = 30;
const HIGH = 7;
const LOW = 25;
const MID = 16;
const SLANT = 4;

const DATA_FILL: Readonly<Record<string, string>> = {
  '=': '#ffffff',
  '2': '#ffffb4',
  '3': '#ffe0b9',
  '4': '#b9e0ff',
  '5': '#ccfdfe',
  '6': '#cdfdc5',
  '7': '#f0c1fb',
  '8': '#f5c2c0',
  '9': '#d3d3d3',
};

function svgDoc(width: number, height: number, body: string): string {
  const w = Math.ceil(width);
  const h = Math.ceil(height);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="Helvetica, Arial, sans-serif" font-size="11" fill="${INK}">${body}</svg>`;
}

interface Seg {
  ch: string;
  start: number;
  len: number;
}

/** Expand `.` and `|` into the segment they continue. Unknown characters count as `x`. */
function segments(wave: string): { segs: Seg[]; gaps: number[] } {
  const segs: Seg[] = [];
  const gaps: number[] = [];
  let prev: Seg | undefined;
  for (let k = 0; k < wave.length; k++) {
    const c = wave.charAt(k);
    if (c === '|') gaps.push(k);
    let seg: Seg;
    if (c === '.' || c === '|') {
      if (prev && !/[pnPN]/.test(prev.ch)) {
        prev.len++;
        continue;
      }
      seg = { ch: prev?.ch ?? 'x', start: k, len: 1 };
    } else {
      seg = { ch: /^[01lhpnPNzx=2-9]$/.test(c) ? c : 'x', start: k, len: 1 };
    }
    segs.push(seg);
    prev = seg;
  }
  return { segs, gaps };
}

function lane(wave: string, labels: readonly string[], left: number, top: number, step: number): string {
  const { segs, gaps } = segments(wave);
  const hi = top + HIGH;
  const lo = top + LOW;
  const mid = top + MID;
  const lines: string[] = [];
  const shapes: string[] = [];
  const texts: string[] = [];
  let prevEnd: number | null = null;
  let label = 0;

  for (const s of segs) {
    const x0 = left + s.start * step;
    const x1 = x0 + s.len * step;
    const xm = x0 + step / 2;
    let startY = mid;
    let endY = mid;
    switch (s.ch) {
      case '0':
      case 'l':
        startY = lo;
        endY = lo;
        lines.push(`M${x0} ${lo}H${x1}`);
        break;
      case '1':
      case 'h':
        startY = hi;
        endY = hi;
        lines.push(`M${x0} ${hi}H${x1}`);
        break;
      case 'z':
        lines.push(`M${x0} ${mid}H${x1}`);
        break;
      case 'p':
      case 'P':
        startY = lo;
        endY = lo;
        lines.push(`M${x0} ${lo}V${hi}H${xm}V${lo}H${x1}`);
        break;
      case 'n':
      case 'N':
        startY = hi;
        endY = hi;
        lines.push(`M${x0} ${hi}V${lo}H${xm}V${hi}H${x1}`);
        break;
      case 'x':
        shapes.push(`<path d="M${x0} ${hi}H${x1}V${lo}H${x0}Z" fill="#e6e1d6" stroke="${INK}"/>`);
        break;
      default: {
        const fill = DATA_FILL[s.ch] ?? '#ffffff';
        shapes.push(
          `<path d="M${x0} ${mid}L${x0 + SLANT} ${hi}H${x1 - SLANT}L${x1} ${mid}L${x1 - SLANT} ${lo}H${x0 + SLANT}Z" fill="${fill}" stroke="${INK}"/>`,
        );
        const t = labels[label++] ?? '';
        if (t !== '')
          texts.push(`<text x="${(x0 + x1) / 2}" y="${mid + 4}" text-anchor="middle">${escapeHtml(t)}</text>`);
      }
    }
    if (prevEnd !== null && prevEnd !== startY) lines.push(`M${x0} ${prevEnd}V${startY}`);
    prevEnd = endY;
  }
  for (const g of gaps) {
    const cx = left + g * step + step / 2;
    lines.push(`M${cx - 4} ${mid + 7}L${cx} ${mid - 7}M${cx} ${mid + 7}L${cx + 4} ${mid - 7}`);
  }
  const path = lines.length === 0 ? '' : `<path d="${lines.join('')}" fill="none" stroke="${INK}"/>`;
  return path + shapes.join('') + texts.join('');
}

function flatten(list: readonly unknown[], out: Obj[], depth: number): void {
  if (depth > 8) throw new Error('WaveJSON: groups are nested too deeply');
  for (const e of list) {
    if (Array.isArray(e)) flatten(e as unknown[], out, depth + 1);
    else if (isObject(e)) out.push(e);
    // strings are group labels and are not drawn
    if (out.length > MAX_LANES) throw new Error(`WaveJSON: more than ${MAX_LANES} signals`);
  }
}

function signalSvg(spec: Obj, signal: readonly unknown[]): string {
  const lanes: Obj[] = [];
  flatten(signal, lanes, 0);
  const cfg = isObject(spec.config) ? spec.config : {};
  const step = 40 * clamp(int(cfg.hscale) ?? 1, 1, 4);
  const names = lanes.map((e) => text(e.name));
  let steps = 1;
  for (const e of lanes) {
    if (typeof e.wave !== 'string') continue;
    if (e.wave.length > MAX_STEPS) throw new Error(`WaveJSON: a wave is limited to ${MAX_STEPS} steps`);
    steps = Math.max(steps, e.wave.length);
  }
  const widest = names.reduce((w, n) => Math.max(w, n.length), 0);
  const left = widest === 0 ? 10 : Math.min(240, widest * 7) + 20;
  const head = isObject(spec.head) ? text(spec.head.text) : '';
  const foot = isObject(spec.foot) ? text(spec.foot.text) : '';
  const topPad = head === '' ? 8 : 30;
  const width = left + steps * step + 14;
  const height = topPad + lanes.length * LANE + (foot === '' ? 8 : 28);

  let body = '';
  if (head !== '') {
    body += `<text x="${width / 2}" y="19" text-anchor="middle" font-size="14" font-weight="bold">${escapeHtml(head)}</text>`;
  }
  lanes.forEach((e, k) => {
    const top = topPad + k * LANE;
    const name = names[k] ?? '';
    if (name !== '') {
      body += `<text x="${left - 8}" y="${top + MID + 4}" text-anchor="end">${escapeHtml(name)}</text>`;
    }
    if (typeof e.wave !== 'string') return;
    const data = Array.isArray(e.data)
      ? (e.data as unknown[]).map(text)
      : typeof e.data === 'string'
        ? e.data.split(/\s+/).filter((x) => x !== '')
        : [];
    body += lane(e.wave, data, left, top, step);
  });
  if (foot !== '') {
    body += `<text x="${width / 2}" y="${height - 10}" text-anchor="middle" font-size="12">${escapeHtml(foot)}</text>`;
  }
  return svgDoc(width, height, body);
}

interface Field {
  lo: number;
  bits: number;
  name: string;
  attr: string;
}

const REG_LANE = 78;
const REG_BOX = 40;

function regSvg(spec: Obj, reg: readonly unknown[]): string {
  if (reg.length > MAX_FIELDS) throw new Error(`WaveJSON: more than ${MAX_FIELDS} register fields`);
  const fields: Field[] = [];
  let at = 0;
  for (const f of reg) {
    if (!isObject(f)) throw new Error('WaveJSON: a register field is an object');
    const bits = int(f.bits);
    if (bits === undefined || bits < 1 || bits > MAX_REG_BITS)
      throw new Error('WaveJSON: a field needs "bits" of 1 or more');
    fields.push({ lo: at, bits, name: text(f.name), attr: text(f.attr) });
    at += bits;
    if (at > MAX_REG_BITS) throw new Error(`WaveJSON: more than ${MAX_REG_BITS} bits`);
  }
  const cfg = isObject(spec.config) ? spec.config : {};
  const declared = int(cfg.bits);
  const total = declared !== undefined && declared >= at ? declared : Math.max(1, at);
  const lanes = clamp(int(cfg.lanes) ?? 1, 1, 16);
  const per = Math.ceil(total / lanes);
  const hspace = clamp(typeof cfg.hspace === 'number' && Number.isFinite(cfg.hspace) ? cfg.hspace : 640, 200, 2000);
  const bitW = hspace / per;
  const left = 10;
  let body = '';
  for (let ln = 0; ln < lanes; ln++) {
    const laneLo = (lanes - 1 - ln) * per;
    const laneHi = laneLo + per;
    const top = ln * REG_LANE + 4;
    const boxY = top + 16;
    body += `<rect x="${left}" y="${boxY}" width="${hspace}" height="${REG_BOX}" fill="none" stroke="${INK}"/>`;
    for (const f of fields) {
      const a = Math.max(f.lo, laneLo);
      const b = Math.min(f.lo + f.bits, laneHi);
      if (a >= b) continue;
      const x = left + (laneHi - b) * bitW;
      const w = (b - a) * bitW;
      body += `<rect x="${x}" y="${boxY}" width="${w}" height="${REG_BOX}" fill="none" stroke="${INK}"/>`;
      if (f.name !== '') {
        body += `<text x="${x + w / 2}" y="${boxY + REG_BOX / 2 + 4}" text-anchor="middle" font-size="12">${escapeHtml(f.name)}</text>`;
      }
      const msb = b === f.lo + f.bits;
      const lsb = a === f.lo;
      if (msb) body += `<text x="${x + 2}" y="${boxY - 4}" font-size="9">${b - 1}</text>`;
      if (lsb && !(msb && f.bits === 1)) {
        body += `<text x="${x + w - 2}" y="${boxY - 4}" font-size="9" text-anchor="end">${a}</text>`;
      }
      if (lsb && f.attr !== '') {
        body += `<text x="${x + w / 2}" y="${boxY + REG_BOX + 14}" text-anchor="middle" font-size="10">${escapeHtml(f.attr)}</text>`;
      }
    }
  }
  return svgDoc(hspace + 2 * left, lanes * REG_LANE + 8, body);
}

/** Turn WaveJSON (timing diagram or register map) into a standalone SVG. Throws on anything unusable. */
export function waveToSvg(src: string): string {
  const spec = new Reader(src).read();
  if (!isObject(spec)) throw new Error('WaveJSON: expected an object');
  if (Array.isArray(spec.signal)) return signalSvg(spec, spec.signal as unknown[]);
  if (Array.isArray(spec.reg)) return regSvg(spec, spec.reg as unknown[]);
  throw new Error('WaveJSON: expected "signal" or "reg"');
}
