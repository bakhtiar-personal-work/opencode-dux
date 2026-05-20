import { describe, expect, it } from 'bun:test';
import { getSkillPermissionsForAgent, normalizeSkillConfig } from './skills';

describe('skills permissions', () => {
  it('should deny all skills by default when no config provided', async () => {
    const permissions = await getSkillPermissionsForAgent('orchestrator');
    expect(permissions['*']).toBe('deny');
  });

  it('should deny all skills for other agents by default', async () => {
    const permissions = await getSkillPermissionsForAgent('designer');
    expect(permissions['*']).toBe('deny');
  });

  it('should honor explicit skill list overrides', async () => {
    // Override with empty list
    const emptyPerms = await getSkillPermissionsForAgent('orchestrator', []);
    expect(emptyPerms['*']).toBe('deny');
    expect(Object.keys(emptyPerms).length).toBe(1);

    // Override with specific list
    const specificPerms = await getSkillPermissionsForAgent('designer', [
      'my-skill',
      '!bad-skill',
    ]);
    expect(specificPerms['*']).toBe('deny');
    expect(specificPerms['my-skill']).toBe('allow');
    expect(specificPerms['bad-skill']).toBe('deny');
  });

  it('should honor wildcard in explicit list', async () => {
    const wildcardPerms = await getSkillPermissionsForAgent('designer', ['*']);
    expect(wildcardPerms['*']).toBe('allow');
  });
});

describe('normalizeSkillConfig', () => {
  it('should return defaults for undefined input', () => {
    expect(normalizeSkillConfig(undefined)).toEqual({
      alwaysLoad: [],
      wildcard: false,
      excluded: [],
    });
  });

  it('should handle empty array', () => {
    expect(normalizeSkillConfig([])).toEqual({
      alwaysLoad: [],
      wildcard: false,
      excluded: [],
    });
  });

  it('should handle array with wildcard', () => {
    expect(normalizeSkillConfig(['skill-a', '*'])).toEqual({
      alwaysLoad: ['skill-a'],
      wildcard: true,
      excluded: [],
    });
  });

  it('should handle array with exclusion', () => {
    expect(normalizeSkillConfig(['skill-a', '!bad-skill'])).toEqual({
      alwaysLoad: ['skill-a'],
      wildcard: false,
      excluded: ['bad-skill'],
    });
  });

  it('should handle object syntax with always-load', () => {
    expect(
      normalizeSkillConfig({ 'always-load': ['a'], wildcard: true }),
    ).toEqual({
      alwaysLoad: ['a'],
      wildcard: true,
      excluded: [],
    });
  });

  it('should handle deprecated mandatory fallback', () => {
    expect(normalizeSkillConfig({ mandatory: ['a'], wildcard: false })).toEqual(
      {
        alwaysLoad: ['a'],
        wildcard: false,
        excluded: [],
      },
    );
  });

  it('should prefer always-load over deprecated mandatory', () => {
    expect(
      normalizeSkillConfig({
        'always-load': ['new'],
        mandatory: ['old'],
        wildcard: false,
      }),
    ).toEqual({
      alwaysLoad: ['new'],
      wildcard: false,
      excluded: [],
    });
  });

  it('should handle object syntax with defaults', () => {
    expect(normalizeSkillConfig({})).toEqual({
      alwaysLoad: [],
      wildcard: false,
      excluded: [],
    });
  });
});
