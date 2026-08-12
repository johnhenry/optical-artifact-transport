import { describe, expect, it } from 'vitest';
import { createCapabilityPolicy, intersectCapabilities } from '../src/capabilities.js';

describe('capability intersection', () => {
  it('grants only capabilities that are requested, allowed, and user-approved', () => {
    const policy = createCapabilityPolicy(['ui.render.form.basic', 'ui.action.submit']);
    const effective = intersectCapabilities(
      ['ui.render.form.basic', 'ui.action.submit', 'html.script'],
      policy,
      ['ui.render.form.basic', 'html.script']
    );
    expect(effective).toEqual(['ui.render.form.basic']);
  });

  it('denied capabilities always lose, even if allowed and approved', () => {
    const policy = createCapabilityPolicy(['ui.action.submit'], ['ui.action.submit']);
    const effective = intersectCapabilities(['ui.action.submit'], policy, ['ui.action.submit']);
    expect(effective).toEqual([]);
  });

  it('returns nothing when nothing was user-approved', () => {
    const policy = createCapabilityPolicy(['ui.render.text']);
    const effective = intersectCapabilities(['ui.render.text'], policy, []);
    expect(effective).toEqual([]);
  });
});
