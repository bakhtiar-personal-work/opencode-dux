import { describe, expect, test } from 'bun:test';
import type { TuiSnapshot } from '../../tui-state';
import { SLIM_INTERNAL_INITIATOR_MARKER } from '../../utils';
import {
  applyContextPressureReminder,
  CONTEXT_PRESSURE_HEADING,
} from './index';

function snapshotWithOrchestratorUsage(
  sessionID: string,
  contextUsed: number,
  contextLimit: number,
): TuiSnapshot {
  return {
    version: 6,
    updatedAt: Date.now(),
    sessions: {
      bundle: {
        rootSessionId: 'bundle',
        lastActivityAt: Date.now(),
        tree: {
          [sessionID]: {
            title: 'orch',
            agent: 'orchestrator',
            model: 'anthropic/claude-sonnet',
            childIds: [],
            status: 'idle',
            usage: {
              contextUsed,
              contextLimit,
              contextPct: (contextUsed / contextLimit) * 100,
              input: 0,
              output: 0,
              reasoning: 0,
              cacheRead: 0,
              cacheWrite: 0,
              updatedAt: Date.now(),
            },
          },
        },
        orchestrationUsageLastSeen: {},
      },
    },
    subscriptionUsage: {},
    activeSubscriptionByProvider: {},
  };
}

describe('applyContextPressureReminder', () => {
  test('appends reminder when context is at threshold', () => {
    const sid = 'main-orchestrator';
    const snap = snapshotWithOrchestratorUsage(sid, 220_000, 262_144);
    const messages = [
      {
        info: { role: 'user' as const, agent: 'orchestrator', sessionID: sid },
        parts: [{ type: 'text' as const, text: 'next step' }],
      },
    ];

    applyContextPressureReminder(messages, snap, {
      enabled: true,
      warnThresholdPct: 75,
    });

    expect(messages[0].parts[0].text).toContain(CONTEXT_PRESSURE_HEADING);
    expect(messages[0].parts[0].text).toContain('/compact');
    expect(messages[0].parts[0].text).toMatch(/84%/);
  });

  test('skips when below threshold', () => {
    const sid = 's1';
    const snap = snapshotWithOrchestratorUsage(sid, 190_000, 262_144);
    const messages = [
      {
        info: { role: 'user' as const, agent: 'orchestrator', sessionID: sid },
        parts: [{ type: 'text' as const, text: 'ok' }],
      },
    ];

    applyContextPressureReminder(messages, snap, {
      enabled: true,
      warnThresholdPct: 75,
    });

    expect(messages[0].parts[0].text).toBe('ok');
  });

  test('respects enabled false', () => {
    const sid = 's2';
    const snap = snapshotWithOrchestratorUsage(sid, 260_000, 262_144);
    const messages = [
      {
        info: { role: 'user' as const, agent: 'orchestrator', sessionID: sid },
        parts: [{ type: 'text' as const, text: 'x' }],
      },
    ];

    applyContextPressureReminder(messages, snap, {
      enabled: false,
      warnThresholdPct: 75,
    });

    expect(messages[0].parts[0].text).toBe('x');
  });

  test('skips non-orchestrator last user message', () => {
    const sid = 's3';
    const snap = snapshotWithOrchestratorUsage(sid, 260_000, 262_144);
    const messages = [
      {
        info: { role: 'user' as const, agent: 'explorer', sessionID: sid },
        parts: [{ type: 'text' as const, text: 'find X' }],
      },
    ];

    applyContextPressureReminder(messages, snap, {
      enabled: true,
      warnThresholdPct: 75,
    });

    expect(messages[0].parts[0].text).toBe('find X');
  });

  test('skips without sessionID', () => {
    const sid = 's4';
    const snap = snapshotWithOrchestratorUsage(sid, 260_000, 262_144);
    const messages = [
      {
        info: { role: 'user' as const, agent: 'orchestrator' },
        parts: [{ type: 'text' as const, text: 'y' }],
      },
    ];

    applyContextPressureReminder(messages, snap, {
      enabled: true,
      warnThresholdPct: 75,
    });

    expect(messages[0].parts[0].text).toBe('y');
  });

  test('does not mutate internal notification turns', () => {
    const sid = 's5';
    const snap = snapshotWithOrchestratorUsage(sid, 260_000, 262_144);
    const text = `[Background task "x" completed]\n${SLIM_INTERNAL_INITIATOR_MARKER}`;
    const messages = [
      {
        info: { role: 'user' as const, agent: 'orchestrator', sessionID: sid },
        parts: [{ type: 'text' as const, text }],
      },
    ];

    applyContextPressureReminder(messages, snap, {
      enabled: true,
      warnThresholdPct: 75,
    });

    expect(messages[0].parts[0].text).toBe(text);
  });

  test('does not duplicate reminder', () => {
    const sid = 's6';
    const snap = snapshotWithOrchestratorUsage(sid, 260_000, 262_144);
    const prior = `hello\n\n---\n\n${CONTEXT_PRESSURE_HEADING}\n\nstub`;
    const messages = [
      {
        info: { role: 'user' as const, agent: 'orchestrator', sessionID: sid },
        parts: [{ type: 'text' as const, text: prior }],
      },
    ];

    applyContextPressureReminder(messages, snap, {
      enabled: true,
      warnThresholdPct: 75,
    });

    expect(messages[0].parts[0].text).toBe(prior);
  });
});
