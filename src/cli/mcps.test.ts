import { describe, expect, it } from 'bun:test';
import { getMcpPermissionsForAgent } from './mcps';

describe('MCP permissions', () => {
  it('should allow all MCPs by default', async () => {
    const permissions = await getMcpPermissionsForAgent('oracle');
    expect(permissions['*']).toBe('allow');
  });

  it('should handle empty array', async () => {
    const permissions = await getMcpPermissionsForAgent('oracle', []);
    expect(permissions['*']).toBe('deny');
  });

  it('should handle explicit MCP list', async () => {
    const permissions = await getMcpPermissionsForAgent('oracle', [
      'websearch',
      'context7',
    ]);
    expect(permissions['*']).toBe('deny');
    expect(permissions.websearch).toBe('allow');
    expect(permissions.context7).toBe('allow');
    expect(permissions.grep_app).toBeUndefined();
  });

  it('should handle wildcard in array', async () => {
    const permissions = await getMcpPermissionsForAgent('oracle', ['*']);
    expect(permissions['*']).toBe('allow');
  });

  it('should handle exclusion in array', async () => {
    const permissions = await getMcpPermissionsForAgent('oracle', [
      '*',
      '!grep_app',
    ]);
    expect(permissions['*']).toBe('allow');
    expect(permissions.grep_app).toBe('deny');
  });

  it('should handle object syntax with always-load', async () => {
    const permissions = await getMcpPermissionsForAgent('oracle', {
      'always-load': ['websearch'],
    });
    expect(permissions['*']).toBe('deny');
    expect(permissions.websearch).toBe('allow');
  });

  it('should handle deprecated mandatory fallback', async () => {
    const permissions = await getMcpPermissionsForAgent('oracle', {
      mandatory: ['websearch'],
    });
    expect(permissions['*']).toBe('deny');
    expect(permissions.websearch).toBe('allow');
  });

  it('should handle object syntax with wildcard', async () => {
    const permissions = await getMcpPermissionsForAgent('oracle', {
      wildcard: true,
    });
    expect(permissions['*']).toBe('allow');
  });
});
