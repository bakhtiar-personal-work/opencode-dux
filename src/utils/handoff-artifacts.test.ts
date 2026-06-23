import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  extractArtifactPathsFromPrompt,
  getHandoffArtifactCacheDir,
  HandoffArtifactStore,
  slugifyArtifactPurpose,
} from './handoff-artifacts';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-artifacts-'));
  tempDirs.push(dir);
  return dir;
}

describe('slugifyArtifactPurpose', () => {
  test('normalizes readable slugs', () => {
    expect(slugifyArtifactPurpose('Fix auth bug in login flow')).toBe(
      'fix-auth-bug-in-login-flow',
    );
  });

  test('falls back for non-ascii-only labels', () => {
    expect(slugifyArtifactPurpose('日本語')).toBe('artifact');
  });
});

describe('extractArtifactPathsFromPrompt', () => {
  test('extracts referenced artifact paths from prompt text', () => {
    const prompt =
      'Use `.opencode-dux/oracle/a.md` and .opencode-dux/designer/b.md before editing.';
    expect(extractArtifactPathsFromPrompt(prompt)).toEqual([
      '.opencode-dux/oracle/a.md',
      '.opencode-dux/designer/b.md',
    ]);
  });

  test('extracts absolute artifact paths from structured prompt lines', () => {
    const prompt = [
      '- Artifact: C:/Users/Test/AppData/Local/opencode-dux/artifacts/oracle/a.md',
      '- Orchestrator index: /tmp/opencode-dux/artifacts/orchestrator/parent.md',
    ].join('\n');
    expect(extractArtifactPathsFromPrompt(prompt)).toEqual([
      'C:/Users/Test/AppData/Local/opencode-dux/artifacts/oracle/a.md',
      '/tmp/opencode-dux/artifacts/orchestrator/parent.md',
    ]);
  });
});

describe('HandoffArtifactStore', () => {
  test('creates readable artifact filenames and appends resumed turns', () => {
    const workspace = makeTempDir();
    let now = new Date('2026-06-02T03:04:05.000Z');
    const store = new HandoffArtifactStore(workspace, {
      now: () => now,
    });

    const first = store.seedArtifact({
      agent: 'oracle',
      childSessionId: 'child-1',
      parentSessionId: 'parent-1',
      model: 'test/oracle',
      variant: 'high',
      mode: 'blocking',
      purpose: 'Fix auth bug in login flow',
      promptText: 'Fix auth bug in login flow',
      referencedArtifactPaths: ['.opencode-dux/explorer/search.md'],
    });

    expect(first.artifactPath).toBe(
      '.opencode-dux/oracle/child-1_20260602-030405_fix-auth-bug-in-login-flow.md',
    );
    expect(first.indexPath).toBe('.opencode-dux/orchestrator/parent-1.md');

    store.appendTurn({
      childSessionId: 'child-1',
      outputText: '<plan>Step 1</plan>',
      inlineSections: ['<plan>Step 1</plan>'],
      status: 'completed',
    });

    now = new Date('2026-06-02T03:05:05.000Z');
    const second = store.seedArtifact({
      agent: 'oracle',
      childSessionId: 'child-1',
      parentSessionId: 'parent-1',
      model: 'test/oracle',
      variant: 'high',
      mode: 'blocking',
      purpose: 'Fix auth bug in login flow',
      promptText: 'Continue auth bug work',
    });

    expect(second.artifactPath).toBe(first.artifactPath);

    store.appendTurn({
      childSessionId: 'child-1',
      outputText: '<plan>Step 2</plan>',
      inlineSections: ['<plan>Step 2</plan>'],
      status: 'needs_user',
    });

    const artifactBody = fs.readFileSync(
      path.join(workspace, first.artifactPath),
      'utf8',
    );
    expect(artifactBody).toContain('## Turn 1');
    expect(artifactBody).toContain('## Turn 2');
    expect(artifactBody).toContain('.opencode-dux/explorer/search.md');
    expect(artifactBody).toContain('Latest Status: needs_user');
  });

  test('groups multiple child sessions under one orchestrator index', () => {
    const workspace = makeTempDir();
    const store = new HandoffArtifactStore(workspace, {
      now: () => new Date('2026-06-02T03:04:05.000Z'),
    });

    const a = store.seedArtifact({
      agent: 'oracle',
      childSessionId: 'oracle-1',
      parentSessionId: 'parent-1',
      model: 'test/oracle',
      mode: 'blocking',
      purpose: 'First oracle pass',
      promptText: 'First oracle pass',
    });
    const b = store.seedArtifact({
      agent: 'oracle',
      childSessionId: 'oracle-2',
      parentSessionId: 'parent-1',
      model: 'test/oracle',
      mode: 'blocking',
      purpose: 'Second oracle pass',
      promptText: 'Second oracle pass',
    });

    expect(a.indexPath).toBe(b.indexPath);
    expect(a.artifactPath).not.toBe(b.artifactPath);

    const indexBody = fs.readFileSync(
      path.join(workspace, a.indexPath),
      'utf8',
    );
    expect(indexBody).toContain('oracle-1');
    expect(indexBody).toContain('oracle-2');
  });

  test('prunes expired files only inside .opencode-dux', () => {
    const workspace = makeTempDir();
    const outsidePath = path.join(workspace, 'keep-me.md');
    fs.writeFileSync(outsidePath, 'outside');

    const root = path.join(workspace, '.opencode-dux', 'oracle');
    fs.mkdirSync(root, { recursive: true });
    const oldFile = path.join(root, 'old.md');
    fs.writeFileSync(oldFile, 'old');
    const oldMs = new Date('2026-05-01T00:00:00.000Z').getTime() / 1000;
    fs.utimesSync(oldFile, oldMs, oldMs);

    const store = new HandoffArtifactStore(workspace, {
      now: () => new Date('2026-06-10T00:00:00.000Z'),
    });
    store.pruneExpired();

    expect(fs.existsSync(oldFile)).toBe(false);
    expect(fs.existsSync(outsidePath)).toBe(true);
  });

  test('cache mode writes outside workspace and returns absolute paths', () => {
    const workspace = makeTempDir();
    const externalRoot = path.join(makeTempDir(), 'artifact-cache');
    const store = new HandoffArtifactStore(workspace, {
      now: () => new Date('2026-06-02T03:04:05.000Z'),
      location: 'cache',
      rootDir: externalRoot,
    });

    const artifact = store.seedArtifact({
      agent: 'oracle',
      childSessionId: 'child-1',
      parentSessionId: 'parent-1',
      model: 'test/oracle',
      mode: 'blocking',
      purpose: 'External artifact',
      promptText: 'External artifact',
    });

    expect(artifact.artifactPath).toBe(
      path
        .join(externalRoot, 'oracle', 'child-1_20260602-030405_external-artifact.md')
        .split(path.sep)
        .join('/'),
    );
    expect(artifact.indexPath).toBe(
      path.join(externalRoot, 'orchestrator', 'parent-1.md').split(path.sep).join('/'),
    );
    expect(artifact.artifactAbsolutePath.startsWith(workspace)).toBe(false);
    expect(fs.existsSync(artifact.artifactAbsolutePath)).toBe(true);
  });

  test('cache dir helper follows app cache convention', () => {
    const cacheDir = getHandoffArtifactCacheDir().split(path.sep).join('/');
    expect(cacheDir.endsWith('/opencode-dux/artifacts')).toBe(true);
  });
});

describe('HandoffArtifactStore - selectRelevantArtifacts', () => {
  function setupStore(now?: Date) {
    const dir = makeTempDir();
    const store = new HandoffArtifactStore(dir, {
      now: () => now ?? new Date('2026-06-02T03:04:05.000Z'),
    });
    return { dir, store };
  }

  function seed(
    store: HandoffArtifactStore,
    overrides: {
      agent: 'oracle' | 'fixer' | 'explorer' | 'designer' | 'steward';
      childSessionId: string;
      promptSequence: number;
      branchRevisionId?: string;
    },
  ) {
    store.seedArtifact({
      agent: overrides.agent,
      childSessionId: overrides.childSessionId,
      parentSessionId: 'parent-1',
      model: 'test/model',
      mode: 'blocking',
      purpose: overrides.childSessionId,
      promptText: overrides.childSessionId,
      promptSequence: overrides.promptSequence,
      branchRevisionId: overrides.branchRevisionId ?? 'v0',
    });
    store.markStatus(overrides.childSessionId, 'completed');
  }

  test('filters by branch revision', () => {
    const { store } = setupStore();
    seed(store, {
      agent: 'oracle',
      childSessionId: 'a1',
      promptSequence: 1,
      branchRevisionId: 'v0',
    });
    seed(store, {
      agent: 'fixer',
      childSessionId: 'a2',
      promptSequence: 2,
      branchRevisionId: 'v0',
    });
    seed(store, {
      agent: 'oracle',
      childSessionId: 'a3',
      promptSequence: 1,
      branchRevisionId: 'v1',
    });

    // Default branch is v0
    const v0Artifacts = store.selectRelevantArtifacts('parent-1', {
      branchRevisionId: 'v0',
      promptSequenceCutoff: 10,
      cap: 10,
    });
    expect(v0Artifacts.map((a) => a.sessionId).sort()).toEqual(['a1', 'a2']);

    // Branch v1
    const v1Artifacts = store.selectRelevantArtifacts('parent-1', {
      branchRevisionId: 'v1',
      promptSequenceCutoff: 10,
      cap: 10,
    });
    expect(v1Artifacts.map((a) => a.sessionId)).toEqual(['a3']);
  });

  test('filters by prompt sequence cutoff', () => {
    const { store } = setupStore();
    seed(store, { agent: 'oracle', childSessionId: 'p1', promptSequence: 1 });
    seed(store, { agent: 'oracle', childSessionId: 'p2', promptSequence: 2 });
    seed(store, { agent: 'oracle', childSessionId: 'p3', promptSequence: 3 });

    const afterCutoff = store.selectRelevantArtifacts('parent-1', {
      promptSequenceCutoff: 2,
      cap: 10,
    });
    expect(afterCutoff.map((a) => a.sessionId).sort()).toEqual(['p1', 'p2']);
  });

  test('prefers explicit paths', () => {
    const { store } = setupStore();
    seed(store, {
      agent: 'oracle',
      childSessionId: 'explicit-1',
      promptSequence: 3,
    });
    seed(store, {
      agent: 'fixer',
      childSessionId: 'recent-1',
      promptSequence: 5,
    });

    const explicitPath = store.getArtifactPath('explicit-1');

    const artifacts = store.selectRelevantArtifacts('parent-1', {
      explicitPaths: explicitPath ? [explicitPath] : [],
      cap: 5,
    });
    // Explicit path should be first
    expect(artifacts.length).toBeGreaterThanOrEqual(2);
    expect(artifacts[0].sessionId).toBe('explicit-1');
  });

  test('prefers prerequisite agents for target', () => {
    const { store } = setupStore();
    seed(store, {
      agent: 'explorer',
      childSessionId: 'exp-1',
      promptSequence: 1,
    });
    seed(store, { agent: 'fixer', childSessionId: 'fix-1', promptSequence: 2 });
    seed(store, {
      agent: 'oracle',
      childSessionId: 'ora-1',
      promptSequence: 3,
    });

    // For fixer target, oracle should be preferred over explorer
    const artifacts = store.selectRelevantArtifacts('parent-1', {
      targetAgent: 'fixer',
      cap: 10,
    });
    const oracleIdx = artifacts.findIndex((a) => a.agent === 'oracle');
    const explorerIdx = artifacts.findIndex((a) => a.agent === 'explorer');
    // Oracle (prerequisite for fixer) should appear before explorer (not a prerequisite)
    expect(oracleIdx).toBeLessThan(explorerIdx);
  });

  test('caps results', () => {
    const { store } = setupStore();
    for (let i = 1; i <= 10; i++) {
      seed(store, {
        agent: 'oracle',
        childSessionId: `cap-${i}`,
        promptSequence: i,
      });
    }

    const defaultCap = store.selectRelevantArtifacts('parent-1');
    expect(defaultCap.length).toBeLessThanOrEqual(5);

    const promptContextCap = store.selectRelevantArtifacts('parent-1', {
      context: 'prompt',
    });
    expect(promptContextCap.length).toBeLessThanOrEqual(3);

    const explicitCap = store.selectRelevantArtifacts('parent-1', { cap: 2 });
    expect(explicitCap.length).toBe(2);
  });

  test('excludes open status by default', () => {
    const { store } = setupStore();
    store.seedArtifact({
      agent: 'oracle',
      childSessionId: 'open-1',
      parentSessionId: 'parent-1',
      model: 'test/model',
      mode: 'blocking',
      purpose: 'open artifact',
      promptText: 'open artifact',
    });
    // Don't mark status - stays 'open'
    seed(store, {
      agent: 'oracle',
      childSessionId: 'done-1',
      promptSequence: 1,
    });

    const artifacts = store.selectRelevantArtifacts('parent-1', { cap: 10 });
    expect(artifacts.some((a) => a.sessionId === 'open-1')).toBe(false);
    expect(artifacts.some((a) => a.sessionId === 'done-1')).toBe(true);
  });

  test('includes legacy artifacts without branch revision', () => {
    const { store } = setupStore();
    // Legacy artifact (no branchRevisionId, no promptSequence)
    store.seedArtifact({
      agent: 'oracle',
      childSessionId: 'legacy-1',
      parentSessionId: 'parent-1',
      model: 'test/model',
      mode: 'blocking',
      purpose: 'legacy',
      promptText: 'legacy',
    });
    store.markStatus('legacy-1', 'completed');

    // New artifact on branch v2
    seed(store, {
      agent: 'oracle',
      childSessionId: 'new-1',
      promptSequence: 1,
      branchRevisionId: 'v2',
    });

    const artifacts = store.selectRelevantArtifacts('parent-1', {
      branchRevisionId: 'v2',
      cap: 10,
    });
    const ids = artifacts.map((a) => a.sessionId).sort();
    expect(ids).toContain('legacy-1');
    expect(ids).toContain('new-1');
  });
});

describe('HandoffArtifactStore - timeline tracking', () => {
  test('detectRewind creates new branch revision', () => {
    const dir = makeTempDir();
    const store = new HandoffArtifactStore(dir, {
      now: () => new Date('2026-06-02T03:04:05.000Z'),
    });

    expect(store.getTimeline().branchRevisionId).toBe('v0');

    // First call, no rewind
    const result1 = store.detectRewind(5);
    expect(result1).toBe(false);
    expect(store.getTimeline().branchRevisionId).toBe('v0');

    // Count increases, no rewind
    const result2 = store.detectRewind(7);
    expect(result2).toBe(false);
    expect(store.getTimeline().branchRevisionId).toBe('v0');

    // Count decreases — rewind detected
    const result3 = store.detectRewind(3);
    expect(result3).toBe(true);
    expect(store.getTimeline().branchRevisionId).toBe('v1');

    // Another rewind
    const result4 = store.detectRewind(1);
    expect(result4).toBe(true);
    expect(store.getTimeline().branchRevisionId).toBe('v2');
  });

  test('incrementSequence advances prompt sequence', () => {
    const dir = makeTempDir();
    const store = new HandoffArtifactStore(dir, {
      now: () => new Date('2026-06-02T03:04:05.000Z'),
    });

    expect(store.getTimeline().promptSequence).toBe(0);

    const seq1 = store.incrementSequence();
    expect(seq1).toBe(1);
    expect(store.getTimeline().promptSequence).toBe(1);

    const seq2 = store.incrementSequence();
    expect(seq2).toBe(2);
    expect(store.getTimeline().promptSequence).toBe(2);
  });
});

describe('HandoffArtifactStore - formatForDelegation with relevance', () => {
  test('formatForDelegation only includes relevant artifacts', () => {
    const dir = makeTempDir();
    const now = new Date('2026-06-02T03:04:05.000Z');
    const store = new HandoffArtifactStore(dir, { now: () => now });

    // Seed on branch v0, prompt sequence 1 — pass explicit timeline fields
    store.seedArtifact({
      agent: 'oracle',
      childSessionId: 'child-1',
      parentSessionId: 'parent-1',
      model: 'test/model',
      mode: 'blocking',
      purpose: 'Analysis',
      promptText: 'Analysis',
      branchRevisionId: 'v0',
      promptSequence: 1,
    });
    store.markStatus('child-1', 'completed');

    // Switch to v1 (simulating rewind)
    // Advance the store timeline so formatForDelegation uses the active branch
    store.setTimeline(2, 'v1');
    store.seedArtifact({
      agent: 'fixer',
      childSessionId: 'child-2',
      parentSessionId: 'parent-1',
      model: 'test/model',
      mode: 'blocking',
      purpose: 'Fix',
      promptText: 'Fix',
      branchRevisionId: 'v1',
      promptSequence: 2,
    });
    store.markStatus('child-2', 'completed');

    // Format with v1 timeline — should NOT include child-1 (from v0)
    const formatted = store.formatForDelegation('parent-1', {
      targetAgent: 'fixer',
    });
    expect(formatted).toBeDefined();
    expect(formatted).toContain('child-2');
    expect(formatted).not.toContain('child-1');
  });

  test('formatForPrompt only includes relevant artifacts', () => {
    const dir = makeTempDir();
    const now = new Date('2026-06-02T03:04:05.000Z');
    const store = new HandoffArtifactStore(dir, { now: () => now });

    store.seedArtifact({
      agent: 'oracle',
      childSessionId: 'child-a',
      parentSessionId: 'parent-1',
      model: 'test/model',
      mode: 'blocking',
      purpose: 'First analysis',
      promptText: 'First analysis',
      branchRevisionId: 'v0',
      promptSequence: 1,
    });
    store.markStatus('child-a', 'completed');

    // New branch revision — advance store timeline so formatForPrompt picks it up
    store.setTimeline(2, 'v1');
    store.seedArtifact({
      agent: 'oracle',
      childSessionId: 'child-b',
      parentSessionId: 'parent-1',
      model: 'test/model',
      mode: 'blocking',
      purpose: 'Second analysis',
      promptText: 'Second analysis',
      branchRevisionId: 'v1',
      promptSequence: 2,
    });
    store.markStatus('child-b', 'completed');

    // formatForPrompt uses current timeline (v1)
    const recall = store.formatForPrompt('parent-1');
    expect(recall).toBeDefined();
    expect(recall).toContain('child-b');
    expect(recall).not.toContain('child-a');
  });

  test('runtime-seeded artifacts inherit current timeline and exclude reverted fixer handoffs', () => {
    const dir = makeTempDir();
    const now = new Date('2026-06-02T03:04:05.000Z');
    const store = new HandoffArtifactStore(dir, { now: () => now });

    store.setTimeline(1, 'v0');
    store.seedArtifact({
      agent: 'fixer',
      childSessionId: 'fixer-v0',
      parentSessionId: 'parent-1',
      model: 'test/model',
      mode: 'blocking',
      purpose: 'Old fix implementation',
      promptText: 'Old fix implementation',
    });
    store.markStatus('fixer-v0', 'completed');

    store.setTimeline(2, 'v1');
    store.seedArtifact({
      agent: 'oracle',
      childSessionId: 'oracle-v1',
      parentSessionId: 'parent-1',
      model: 'test/model',
      mode: 'blocking',
      purpose: 'Reanalyze after revert',
      promptText: 'Reanalyze after revert',
    });
    store.markStatus('oracle-v1', 'completed');

    const delegation = store.formatForDelegation('parent-1', {
      targetAgent: 'oracle',
    });

    expect(delegation).toContain('oracle-v1');
    expect(delegation).not.toContain('fixer-v0');
  });
});
