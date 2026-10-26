import { describe, expect, it } from 'vitest';
import { analyseRels, effectiveRel, parse } from '../src/index.js';

describe('rel semantics (Appendix A)', () => {
  it('maps unknown tokens to inline', () => {
    expect(effectiveRel('acme-thing')).toBe('inline');
    expect(effectiveRel('Metadata')).toBe('metadata');
  });

  it('associates with the preceding sibling resource', () => {
    const doc = parse(
      '<<<I type="image/png"\nI\n' +
        '<<<D type="text/plain" rel="describedby"\nD\n' +
        '\n' +
        '<<<A type="image/webp" rel="ALTERNATE"\nA\n' +
        'prose\n' +
        '<<<O type="text/plain" rel="describedby"\nO\n',
    );
    expect(analyseRels(doc.children)).toEqual({
      associations: [
        { kind: 'describedby', nodeId: '1', targetId: '0' },
        { kind: 'alternate', nodeId: '3', targetId: '0' },
      ],
      orphans: ['5'],
    });
  });

  it('metadata is never a target', () => {
    const doc = parse('---\nt: 1\n---\n<<<D type="text/plain" rel="describedby"\nD\n');
    expect(analyseRels(doc.children)).toEqual({ associations: [], orphans: ['1'] });
  });
});
