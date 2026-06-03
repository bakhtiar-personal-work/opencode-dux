import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  deleteSessionEntries,
  flushTuiSnapshot,
  getTuiStatePath,
  mergedSessionTree,
  mergedSessionUsage,
  normalizeProjectDirectory,
  pruneStaleTuiSessionBundles,
  readTuiSnapshot,
  recordActiveSubscriptionForProvider,
  recordSessionDone,
  recordSessionNode,
  recordSessionProject,
  recordSessionTitle,
  recordSessionUsage,
  recordSessionUsagesBatch,
  recordSubscriptionUsage,
  removeSubscriptionUsageEntry,
  subscriptionUsageKey,
  syncOpenCodeStatusesIntoSessionTree,
  updateSnapshot,
} from './tui-state';

let previousXdgDataHome: string | undefined;
let tempDir: string;

beforeEach(() => {
  previousXdgDataHome = process.env.XDG_DATA_HOME;
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omos-tui-state-'));
  process.env.XDG_DATA_HOME = tempDir;
});

afterEach(() => {
  if (previousXdgDataHome === undefined) {
    delete process.env.XDG_DATA_HOME;
  } else {
    process.env.XDG_DATA_HOME = previousXdgDataHome;
  }

  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('subscriptionUsage', () => {
  test('recordSubscriptionUsage uses provider-scoped keys', () => {
    recordSubscriptionUsage([
      {
        provider: 'opencode-go',
        accountName: 'personal',
        workspaceId: 'wrk_123',
        fetchedAt: Date.now(),
      },
      {
        provider: 'neuralwatt',
        accountName: 'personal',
        snapshot_at: '',
        balance: {
          credits_remaining_usd: 0,
          total_credits_usd: 0,
          credits_used_usd: 0,
          accounting_method: 'energy',
        },
        usage: {
          lifetime: { cost_usd: 0, requests: 0, tokens: 0, energy_kwh: 0 },
          current_month: { cost_usd: 0, requests: 0, tokens: 0, energy_kwh: 0 },
        },
        subscription: null,
        fetchedAt: Date.now(),
      },
      {
        provider: 'deepseek',
        accountName: 'personal',
        fetchedAt: Date.now(),
        is_available: true,
        balance_infos: [
          {
            currency: 'USD',
            total_balance: '12.34',
            granted_balance: '2.34',
            topped_up_balance: '10.00',
          },
        ],
      },
    ]);

    const snapshot = readTuiSnapshot();
    expect(snapshot.subscriptionUsage).toHaveProperty(
      subscriptionUsageKey('opencode-go', 'personal'),
    );
    expect(snapshot.subscriptionUsage).toHaveProperty(
      subscriptionUsageKey('neuralwatt', 'personal'),
    );
    expect(snapshot.subscriptionUsage).toHaveProperty(
      subscriptionUsageKey('deepseek', 'personal'),
    );
  });

  test('recordSubscriptionUsage clears stale entries', () => {
    // First write two entries
    recordSubscriptionUsage([
      {
        provider: 'opencode-go',
        accountName: 'personal',
        workspaceId: 'wrk_123',
        fetchedAt: Date.now(),
        error: undefined,
      },
      {
        provider: 'opencode-go',
        accountName: 'work',
        workspaceId: 'wrk_456',
        fetchedAt: Date.now(),
        error: undefined,
      },
    ]);

    expect(readTuiSnapshot().subscriptionUsage).toHaveProperty(
      subscriptionUsageKey('opencode-go', 'personal'),
    );
    expect(readTuiSnapshot().subscriptionUsage).toHaveProperty(
      subscriptionUsageKey('opencode-go', 'work'),
    );

    // Now write only one entry - the other should be gone
    recordSubscriptionUsage([
      {
        provider: 'opencode-go',
        accountName: 'personal',
        workspaceId: 'wrk_123',
        fetchedAt: Date.now(),
        error: undefined,
      },
    ]);

    const snapshot = readTuiSnapshot();
    expect(snapshot.subscriptionUsage).toHaveProperty(
      subscriptionUsageKey('opencode-go', 'personal'),
    );
    expect(snapshot.subscriptionUsage).not.toHaveProperty(
      subscriptionUsageKey('opencode-go', 'work'),
    );
  });

  test('recordSubscriptionUsage handles empty array (clears all)', () => {
    recordSubscriptionUsage([
      {
        provider: 'opencode-go',
        accountName: 'personal',
        workspaceId: 'wrk_123',
        fetchedAt: Date.now(),
        error: undefined,
      },
    ]);
    expect(readTuiSnapshot().subscriptionUsage).toHaveProperty(
      subscriptionUsageKey('opencode-go', 'personal'),
    );

    // Empty array should clear everything
    recordSubscriptionUsage([]);
    expect(readTuiSnapshot().subscriptionUsage).toEqual({});
  });

  test('removeSubscriptionUsageEntry deletes a specific entry', () => {
    recordSubscriptionUsage([
      {
        provider: 'opencode-go',
        accountName: 'personal',
        workspaceId: 'wrk_123',
        fetchedAt: Date.now(),
        error: undefined,
      },
      {
        provider: 'opencode-go',
        accountName: 'work',
        workspaceId: 'wrk_456',
        fetchedAt: Date.now(),
        error: undefined,
      },
    ]);

    removeSubscriptionUsageEntry('opencode-go', 'personal');

    const snapshot = readTuiSnapshot();
    expect(snapshot.subscriptionUsage).not.toHaveProperty(
      subscriptionUsageKey('opencode-go', 'personal'),
    );
    expect(snapshot.subscriptionUsage).toHaveProperty(
      subscriptionUsageKey('opencode-go', 'work'),
    );
  });

  test('removeSubscriptionUsageEntry is idempotent for unknown names', () => {
    recordSubscriptionUsage([
      {
        provider: 'opencode-go',
        accountName: 'personal',
        workspaceId: 'wrk_123',
        fetchedAt: Date.now(),
        error: undefined,
      },
    ]);

    // Removing a name that doesn't exist should not throw
    expect(() =>
      removeSubscriptionUsageEntry('opencode-go', 'nonexistent'),
    ).not.toThrow();
    expect(readTuiSnapshot().subscriptionUsage).toHaveProperty(
      subscriptionUsageKey('opencode-go', 'personal'),
    );
  });
});

describe('activeSubscriptionByProvider', () => {
  test('recordActiveSubscriptionForProvider sets the field', () => {
    recordActiveSubscriptionForProvider('opencode-go', 'personal');
    expect(readTuiSnapshot().activeSubscriptionByProvider['opencode-go']).toBe(
      'personal',
    );
  });

  test('recordActiveSubscriptionForProvider clears with null', () => {
    recordActiveSubscriptionForProvider('opencode-go', 'personal');
    recordActiveSubscriptionForProvider('opencode-go', null);
    expect(readTuiSnapshot().activeSubscriptionByProvider['opencode-go']).toBe(
      undefined,
    );
  });

  test('recordActiveSubscriptionForProvider survives other snapshot updates', () => {
    recordActiveSubscriptionForProvider('deepseek', 'personal');
    // Write some other data - shouldn't affect active provider selection
    recordSessionNode({
      sessionID: 'sess-x',
      title: '',
      agent: 'explorer',
      status: 'busy',
    });
    expect(readTuiSnapshot().activeSubscriptionByProvider.deepseek).toBe(
      'personal',
    );
  });
});

describe('recordSessionTitle', () => {
  test('sets tree title when SDK reports a non-empty name', () => {
    recordSessionNode({
      sessionID: 'orch-1',
      title: '',
      agent: 'orchestrator',
      status: 'busy',
    });
    recordSessionTitle({ sessionID: 'orch-1', title: '  My task  ' });
    expect(mergedSessionTree(readTuiSnapshot())['orch-1']?.title).toBe(
      'My task',
    );
  });

  test('ignores empty title string', () => {
    recordSessionNode({
      sessionID: 'orch-2',
      title: 'kept',
      agent: 'orchestrator',
      status: 'busy',
    });
    recordSessionTitle({ sessionID: 'orch-2', title: '   ' });
    expect(mergedSessionTree(readTuiSnapshot())['orch-2']?.title).toBe('kept');
  });
});

describe('sessionUsage', () => {
  test('recordSessionUsage persists token telemetry per session', () => {
    recordSessionUsage({
      sessionID: 'session-123',
      contextUsed: 150_000,
      contextLimit: 400_000,
      contextPct: 37.5,
      input: 8_000,
      output: 900,
      reasoning: 200,
      cacheRead: 2_500,
      cacheWrite: 700,
    });

    const usage = mergedSessionUsage(readTuiSnapshot())['session-123'];
    expect(usage).toBeDefined();
    expect(usage?.contextUsed).toBe(150_000);
    expect(usage?.contextLimit).toBe(400_000);
    expect(usage?.contextPct).toBe(37.5);
    expect(usage?.input).toBe(8_000);
    expect(usage?.output).toBe(900);
    expect(usage?.reasoning).toBe(200);
    expect(usage?.cacheRead).toBe(2_500);
    expect(usage?.cacheWrite).toBe(700);
  });

  test('recomputes contextPct from used/limit on model switch (stale pct is ignored)', () => {
    recordSessionUsage({
      sessionID: 'session-model-switch',
      contextUsed: 170_000,
      contextLimit: 1_000_000,
      contextPct: 17,
      input: 10_000,
      output: 500,
      reasoning: 0,
      cacheRead: 100,
      cacheWrite: 50,
    });
    recordSessionUsage({
      sessionID: 'session-model-switch',
      contextUsed: 228_700,
      contextLimit: 262_144,
      contextPct: 17,
      input: 12_000,
      output: 600,
      reasoning: 0,
      cacheRead: 200,
      cacheWrite: 60,
    });
    const usage = mergedSessionUsage(readTuiSnapshot())['session-model-switch'];
    expect(usage?.contextUsed).toBe(228_700);
    expect(usage?.contextLimit).toBe(262_144);
    expect(usage?.contextPct).toBeCloseTo((228_700 / 262_144) * 100, 5);
  });

  test('context usage may decrease after compact; sigma context adds only non-negative deltas', () => {
    recordSessionNode({
      sessionID: 'orch-compact',
      title: 'orch',
      agent: 'orchestrator',
      status: 'busy',
    });
    recordSessionNode({
      sessionID: 'solo',
      title: 'solo',
      agent: 'explorer',
      parentId: 'orch-compact',
      status: 'busy',
    });
    recordSessionUsage({
      sessionID: 'solo',
      contextUsed: 50_000,
      contextLimit: 1_000_000,
      input: 10_000,
      output: 500,
      reasoning: 0,
      cacheRead: 1_000,
      cacheWrite: 100,
    });
    recordSessionUsage({
      sessionID: 'solo',
      contextUsed: 8_000,
      contextLimit: 262_144,
      input: 12_000,
      output: 600,
      reasoning: 0,
      cacheRead: 1_100,
      cacheWrite: 100,
    });
    const snap = readTuiSnapshot();
    expect(mergedSessionUsage(snap).solo?.contextUsed).toBe(8_000);
    expect(mergedSessionUsage(snap).solo?.contextLimit).toBe(262_144);
    expect(snap.sessions['orch-compact']?.orchestrationSigmaAccum).toEqual({
      contextUsed: 50_000,
      input: 12_000,
      output: 600,
      cacheRead: 1_100,
      cacheWrite: 100,
    });
  });

  test('accumulates orchestration sigma from per-session deltas and persists across idle', () => {
    recordSessionNode({
      sessionID: 'orch',
      title: 'orch',
      agent: 'orchestrator',
      status: 'busy',
    });
    recordSessionNode({
      sessionID: 'child-1',
      title: 'child-1',
      agent: 'explorer',
      parentId: 'orch',
      status: 'busy',
    });
    recordSessionNode({
      sessionID: 'child-2',
      title: 'child-2',
      agent: 'fixer',
      parentId: 'orch',
      status: 'busy',
    });

    recordSessionUsage({
      sessionID: 'child-1',
      contextUsed: 21_120,
      input: 20_000,
      output: 100,
      reasoning: 20,
      cacheRead: 1_000,
      cacheWrite: 400,
    });
    recordSessionUsage({
      sessionID: 'child-2',
      contextUsed: 20_730,
      input: 20_000,
      output: 200,
      reasoning: 30,
      cacheRead: 500,
      cacheWrite: 100,
    });
    recordSessionUsage({
      sessionID: 'child-1',
      contextUsed: 26_500,
      input: 25_000,
      output: 150,
      reasoning: 50,
      cacheRead: 1_300,
      cacheWrite: 500,
    });

    // Simulate the orchestration becoming idle/completed.
    recordSessionDone('child-1');
    recordSessionDone('child-2');
    recordSessionDone('orch');

    // New child under the same orchestrator session should keep accumulating.
    recordSessionNode({
      sessionID: 'child-3',
      title: 'child-3',
      agent: 'oracle',
      parentId: 'orch',
      status: 'busy',
    });
    recordSessionUsage({
      sessionID: 'child-3',
      contextUsed: 20_810,
      input: 20_000,
      output: 100,
      reasoning: 10,
      cacheRead: 700,
      cacheWrite: 200,
    });

    const snapshot = readTuiSnapshot();
    expect(snapshot.sessions.orch?.orchestrationSigmaAccum).toEqual({
      contextUsed: 68_040,
      input: 65_000,
      output: 450,
      cacheRead: 2_500,
      cacheWrite: 800,
    });
    expect(
      snapshot.sessions.orch?.orchestrationUsageLastSeen['child-1'],
    ).toEqual({
      contextUsed: 26_500,
      input: 25_000,
      output: 150,
      cacheRead: 1_300,
      cacheWrite: 500,
    });
  });

  test('deleteSessionEntries removes child nodes from tree and cascades bundle on root delete', () => {
    recordSessionNode({
      sessionID: 'orch',
      title: 'orch',
      agent: 'orchestrator',
      status: 'busy',
    });
    recordSessionNode({
      sessionID: 'child-1',
      title: 'child-1',
      agent: 'explorer',
      parentId: 'orch',
      status: 'busy',
    });
    recordSessionUsage({
      sessionID: 'child-1',
      contextUsed: 1_065,
      input: 1_000,
      output: 10,
      reasoning: 5,
      cacheRead: 50,
      cacheWrite: 10,
    });
    expect(
      readTuiSnapshot().sessions.orch?.orchestrationSigmaAccum,
    ).toBeDefined();

    deleteSessionEntries('child-1');
    expect(
      readTuiSnapshot().sessions.orch?.orchestrationUsageLastSeen['child-1'],
    ).toBeUndefined();
    expect(readTuiSnapshot().sessions.orch?.tree['child-1']).toBeUndefined();
    expect(readTuiSnapshot().sessions.orch?.tree.orch?.childIds).toEqual([]);
    expect(
      readTuiSnapshot().sessions.orch?.orchestrationSigmaAccum,
    ).toBeDefined();

    deleteSessionEntries('orch');
    expect(readTuiSnapshot().sessions.orch).toBeUndefined();
  });
});

describe('pruneStaleTuiSessionBundles', () => {
  test('removes bundle when every tree id is absent from OpenCode and project matches', () => {
    const projectDir = normalizeProjectDirectory(tempDir);
    recordSessionProject({ sessionID: 'root-del', projectPath: tempDir });
    recordSessionNode({
      sessionID: 'root-del',
      title: '',
      agent: 'orchestrator',
      status: 'idle',
    });
    recordSessionNode({
      sessionID: 'child-del',
      title: '',
      agent: 'explorer',
      parentId: 'root-del',
      status: 'idle',
    });

    expect(readTuiSnapshot().sessions['root-del']).toBeDefined();

    updateSnapshot((s) => {
      pruneStaleTuiSessionBundles(s, {
        opencodeIds: new Set(['ses_still_live']),
        currentProjectDir: projectDir,
        now: Date.now(),
      });
    });

    expect(readTuiSnapshot().sessions['root-del']).toBeUndefined();
  });

  test('keeps bundle when project path does not match workspace', () => {
    const otherDir = path.join(tempDir, 'other-ws');
    fs.mkdirSync(otherDir, { recursive: true });
    const workspaceDir = normalizeProjectDirectory(tempDir);
    recordSessionProject({ sessionID: 'root-x', projectPath: otherDir });
    recordSessionNode({
      sessionID: 'root-x',
      title: '',
      agent: 'orchestrator',
      status: 'idle',
    });

    updateSnapshot((s) => {
      pruneStaleTuiSessionBundles(s, {
        opencodeIds: new Set(['nostale']),
        currentProjectDir: workspaceDir,
        now: Date.now(),
      });
    });

    expect(readTuiSnapshot().sessions['root-x']).toBeDefined();
  });

  test('does not remove bundles when opencodeIds is empty', () => {
    const projectDir = normalizeProjectDirectory(tempDir);
    recordSessionProject({ sessionID: 'root-k', projectPath: tempDir });
    recordSessionNode({
      sessionID: 'root-k',
      title: '',
      agent: 'orchestrator',
      status: 'idle',
    });

    updateSnapshot((s) => {
      pruneStaleTuiSessionBundles(s, {
        opencodeIds: new Set(),
        currentProjectDir: projectDir,
        now: Date.now(),
      });
    });

    expect(readTuiSnapshot().sessions['root-k']).toBeDefined();
  });

  test('soft-prunes subtree when only some ids are missing from OpenCode', () => {
    const projectDir = normalizeProjectDirectory(tempDir);
    recordSessionProject({ sessionID: 'root-p', projectPath: tempDir });
    recordSessionNode({
      sessionID: 'root-p',
      title: '',
      agent: 'orchestrator',
      status: 'busy',
    });
    recordSessionNode({
      sessionID: 'gone-child',
      title: '',
      agent: 'explorer',
      parentId: 'root-p',
      status: 'busy',
    });
    recordSessionUsage({
      sessionID: 'gone-child',
      contextUsed: 100,
      contextLimit: 400,
      contextPct: 25,
      input: 10,
      output: 5,
      reasoning: 0,
      cacheRead: 0,
      cacheWrite: 0,
    });

    updateSnapshot((s) => {
      pruneStaleTuiSessionBundles(s, {
        opencodeIds: new Set(['root-p']),
        currentProjectDir: projectDir,
        now: Date.now(),
      });
    });

    const snap = readTuiSnapshot();
    expect(snap.sessions['root-p']).toBeDefined();
    const gone = snap.sessions['root-p']?.tree['gone-child'];
    expect(gone?.status).toBe('idle');
    expect(gone?.usage).toBeUndefined();
  });

  test('second soft-prune does not bump finishedAt on already-idle ghost child', () => {
    const projectDir = normalizeProjectDirectory(tempDir);
    recordSessionProject({ sessionID: 'root-ghost2', projectPath: tempDir });
    recordSessionNode({
      sessionID: 'root-ghost2',
      title: '',
      agent: 'orchestrator',
      status: 'busy',
    });
    recordSessionNode({
      sessionID: 'ghost-child-2',
      title: '',
      agent: 'explorer',
      parentId: 'root-ghost2',
      status: 'busy',
    });

    const opencode = new Set(['root-ghost2']);

    updateSnapshot((s) => {
      pruneStaleTuiSessionBundles(s, {
        opencodeIds: opencode,
        currentProjectDir: projectDir,
        now: Date.now(),
      });
    });

    const afterFirst =
      readTuiSnapshot().sessions['root-ghost2']?.tree['ghost-child-2'];
    expect(afterFirst?.status).toBe('idle');
    const t1 = afterFirst?.finishedAt;
    expect(t1).toBeDefined();

    updateSnapshot((s) => {
      pruneStaleTuiSessionBundles(s, {
        opencodeIds: opencode,
        currentProjectDir: projectDir,
        now: Date.now(),
      });
    });

    const afterSecond =
      readTuiSnapshot().sessions['root-ghost2']?.tree['ghost-child-2'];
    expect(afterSecond?.finishedAt).toBe(t1);
  });

  test('does not soft-prune child still listed in OpenCode when parent missing from poll', () => {
    const projectDir = normalizeProjectDirectory(tempDir);
    recordSessionProject({ sessionID: 'root-flicker', projectPath: tempDir });
    recordSessionNode({
      sessionID: 'root-flicker',
      title: '',
      agent: 'orchestrator',
      status: 'busy',
    });
    recordSessionNode({
      sessionID: 'child-flicker',
      title: '',
      agent: 'explorer',
      parentId: 'root-flicker',
      status: 'busy',
    });

    updateSnapshot((s) => {
      syncOpenCodeStatusesIntoSessionTree(s, {
        'child-flicker': { type: 'busy' },
      });
      pruneStaleTuiSessionBundles(s, {
        opencodeIds: new Set(['child-flicker']),
        currentProjectDir: projectDir,
        now: Date.now(),
      });
    });

    const snap = readTuiSnapshot();
    expect(snap.sessions['root-flicker']?.tree['child-flicker']?.status).toBe(
      'busy',
    );
    const parent = snap.sessions['root-flicker']?.tree['root-flicker'];
    expect(parent?.status).toBe('busy');
    expect(parent?.finishedAt).toBeUndefined();
  });

  test('keeps orchestration sigma when orchestrator row missing from poll but child listed', () => {
    const projectDir = normalizeProjectDirectory(tempDir);
    recordSessionProject({ sessionID: 'root-sigma', projectPath: tempDir });
    recordSessionNode({
      sessionID: 'root-sigma',
      title: '',
      agent: 'orchestrator',
      status: 'busy',
    });
    recordSessionNode({
      sessionID: 'child-sigma',
      title: '',
      agent: 'explorer',
      parentId: 'root-sigma',
      status: 'busy',
    });
    recordSessionUsage({
      sessionID: 'child-sigma',
      contextUsed: 100,
      contextLimit: 400,
      contextPct: 25,
      input: 50,
      output: 20,
      reasoning: 0,
      cacheRead: 0,
      cacheWrite: 0,
    });

    expect(
      readTuiSnapshot().sessions['root-sigma']?.orchestrationSigmaAccum?.input,
    ).toBe(50);

    updateSnapshot((s) => {
      syncOpenCodeStatusesIntoSessionTree(s, {
        'child-sigma': { type: 'busy' },
      });
      pruneStaleTuiSessionBundles(s, {
        opencodeIds: new Set(['child-sigma']),
        currentProjectDir: projectDir,
        now: Date.now(),
      });
    });

    const snap = readTuiSnapshot();
    expect(snap.sessions['root-sigma']?.orchestrationSigmaAccum?.input).toBe(
      50,
    );
    expect(snap.sessions['root-sigma']?.tree['root-sigma']?.status).toBe(
      'busy',
    );
  });
});

describe('tui-state concurrent persistence', () => {
  test('microtask storm of recordSessionUsage retains all sessions and sigma', async () => {
    recordSessionNode({
      sessionID: 'storm-orch',
      title: '',
      agent: 'orchestrator',
      status: 'busy',
    });
    const n = 12;
    for (let i = 0; i < n; i++) {
      recordSessionNode({
        sessionID: `storm-child-${i}`,
        title: '',
        agent: 'explorer',
        parentId: 'storm-orch',
        status: 'busy',
      });
    }

    await Promise.all(
      Array.from({ length: n }, (_, i) =>
        Promise.resolve().then(() =>
          recordSessionUsage({
            sessionID: `storm-child-${i}`,
            contextUsed: 50 + i,
            contextLimit: 200,
            contextPct: 25,
            input: 10 + i,
            output: 5,
            reasoning: 0,
            cacheRead: 0,
            cacheWrite: 0,
          }),
        ),
      ),
    );
    await flushTuiSnapshot();

    const snap = readTuiSnapshot();
    const bundle = snap.sessions['storm-orch'];
    expect(bundle).toBeDefined();

    let expectedInput = 0;
    for (let i = 0; i < n; i++) {
      const node = bundle?.tree[`storm-child-${i}`];
      expect(node).toBeDefined();
      expect(node?.usage?.input).toBe(10 + i);
      expectedInput += 10 + i;
    }

    expect(bundle?.orchestrationSigmaAccum?.input).toBe(expectedInput);
  });

  test('recordSessionUsagesBatch applies all rows in one write', () => {
    recordSessionNode({
      sessionID: 'orch-b',
      title: '',
      agent: 'orchestrator',
      status: 'busy',
    });
    recordSessionNode({
      sessionID: 'b1',
      title: '',
      agent: 'explorer',
      parentId: 'orch-b',
      status: 'busy',
    });
    recordSessionNode({
      sessionID: 'b2',
      title: '',
      agent: 'librarian',
      parentId: 'orch-b',
      status: 'busy',
    });

    recordSessionUsagesBatch([
      {
        sessionID: 'b1',
        contextUsed: 40,
        contextLimit: 200,
        contextPct: 20,
        input: 20,
        output: 10,
        reasoning: 0,
        cacheRead: 0,
        cacheWrite: 0,
      },
      {
        sessionID: 'b2',
        contextUsed: 60,
        contextLimit: 200,
        contextPct: 30,
        input: 30,
        output: 15,
        reasoning: 0,
        cacheRead: 0,
        cacheWrite: 0,
      },
    ]);

    const snap = readTuiSnapshot();
    expect(mergedSessionUsage(snap).b1?.input).toBe(20);
    expect(mergedSessionUsage(snap).b2?.input).toBe(30);
    expect(snap.sessions['orch-b']?.orchestrationSigmaAccum?.input).toBe(50);
  });
});

describe('tui-state file safety', () => {
  test('does not clobber existing file when state json is malformed', () => {
    const filePath = getTuiStatePath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, '{ malformed json');

    recordSessionNode({
      sessionID: 'sess-x',
      title: '',
      agent: 'explorer',
      status: 'busy',
    });

    expect(fs.readFileSync(filePath, 'utf8')).toBe('{ malformed json');
  });
});
