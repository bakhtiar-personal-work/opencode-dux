import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { PluginConfig } from '../config';
import { HandoffArtifactStore } from '../utils/handoff-artifacts';
import { createDelegateTools, notifyDelegatedSessionStatus } from './delegate';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'delegate-artifacts-'));
  tempDirs.push(dir);
  return dir;
}

function parseEnvelopeField(output: string, label: string): string {
  const match = output.match(new RegExp(`^- ${label}: (.+)$`, 'm'));
  return match?.[1] ?? '';
}

function createDelegateFixture(input: {
  workspace: string;
  sessionIds: string[];
  outputsBySession: Record<string, string[]>;
  promptDelayMs?: number;
  statusTypeBySession?: Record<string, string>;
  onStatusCheck?: (sessionId: string) => void;
  onPromptStart?: (sessionId: string) => void;
  onPromptEnd?: (sessionId: string) => void;
  onPromptBody?: (input: {
    sessionId: string;
    body: Record<string, unknown>;
  }) => void;
}) {
  let createIndex = 0;
  const promptCounts = new Map<string, number>();

  const client = {
    session: {
      create: async () => ({
        data: { id: input.sessionIds[createIndex++] },
      }),
      prompt: async ({
        path: pathArg,
        body,
      }: {
        path: { id: string };
        body: Record<string, unknown>;
      }) => {
        input.onPromptStart?.(pathArg.id);
        input.onPromptBody?.({ sessionId: pathArg.id, body });
        if (input.promptDelayMs) {
          await Bun.sleep(input.promptDelayMs);
        }
        const previous = promptCounts.get(pathArg.id) ?? 0;
        promptCounts.set(pathArg.id, previous + 1);
        input.onPromptEnd?.(pathArg.id);
      },
      messages: async ({ path: pathArg }: { path: { id: string } }) => {
        const promptIndex = Math.max(
          (promptCounts.get(pathArg.id) ?? 1) - 1,
          0,
        );
        const output = input.outputsBySession[pathArg.id]?.[promptIndex] ?? '';
        return {
          data: [
            {
              info: { role: 'assistant' },
              parts: [{ type: 'text', text: output }],
            },
          ],
        };
      },
      status: async ({ path: pathArg }: { path: { id: string } }) => {
        input.onStatusCheck?.(pathArg.id);
        return {
          data: {
            type: input.statusTypeBySession?.[pathArg.id] ?? 'idle',
          },
        };
      },
      abort: async () => undefined,
    },
  };

  const store = new HandoffArtifactStore(input.workspace, {
    now: () => new Date('2026-06-02T03:04:05.000Z'),
  });

  const config: PluginConfig = {
    agents: {
      explorer: { model: 'test/explorer' },
      oracle: { model: 'test/oracle' },
      fixer: { model: 'test/fixer' },
      steward: { model: 'test/steward' },
    },
  };

  const tools = createDelegateTools(
    { client: client as never, directory: input.workspace },
    config,
    undefined,
    store,
  );

  return {
    delegateSubagent: tools.delegate_subagent as {
      execute: (
        args: Record<string, unknown>,
        context: { sessionID: string },
      ) => Promise<string>;
    },
    delegateSubagents: tools.delegate_subagents as {
      execute: (
        args: Record<string, unknown>,
        context: { sessionID: string },
      ) => Promise<string>;
    },
    delegateCollect: tools.delegate_collect as {
      execute: (args: {
        session_id: string;
        wait?: boolean;
        timeout_ms?: number;
      }) => Promise<string>;
    },
  };
}

describe('delegate artifact flow', () => {
  test('creates distinct child artifacts and one shared orchestrator index', async () => {
    const workspace = makeTempDir();
    const { delegateSubagent } = createDelegateFixture({
      workspace,
      sessionIds: ['oracle-1', 'oracle-2'],
      outputsBySession: {
        'oracle-1': ['<diagnosis>One</diagnosis><plan>Plan one</plan>'],
        'oracle-2': ['<diagnosis>Two</diagnosis><plan>Plan two</plan>'],
      },
    });

    const first = await delegateSubagent.execute(
      {
        agent: 'oracle',
        prompt: 'First oracle pass',
        variant: 'high',
      },
      { sessionID: 'parent-1' },
    );
    const second = await delegateSubagent.execute(
      {
        agent: 'oracle',
        prompt: 'Second oracle pass',
        variant: 'high',
      },
      { sessionID: 'parent-1' },
    );

    const firstArtifact = parseEnvelopeField(first, 'Artifact');
    const secondArtifact = parseEnvelopeField(second, 'Artifact');
    const indexPath = parseEnvelopeField(first, 'Orchestrator index');

    expect(firstArtifact).not.toBe(secondArtifact);
    expect(first).toContain('<plan>Plan one</plan>');
    expect(first).not.toContain('<diagnosis>One</diagnosis>');
    expect(fs.existsSync(path.join(workspace, firstArtifact))).toBe(true);
    expect(fs.existsSync(path.join(workspace, secondArtifact))).toBe(true);

    const indexBody = fs.readFileSync(path.join(workspace, indexPath), 'utf8');
    expect(indexBody).toContain('oracle-1');
    expect(indexBody).toContain('oracle-2');
  });

  test('injects prior artifact paths into downstream delegations automatically', async () => {
    const workspace = makeTempDir();
    const { delegateSubagent } = createDelegateFixture({
      workspace,
      sessionIds: ['steward-1', 'oracle-1'],
      outputsBySession: {
        'steward-1': [
          '<rules_applicable>- `AGENTS.md` - follow bun</rules_applicable>',
        ],
        'oracle-1': ['<plan>Use the steward rules</plan>'],
      },
    });

    const steward = await delegateSubagent.execute(
      {
        agent: 'steward',
        prompt: 'Find and cite verbatim all relevant conventions',
        variant: 'medium',
      },
      { sessionID: 'parent-1' },
    );
    const stewardArtifact = parseEnvelopeField(steward, 'Artifact');

    const oracle = await delegateSubagent.execute(
      {
        agent: 'oracle',
        prompt: 'Analyze the implementation approach',
        variant: 'high',
      },
      { sessionID: 'parent-1' },
    );
    const oracleArtifact = parseEnvelopeField(oracle, 'Artifact');
    const oracleBody = fs.readFileSync(
      path.join(workspace, oracleArtifact),
      'utf8',
    );

    expect(oracle).toContain('<plan>Use the steward rules</plan>');
    expect(oracleBody).toContain('<upstream_handoff_artifacts>');
    expect(oracleBody).toContain(stewardArtifact);
    expect(oracleBody).toContain('HARD REQUIREMENT:');
  });

  test('reuses the same artifact file for continue_session_id', async () => {
    const workspace = makeTempDir();
    const { delegateSubagent } = createDelegateFixture({
      workspace,
      sessionIds: ['oracle-1'],
      outputsBySession: {
        'oracle-1': [
          '<needs_user><reason>pick one</reason></needs_user>',
          '<plan>Resolved plan</plan>',
        ],
      },
    });

    const first = await delegateSubagent.execute(
      {
        agent: 'oracle',
        prompt: 'Oracle pass that needs clarification',
        variant: 'high',
      },
      { sessionID: 'parent-1' },
    );
    const artifactPath = parseEnvelopeField(first, 'Artifact');
    expect(first).toContain('<delegate_session_continue');

    const second = await delegateSubagent.execute(
      {
        agent: 'oracle',
        prompt: 'User answered: choose option A',
        variant: 'high',
        continue_session_id: 'oracle-1',
      },
      { sessionID: 'parent-1' },
    );

    expect(parseEnvelopeField(second, 'Artifact')).toBe(artifactPath);

    const artifactBody = fs.readFileSync(
      path.join(workspace, artifactPath),
      'utf8',
    );
    expect(artifactBody).toContain('## Turn 1');
    expect(artifactBody).toContain('## Turn 2');
    expect(artifactBody).toContain('Resolved plan');
  });

  test('fire_forget collect writes compact result and preserves inline fixer sections', async () => {
    const workspace = makeTempDir();
    const { delegateCollect, delegateSubagent } = createDelegateFixture({
      workspace,
      sessionIds: ['fixer-1'],
      outputsBySession: {
        'fixer-1': [
          '<summary>Applied the fix</summary><verification>- Tests passed: yes</verification>',
        ],
      },
    });

    const launched = await delegateSubagent.execute(
      {
        agent: 'fixer',
        prompt: 'Apply the auth fix',
        variant: 'medium',
        mode: 'fire_forget',
      },
      { sessionID: 'parent-1' },
    );

    const artifactPath = parseEnvelopeField(launched, 'Artifact');
    expect(launched).toContain('Collect with delegate_collect');
    expect(fs.existsSync(path.join(workspace, artifactPath))).toBe(true);

    const collectPromise = delegateCollect.execute({
      session_id: 'fixer-1',
      timeout_ms: 200,
    });
    setTimeout(() => {
      notifyDelegatedSessionStatus('fixer-1', 'idle');
    }, 20);
    const collected = await collectPromise;
    expect(collected).toContain('<summary>Applied the fix</summary>');
    expect(collected).toContain(
      '<verification>- Tests passed: yes</verification>',
    );

    const artifactBody = fs.readFileSync(
      path.join(workspace, artifactPath),
      'utf8',
    );
    expect(artifactBody).toContain('## Turn 1');
    expect(artifactBody).toContain('Applied the fix');
  });

  test('blocking read-only subagents can overlap in parallel', async () => {
    const workspace = makeTempDir();
    const promptStarts = new Map<string, number>();
    const promptEnds = new Map<string, number>();
    const { delegateSubagent } = createDelegateFixture({
      workspace,
      sessionIds: ['oracle-1', 'oracle-2'],
      outputsBySession: {
        'oracle-1': ['<plan>First plan</plan>'],
        'oracle-2': ['<plan>Second plan</plan>'],
      },
      promptDelayMs: 50,
      onPromptStart: (sessionId) => promptStarts.set(sessionId, Date.now()),
      onPromptEnd: (sessionId) => promptEnds.set(sessionId, Date.now()),
    });

    await Promise.all([
      delegateSubagent.execute(
        {
          agent: 'oracle',
          prompt: 'Analyze scope A',
          variant: 'high',
        },
        { sessionID: 'parent-1' },
      ),
      delegateSubagent.execute(
        {
          agent: 'oracle',
          prompt: 'Analyze scope B',
          variant: 'high',
        },
        { sessionID: 'parent-1' },
      ),
    ]);

    const orderedStarts = [...promptStarts.entries()].sort(
      (a, b) => a[1] - b[1],
    );
    expect(orderedStarts).toHaveLength(2);

    const firstSessionId = orderedStarts[0]?.[0] ?? '';
    const secondSessionId = orderedStarts[1]?.[0] ?? '';
    const firstEnd = promptEnds.get(firstSessionId) ?? 0;
    const secondStart = promptStarts.get(secondSessionId) ?? 0;

    expect(secondStart).toBeLessThan(firstEnd);
  });

  test('fire_forget fixer injects deferred validation guidance for parallel batches', async () => {
    const workspace = makeTempDir();
    let capturedPromptText = '';
    const { delegateSubagent } = createDelegateFixture({
      workspace,
      sessionIds: ['fixer-1'],
      outputsBySession: {
        'fixer-1': [
          '<summary>Done</summary><verification>- Validation: deferred</verification>',
        ],
      },
      onPromptBody: ({ body }) => {
        const parts = Array.isArray(body.parts)
          ? (body.parts as Array<Record<string, unknown>>)
          : [];
        const textPart = parts.find((part) => part.type === 'text');
        if (typeof textPart?.text === 'string') {
          capturedPromptText = textPart.text;
        }
      },
    });

    await delegateSubagent.execute(
      {
        agent: 'fixer',
        prompt: 'Edit only src/a.ts',
        variant: 'medium',
        mode: 'fire_forget',
      },
      { sessionID: 'parent-1' },
    );

    expect(capturedPromptText).toContain('<parallel_fixer_batch>');
    expect(capturedPromptText).toContain(
      'final integrated validation is deferred to the orchestrator',
    );
  });

  test('near-simultaneous blocking fixer delegations from the same parent coalesce into a parallel batch', async () => {
    const workspace = makeTempDir();
    const promptStarts = new Map<string, number>();
    const promptEnds = new Map<string, number>();
    const promptTexts = new Map<string, string>();
    const { delegateSubagent } = createDelegateFixture({
      workspace,
      sessionIds: ['fixer-1', 'fixer-2'],
      outputsBySession: {
        'fixer-1': [
          '<summary>Applied fix one</summary><verification>- Validation: local only</verification>',
        ],
        'fixer-2': [
          '<summary>Applied fix two</summary><verification>- Validation: local only</verification>',
        ],
      },
      promptDelayMs: 75,
      onPromptStart: (sessionId) => promptStarts.set(sessionId, Date.now()),
      onPromptEnd: (sessionId) => promptEnds.set(sessionId, Date.now()),
      onPromptBody: ({ sessionId, body }) => {
        const parts = Array.isArray(body.parts)
          ? (body.parts as Array<Record<string, unknown>>)
          : [];
        const textPart = parts.find((part) => part.type === 'text');
        if (typeof textPart?.text === 'string') {
          promptTexts.set(sessionId, textPart.text);
        }
      },
    });

    const [first, second] = await Promise.all([
      delegateSubagent.execute(
        {
          agent: 'fixer',
          prompt: 'Apply fix one',
          variant: 'medium',
          mode: 'blocking',
        },
        { sessionID: 'parent-1' },
      ),
      delegateSubagent.execute(
        {
          agent: 'fixer',
          prompt: 'Apply fix two',
          variant: 'medium',
          mode: 'blocking',
        },
        { sessionID: 'parent-1' },
      ),
    ]);

    expect(first).toContain('Applied fix one');
    expect(second).toContain('Applied fix two');

    const firstStart = promptStarts.get('fixer-1') ?? 0;
    const secondStart = promptStarts.get('fixer-2') ?? 0;
    const firstEnd = promptEnds.get('fixer-1') ?? 0;
    const secondEnd = promptEnds.get('fixer-2') ?? 0;

    expect(firstStart).toBeGreaterThan(0);
    expect(secondStart).toBeGreaterThan(0);
    expect(secondStart).toBeLessThan(firstEnd);
    expect(firstStart).toBeLessThan(secondEnd);
    expect(promptTexts.get('fixer-1')).toContain('<parallel_fixer_batch>');
    expect(promptTexts.get('fixer-2')).toContain('<parallel_fixer_batch>');
  });

  test('blocking delegate_subagents batches independent explorer work in parallel', async () => {
    const workspace = makeTempDir();
    const promptStarts = new Map<string, number>();
    const promptEnds = new Map<string, number>();
    const { delegateSubagents } = createDelegateFixture({
      workspace,
      sessionIds: ['explorer-1', 'explorer-2'],
      outputsBySession: {
        'explorer-1': ['<summary>Color scan complete</summary>'],
        'explorer-2': ['<summary>WCAG scan complete</summary>'],
      },
      promptDelayMs: 50,
      onPromptStart: (sessionId) => promptStarts.set(sessionId, Date.now()),
      onPromptEnd: (sessionId) => promptEnds.set(sessionId, Date.now()),
    });

    const result = await delegateSubagents.execute(
      {
        mode: 'blocking',
        tasks: [
          {
            agent: 'explorer',
            prompt: 'Search for hardcoded colors',
            variant: 'high',
          },
          {
            agent: 'explorer',
            prompt: 'Search for WCAG issues',
            variant: 'high',
          },
        ],
      },
      { sessionID: 'parent-1' },
    );

    expect(result).toContain('## Delegation Batch');
    expect(result).toContain('Color scan complete');
    expect(result).toContain('WCAG scan complete');

    const orderedStarts = [...promptStarts.entries()].sort(
      (a, b) => a[1] - b[1],
    );
    expect(orderedStarts).toHaveLength(2);

    const firstSessionId = orderedStarts[0]?.[0] ?? '';
    const secondSessionId = orderedStarts[1]?.[0] ?? '';
    const firstEnd = promptEnds.get(firstSessionId) ?? 0;
    const secondStart = promptStarts.get(secondSessionId) ?? 0;

    expect(secondStart).toBeLessThan(firstEnd);
  });

  test('delegate_collect wait mode trusts completion event even if session.status is stale busy', async () => {
    const workspace = makeTempDir();
    let statusChecks = 0;
    const statusTypeBySession = {
      'fixer-1': 'busy',
    };
    const { delegateCollect, delegateSubagent } = createDelegateFixture({
      workspace,
      sessionIds: ['fixer-1'],
      outputsBySession: {
        'fixer-1': [
          '<summary>Applied async fix</summary><verification>- Validation: local only</verification>',
        ],
      },
      statusTypeBySession,
      onStatusCheck: () => {
        statusChecks += 1;
      },
    });

    await delegateSubagent.execute(
      {
        agent: 'fixer',
        prompt: 'Apply background fix',
        variant: 'medium',
        mode: 'fire_forget',
      },
      { sessionID: 'parent-1' },
    );

    const collectPromise = delegateCollect.execute({
      session_id: 'fixer-1',
      wait: true,
      timeout_ms: 200,
    });

    setTimeout(() => {
      statusTypeBySession['fixer-1'] = 'busy';
      notifyDelegatedSessionStatus('fixer-1', 'idle');
    }, 20);

    const collected = await collectPromise;
    expect(collected).toContain('Applied async fix');
    expect(statusChecks).toBe(0);
  });

  test('delegate_collect waits by default instead of probing repeatedly', async () => {
    const workspace = makeTempDir();
    let statusChecks = 0;
    const { delegateCollect, delegateSubagent } = createDelegateFixture({
      workspace,
      sessionIds: ['fixer-2'],
      outputsBySession: {
        'fixer-2': [
          '<summary>Applied delayed async fix</summary><verification>- Validation: local only</verification>',
        ],
      },
      statusTypeBySession: {
        'fixer-2': 'busy',
      },
      onStatusCheck: () => {
        statusChecks += 1;
      },
    });

    await delegateSubagent.execute(
      {
        agent: 'fixer',
        prompt: 'Apply another background fix',
        variant: 'medium',
        mode: 'fire_forget',
      },
      { sessionID: 'parent-1' },
    );

    const collectPromise = delegateCollect.execute({
      session_id: 'fixer-2',
      timeout_ms: 200,
    });

    setTimeout(() => {
      notifyDelegatedSessionStatus('fixer-2', 'idle');
    }, 20);

    const collected = await collectPromise;
    expect(collected).toContain('Applied delayed async fix');
    expect(statusChecks).toBe(0);
  });
});
