import { describe, it, expect } from 'vitest';
import { getAllActions, getAction, buildActionCatalog, getCategories } from '../src/actions/registry.js';

describe('action registry', () => {
  it('loads many actions across categories', () => {
    const all = getAllActions();
    expect(all.length).toBeGreaterThan(50);
    const cats = getCategories();
    expect(cats).toContain('audio');
    expect(cats).toContain('video');
    expect(cats).toContain('image');
    expect(cats).toContain('security');
  });

  it('every action has unique id', () => {
    const all = getAllActions();
    const ids = new Set<string>();
    for (const a of all) {
      expect(ids.has(a.id), `duplicate ${a.id}`).toBe(false);
      ids.add(a.id);
    }
  });

  it('every action has well-formed param defs', () => {
    for (const a of getAllActions()) {
      for (const p of a.params) {
        expect(p.name).toMatch(/^[a-zA-Z_][a-zA-Z0-9_]*$/);
        expect(['string', 'number', 'boolean', 'file']).toContain(p.type);
      }
    }
  });

  it('getAction returns undefined for unknown', () => {
    expect(getAction('does.not.exist')).toBeUndefined();
  });

  it('catalog text mentions categories', () => {
    const cat = buildActionCatalog();
    expect(cat).toContain('AVAILABLE ACTIONS');
    expect(cat).toContain('AUDIO');
    expect(cat).toContain('SECURITY');
  });
});
