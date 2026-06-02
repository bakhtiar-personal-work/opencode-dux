import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { PluginConfig } from '../config';
import { HandoffArtifactStore } from '../utils/handoff-artifacts';
import { createDelegateTools } from './delegate';

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
}) {
  let createIndex = 0;
  const promptCounts = new Map<string, number>();

  const client = {
    session: {
      create: async () => ({
        data: { id: input.sessionIds[createIndex++] },
      }),
      prompt: async ({ path: pathArg }: { path: { id: string } }) => {
        const previous = promptCounts.get(pathArg.id) ?? 0;
        promptCounts.set(pathArg.id, previous + 1);
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
      status: async () => ({ data: { type: 'idle' } }),
      abort: async () => undefined,
    },
  };

  const store = new HandoffArtifactStore(input.workspace, {
    now: () => new Date('2026-06-02T03:04:05.000Z'),
  });

  const config: PluginConfig = {
    agents: {
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
    delegateCollect: tools.delegate_collect as {
      execute: (args: { session_id: string }) => Promise<string>;
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
        'steward-1': ['<rules_applicable>- `AGENTS.md` - follow bun</rules_applicable>'],
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

    const collected = await delegateCollect.execute({ session_id: 'fixer-1' });
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
});
