import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  extractArtifactPathsFromPrompt,
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

    const indexBody = fs.readFileSync(path.join(workspace, a.indexPath), 'utf8');
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
});
