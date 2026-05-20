import { describe, expect, test } from 'bun:test';
import {
  aggregateOrchestrationUsage,
  formatDuration,
  formatSessionUsageRows,
  formatSidebarModelAndVariant,
  formatSidebarModelName,
  formatTokenAbbrev,
  formatTokenAbbrevDecimal,
  getSidebarAgentNames,
} from './tui';
import type {
  SessionUsageEntry,
  TuiSessionBundle,
  TuiSnapshot,
} from './tui-state';

function bundleFixture(
  rootSessionId: string,
  overrides: Partial<TuiSessionBundle> & Pick<TuiSessionBundle, 'tree'>,
): TuiSessionBundle {
  return {
    rootSessionId,
    lastActivityAt: overrides.lastActivityAt ?? 0,
    projectPath: overrides.projectPath,
    tree: overrides.tree,
    orchestrationSigmaAccum: overrides.orchestrationSigmaAccum,
    orchestrationUsageLastSeen: overrides.orchestrationUsageLastSeen ?? {},
  };
}

function createSnapshot(): TuiSnapshot {
  return {
    version: 6,
    updatedAt: 0,
    sessions: {},
    subscriptionUsage: {},
    activeSubscriptionByProvider: {},
  };
}

describe('tui sidebar agents', () => {
  test('lists agents that have sidebar description entries', () => {
    const agentNames = getSidebarAgentNames(createSnapshot());

    expect(agentNames).toContain('explorer');
    expect(agentNames).toContain('fixer');
    expect(agentNames).toContain('orchestrator');
    expect(agentNames).not.toContain('nonexistent-agent');
  });

  test('sorts sidebar agents using AGENT_SORT_PRIORITY', () => {
    const agentNames = getSidebarAgentNames(createSnapshot());
    expect(agentNames.indexOf('orchestrator')).toBeLessThan(
      agentNames.indexOf('explorer'),
    );
  });
});

describe('formatSidebarModelName', () => {
  test('keeps only the segment after the last slash', () => {
    expect(formatSidebarModelName('openai/gpt-5.5-fast')).toBe('gpt-5.5-fast');
    expect(
      formatSidebarModelName(
        'fireworks-ai/accounts/fireworks/routers/kimi-k2p5-turbo',
      ),
    ).toBe('kimi-k2p5-turbo');
  });

  test('leaves model names without slashes unchanged', () => {
    expect(formatSidebarModelName('pending')).toBe('pending');
  });
});

describe('formatSidebarModelAndVariant', () => {
  test('long basename stacks hyphen segments then ellipsis; variant stays full', () => {
    expect(
      formatSidebarModelAndVariant('opencode/Qwen3.5-397B-A17B-FP8', 'High'),
    ).toBe('Qwen3.5-397B-A17B… - High');
  });

  test('long basename without OpenCode variant uses segment ellipsis only', () => {
    expect(
      formatSidebarModelAndVariant('opencode/Qwen3.5-397B-A17B-FP8', undefined),
    ).toBe('Qwen3.5-397B-A17B…');
  });

  test('smaller maxModelDisplayLen yields a shorter hyphen-safe prefix', () => {
    expect(
      formatSidebarModelAndVariant(
        'opencode/Qwen3.5-397B-A17B-FP8',
        'High',
        14,
      ),
    ).toBe('Qwen3.5-397B… - High');
  });

  test('larger cap fits full basename before OpenCode variant', () => {
    expect(
      formatSidebarModelAndVariant(
        'opencode/Qwen3.5-397B-A17B-FP8',
        'High',
        28,
      ),
    ).toBe('Qwen3.5-397B-A17B-FP8 - High');
  });

  test('short basenames show full id; variant appended', () => {
    expect(formatSidebarModelAndVariant('openai/gpt-4o', 'High')).toBe(
      'gpt-4o - High',
    );
    expect(formatSidebarModelAndVariant('openai/gpt-4o', undefined)).toBe(
      'gpt-4o',
    );
  });

  test('long basename without hyphen falls back to character truncate', () => {
    const long = 'abcdefghijklmnopqrstu';
    expect(formatSidebarModelAndVariant(`x/${long}`, undefined)).toBe(
      'abcdefghijklmnopqrs…',
    );
  });
});

describe('formatDuration', () => {
  test('formats milliseconds as MM:SS under 1 hour', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(1_000)).toBe('0:01');
    expect(formatDuration(60_000)).toBe('1:00');
    expect(formatDuration(699_000)).toBe('11:39');
    expect(formatDuration(3_599_000)).toBe('59:59');
  });

  test('formats as H:MM:SS for 1 hour or more', () => {
    expect(formatDuration(3_600_000)).toBe('1:00:00');
    expect(formatDuration(5_019_000)).toBe('1:23:39');
    expect(formatDuration(7_200_000)).toBe('2:00:00');
    expect(formatDuration(86_400_000)).toBe('24:00:00');
  });

  test('handles edge cases', () => {
    expect(formatDuration(-1)).toBe('0:00');
    expect(formatDuration(Infinity)).toBe('0:00');
    expect(formatDuration(NaN)).toBe('0:00');
  });
});

describe('orchestrating usage metrics formatters', () => {
  test('abbreviates token counts for sidebar rows', () => {
    expect(formatTokenAbbrev(950)).toBe('950');
    expect(formatTokenAbbrev(1_500)).toBe('2K');
    expect(formatTokenAbbrev(8_200)).toBe('8K');
    expect(formatTokenAbbrev(150_000)).toBe('150K');
    expect(formatTokenAbbrev(999_500)).toBe('1M');
    expect(formatTokenAbbrev(1_150_000)).toBe('1M');
    expect(formatTokenAbbrev(1_500_000)).toBe('2M');
  });

  test('abbreviates with 1 decimal for context used values', () => {
    expect(formatTokenAbbrevDecimal(100)).toBe('100');
    expect(formatTokenAbbrevDecimal(999)).toBe('999');
    expect(formatTokenAbbrevDecimal(1_000)).toBe('1.0K');
    expect(formatTokenAbbrevDecimal(1_100)).toBe('1.1K');
    expect(formatTokenAbbrevDecimal(8_200)).toBe('8.2K');
    expect(formatTokenAbbrevDecimal(150_000)).toBe('150.0K');
    expect(formatTokenAbbrevDecimal(999_000)).toBe('999.0K');
    expect(formatTokenAbbrevDecimal(1_200_000)).toBe('1.2M');
    expect(formatTokenAbbrevDecimal(1_500_000)).toBe('1.5M');
  });

  test('formats context/input/output/cache rows for a session', () => {
    const snapshot = createSnapshot();
    snapshot.sessions['session-1'] = bundleFixture('session-1', {
      tree: {
        'session-1': {
          title: '',
          agent: 'explorer',
          model: '',
          childIds: [],
          status: 'busy',
          createdAt: 0,
          usage: {
            contextUsed: 150_000,
            contextLimit: 400_000,
            contextPct: 38,
            input: 8_000,
            output: 900,
            reasoning: 200,
            cacheRead: 200,
            cacheWrite: 300,
            updatedAt: 0,
          },
        },
      },
    });

    expect(formatSessionUsageRows(snapshot, 'session-1')).toEqual({
      contextPct: 38,
      ctxLabel: 'CTX',
      ctxValue: '150,000/400,000 (38%)',
      ioInputAbbrev: '8K',
      ioOutputAbbrev: '900',
      cacheLabel: 'CACHE',
      cacheValue: '500',
      cacheReadAbbrev: '200',
      cacheWriteAbbrev: '300',
    });
  });

  test('formats context with different abbreviation styles when abbreviateLeft is true', () => {
    const snapshot = createSnapshot();
    snapshot.sessions['session-1'] = bundleFixture('session-1', {
      tree: {
        'session-1': {
          title: '',
          agent: 'explorer',
          model: '',
          childIds: [],
          status: 'busy',
          createdAt: 0,
          usage: {
            contextUsed: 150_000,
            contextLimit: 400_000,
            contextPct: 38,
            input: 8_000,
            output: 900,
            reasoning: 200,
            cacheRead: 200,
            cacheWrite: 300,
            updatedAt: 0,
          },
        },
      },
    });

    expect(
      formatSessionUsageRows(snapshot, 'session-1', { abbreviateLeft: true }),
    ).toEqual({
      contextPct: 38,
      ctxLabel: 'CTX',
      ctxValue: '150.0K/400K (38%)',
      ioInputAbbrev: '8K',
      ioOutputAbbrev: '900',
      cacheLabel: 'CACHE',
      cacheValue: '500',
      cacheReadAbbrev: '200',
      cacheWriteAbbrev: '300',
    });
  });

  test('aggregates totals across orchestrator and descendants', () => {
    const orchUsage: SessionUsageEntry = {
      contextUsed: 0,
      contextLimit: 0,
      contextPct: 0,
      input: 1_000,
      output: 200,
      reasoning: 50,
      cacheRead: 100,
      cacheWrite: 20,
      updatedAt: 0,
    };
    const childAUsage: SessionUsageEntry = {
      contextUsed: 0,
      contextLimit: 0,
      contextPct: 0,
      input: 2_000,
      output: 400,
      reasoning: 80,
      cacheRead: 300,
      cacheWrite: 40,
      updatedAt: 0,
    };
    const childBUsage: SessionUsageEntry = {
      contextUsed: 0,
      contextLimit: 0,
      contextPct: 0,
      input: 500,
      output: 120,
      reasoning: 30,
      cacheRead: 50,
      cacheWrite: 10,
      updatedAt: 0,
    };
    const tree = {
      orch: {
        title: 'orch',
        agent: 'orchestrator',
        model: 'openai/gpt-5',
        childIds: [],
        status: 'busy',
        createdAt: 0,
        usage: orchUsage,
      },
      childA: {
        title: 'childA',
        agent: 'explorer',
        model: 'openai/gpt-5-mini',
        parentId: 'orch',
        childIds: [],
        status: 'busy',
        createdAt: 0,
        usage: childAUsage,
      },
      childB: {
        title: 'childB',
        agent: 'oracle',
        model: 'openai/gpt-5',
        parentId: 'childA',
        childIds: [],
        status: 'busy',
        createdAt: 0,
        usage: childBUsage,
      },
    };
    const snapshot = createSnapshot();
    snapshot.sessions.orch = bundleFixture('orch', {
      tree,
      orchestrationSigmaAccum: {
        contextUsed: 15_200,
        input: 12_000,
        output: 2_000,
        cacheRead: 800,
        cacheWrite: 120,
      },
    });

    expect(aggregateOrchestrationUsage(snapshot, 'orch')).toEqual({
      inputTotal: 12_000,
      outputTotal: 2_000,
      cacheRead: 800,
      cacheWrite: 120,
      contextUsed: 15_200,
    });
  });
});
