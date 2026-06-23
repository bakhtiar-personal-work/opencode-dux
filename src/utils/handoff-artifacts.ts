import * as fs from 'node:fs';
import { homedir } from 'node:os';
import * as path from 'node:path';
import type { AgentName } from '../config';

const ARTIFACT_ROOT_DIRNAME = '.opencode-dux';
const ORCHESTRATOR_INDEX_DIRNAME = 'orchestrator';
const DEFAULT_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
const MAX_PURPOSE_LENGTH = 80;
const MAX_SLUG_LENGTH = 48;

export type HandoffArtifactStatus =
  | 'open'
  | 'completed'
  | 'blocked'
  | 'needs_user'
  | 'collected';

interface ArtifactTurnRecord {
  turnNumber: number;
  timestampIso: string;
  outputText: string;
  inlineSections: string[];
  status: HandoffArtifactStatus;
}

interface ChildArtifactRecord {
  absolutePath: string;
  artifactPath: string;
  agent: Exclude<AgentName, 'orchestrator'>;
  childSessionId: string;
  parentSessionId: string;
  model: string;
  variant?: string;
  mode: 'blocking' | 'fire_forget';
  purpose: string;
  slug: string;
  originalPrompt: string;
  referencedArtifactPaths: string[];
  createdAtIso: string;
  updatedAtIso: string;
  turns: ArtifactTurnRecord[];
  latestStatus: HandoffArtifactStatus;
  branchRevisionId?: string;
  promptSequence?: number;
}

interface OrchestratorIndexEntry {
  agent: Exclude<AgentName, 'orchestrator'>;
  childSessionId: string;
  artifactPath: string;
  model: string;
  variant?: string;
  purpose: string;
  slug: string;
  createdAtIso: string;
  updatedAtIso: string;
  latestStatus: HandoffArtifactStatus;
  branchRevisionId?: string;
  promptSequence?: number;
}

interface OrchestratorIndexRecord {
  absolutePath: string;
  indexPath: string;
  parentSessionId: string;
  updatedAtIso: string;
  entries: Map<string, OrchestratorIndexEntry>;
}

export type HandoffArtifactLocation = 'project' | 'cache';

interface HandoffArtifactStoreOptions {
  now?: () => Date;
  retentionMs?: number;
  location?: HandoffArtifactLocation;
  rootDir?: string;
}

export interface ArtifactSeedInput {
  agent: Exclude<AgentName, 'orchestrator'>;
  childSessionId: string;
  parentSessionId: string;
  model: string;
  variant?: string;
  mode: 'blocking' | 'fire_forget';
  purpose: string;
  promptText: string;
  referencedArtifactPaths?: string[];
  branchRevisionId?: string;
  promptSequence?: number;
}

export interface ArtifactTurnInput {
  childSessionId: string;
  outputText: string;
  inlineSections: string[];
  status: HandoffArtifactStatus;
}

export interface ArtifactRecordResult {
  artifactPath: string;
  artifactAbsolutePath: string;
  indexPath: string;
  indexAbsolutePath: string;
  purpose: string;
  sessionId: string;
}

export interface ArtifactSessionInfo extends ArtifactRecordResult {
  agent: Exclude<AgentName, 'orchestrator'>;
  variant?: string;
  latestStatus: HandoffArtifactStatus;
  parentSessionId: string;
  branchRevisionId?: string;
  promptSequence?: number;
}

export interface RelevanceSelectionOptions {
  /** Active branch revision ID. Only artifacts matching this branch (or unversioned legacy artifacts) are included. */
  branchRevisionId?: string;
  /** Exclude artifacts created after this prompt sequence number. */
  promptSequenceCutoff?: number;
  /** Artifact paths explicitly referenced in the current prompt — these are always included if available. */
  explicitPaths?: string[];
  /** Target subagent name — prerequisite-agent artifacts are preferred. */
  targetAgent?: string;
  /** Child session ID for continuation — when set, 'open' status artifacts are not excluded. */
  continueChildSessionId?: string;
  /** Maximum number of artifacts to return (default 5). */
  cap?: number;
  /** Context hint: "prompt" for chat recall (cap 3), "delegation" for subagent handoff (cap 5). */
  context?: 'prompt' | 'delegation';
  /** Exclude artifacts that match this child session ID (for continuation scenarios). */
  excludeChildSessionId?: string;
}

interface DelegationContextOptions {
  excludeChildSessionId?: string;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function formatTimestampForFilename(date: Date): string {
  return (
    [
      date.getUTCFullYear(),
      pad(date.getUTCMonth() + 1),
      pad(date.getUTCDate()),
    ].join('') +
    '-' +
    [
      pad(date.getUTCHours()),
      pad(date.getUTCMinutes()),
      pad(date.getUTCSeconds()),
    ].join('')
  );
}

function formatIso(date: Date): string {
  return date.toISOString();
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeDisplayPath(value: string): string {
  return value.split(path.sep).join('/');
}

export function getHandoffArtifactCacheDir(): string {
  return process.platform === 'win32'
    ? path.join(
        process.env.LOCALAPPDATA ?? homedir(),
        'opencode-dux',
        'artifacts',
      )
    : path.join(homedir(), '.cache', 'opencode-dux', 'artifacts');
}

function resolveArtifactRootDir(
  workspaceRoot: string,
  location: HandoffArtifactLocation,
): string {
  return location === 'cache'
    ? getHandoffArtifactCacheDir()
    : path.join(workspaceRoot, ARTIFACT_ROOT_DIRNAME);
}

function buildArtifactPath(
  workspaceRoot: string,
  rootDir: string,
  location: HandoffArtifactLocation,
  ...segments: string[]
): { absolutePath: string; artifactPath: string } {
  const absolutePath = path.join(rootDir, ...segments);
  const artifactPath =
    location === 'cache'
      ? normalizeDisplayPath(absolutePath)
      : normalizeDisplayPath(path.relative(workspaceRoot, absolutePath));
  return { absolutePath, artifactPath };
}

function derivePurpose(raw: string, fallback: string): string {
  const firstLine = raw
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(line))
    .find(Boolean);
  const purpose = firstLine || fallback;
  return purpose.slice(0, MAX_PURPOSE_LENGTH);
}

export function slugifyArtifactPurpose(value: string): string {
  const ascii = value
    .normalize('NFKD')
    .replace(/[^\x00-\x7F]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!ascii) {
    return 'artifact';
  }
  return ascii.slice(0, MAX_SLUG_LENGTH).replace(/-+$/g, '') || 'artifact';
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function extractTextPreview(value: string): string {
  const stripped = normalizeWhitespace(
    value.replace(/<[^>]+>/g, ' ').replace(/`{3}[\s\S]*?`{3}/g, ' '),
  );
  return stripped.slice(0, 180);
}

function writeFileAtomic(targetPath: string, content: string): void {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const tmpPath = `${targetPath}.tmp`;
  fs.writeFileSync(tmpPath, content, 'utf8');
  fs.renameSync(tmpPath, targetPath);
}

function cleanupEmptyDirectories(rootPath: string): void {
  if (!fs.existsSync(rootPath)) {
    return;
  }

  for (const entry of fs.readdirSync(rootPath, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const childPath = path.join(rootPath, entry.name);
    cleanupEmptyDirectories(childPath);
    try {
      if (fs.readdirSync(childPath).length === 0) {
        fs.rmdirSync(childPath);
      }
    } catch {
      // best effort
    }
  }
}

function renderChildArtifact(record: ChildArtifactRecord): string {
  const lines = [
    '# Handoff Artifact',
    '',
    '## Header',
    `- Agent: ${record.agent}`,
    `- Child Session ID: ${record.childSessionId}`,
    `- Parent Orchestrator Session ID: ${record.parentSessionId}`,
    `- Artifact Path: ${record.artifactPath}`,
    `- Model: ${record.model}`,
    `- Variant: ${record.variant ?? '(default)'}`,
    `- Mode: ${record.mode}`,
    `- Purpose: ${record.purpose}`,
    `- Created: ${record.createdAtIso}`,
    `- Updated: ${record.updatedAtIso}`,
    `- Latest Status: ${record.latestStatus}`,
    '',
    '## Context',
    '### Referenced Upstream Artifacts',
  ];

  if (record.referencedArtifactPaths.length === 0) {
    lines.push('- (none)');
  } else {
    for (const artifactPath of record.referencedArtifactPaths) {
      lines.push(`- ${artifactPath}`);
    }
  }

  lines.push(
    '',
    '### Original Delegation Prompt',
    '```text',
    record.originalPrompt,
    '```',
    '',
  );

  for (const turn of record.turns) {
    lines.push(
      `## Turn ${turn.turnNumber}`,
      `- Timestamp: ${turn.timestampIso}`,
      `- Status: ${turn.status}`,
      '',
      '```text',
      turn.outputText,
      '```',
      '',
    );
  }

  lines.push('## Parsed Summary');
  lines.push(
    `- Detected needs_user: ${record.latestStatus === 'needs_user' ? 'yes' : 'no'}`,
  );
  lines.push(
    `- Detected blocked: ${record.latestStatus === 'blocked' ? 'yes' : 'no'}`,
  );
  lines.push('- Inline Handoff Sections:');
  const latestInlineSections = record.turns.at(-1)?.inlineSections ?? [];
  if (latestInlineSections.length === 0) {
    lines.push('- (none)');
  } else {
    for (const section of latestInlineSections) {
      lines.push('', section, '');
    }
  }

  return lines.join('\n');
}

function renderOrchestratorIndex(record: OrchestratorIndexRecord): string {
  const entries = [...record.entries.values()].sort((a, b) =>
    a.createdAtIso.localeCompare(b.createdAtIso),
  );
  const lines = [
    '# Orchestrator Handoff Index',
    '',
    `- Orchestrator Session ID: ${record.parentSessionId}`,
    `- Index Path: ${record.indexPath}`,
    `- Updated: ${record.updatedAtIso}`,
    '',
    '| Agent | Child Session ID | Status | Variant | Purpose | Artifact | Created | Updated |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ];

  for (const entry of entries) {
    lines.push(
      `| ${entry.agent} | ${entry.childSessionId} | ${entry.latestStatus} | ${entry.variant ?? '(default)'} | ${entry.purpose} | ${entry.artifactPath} | ${entry.createdAtIso} | ${entry.updatedAtIso} |`,
    );
  }

  return lines.join('\n');
}

export class HandoffArtifactStore {
  private readonly workspaceRoot: string;
  private readonly rootDir: string;
  private readonly location: HandoffArtifactLocation;
  private readonly now: () => Date;
  private readonly retentionMs: number;
  private readonly childRecords = new Map<string, ChildArtifactRecord>();
  private readonly orchestratorIndexes = new Map<
    string,
    OrchestratorIndexRecord
  >();

  /** Current prompt sequence number (orchestrator turn count). */
  private promptSequence: number = 0;
  /** Current branch revision ID — incremented when a user rewind is detected. */
  private branchRevisionId: string = 'v0';
  /** Last observed user message count — used for rewind detection. */
  private lastUserMessageCount: number = 0;

  constructor(
    workspaceRoot: string,
    options: HandoffArtifactStoreOptions = {},
  ) {
    this.workspaceRoot = workspaceRoot;
    this.location = options.location ?? 'project';
    this.rootDir =
      options.rootDir ?? resolveArtifactRootDir(workspaceRoot, this.location);
    this.now = options.now ?? (() => new Date());
    this.retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS;
  }

  setTimeline(promptSequence: number, branchRevisionId?: string): void {
    this.promptSequence = promptSequence;
    if (branchRevisionId !== undefined) {
      this.branchRevisionId = branchRevisionId;
    }
  }

  getTimeline(): { promptSequence: number; branchRevisionId: string } {
    return {
      promptSequence: this.promptSequence,
      branchRevisionId: this.branchRevisionId,
    };
  }

  /**
   * Detect whether the user has reverted to an earlier point in the conversation
   * by comparing the current user message count with the previously observed count.
   * When a rewind is detected, the branch revision ID is automatically incremented.
   * Returns true if a new branch revision was created.
   */
  detectRewind(userMessageCount: number): boolean {
    if (userMessageCount < this.lastUserMessageCount) {
      // User reverted — increment branch revision
      const parts = this.branchRevisionId.match(/^v(\d+)$/);
      const nextNum = parts ? parseInt(parts[1], 10) + 1 : 1;
      this.branchRevisionId = `v${nextNum}`;
      this.lastUserMessageCount = userMessageCount;
      return true;
    }
    this.lastUserMessageCount = userMessageCount;
    return false;
  }

  /**
   * Increment the prompt sequence by 1 and return the new value.
   * Call this before each orchestrator turn.
   */
  incrementSequence(): number {
    this.promptSequence += 1;
    return this.promptSequence;
  }

  getRootDir(): string {
    return this.rootDir;
  }

  getRootDirRelative(): string {
    return this.location === 'cache'
      ? normalizeDisplayPath(this.rootDir)
      : ARTIFACT_ROOT_DIRNAME;
  }

  pruneExpired(): void {
    if (!fs.existsSync(this.rootDir)) {
      return;
    }

    const cutoff = this.now().getTime() - this.retentionMs;
    const visit = (dirPath: string): void => {
      for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
        const entryPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          visit(entryPath);
          continue;
        }
        if (!entry.isFile()) continue;
        try {
          const stat = fs.statSync(entryPath);
          if (stat.mtimeMs < cutoff) {
            fs.unlinkSync(entryPath);
          }
        } catch {
          // best effort
        }
      }
    };

    visit(this.rootDir);
    cleanupEmptyDirectories(this.rootDir);
  }

  seedArtifact(input: ArtifactSeedInput): ArtifactRecordResult {
    this.pruneExpired();
    const now = this.now();
    const purpose = derivePurpose(
      input.purpose || input.promptText,
      input.agent,
    );
    const slug = slugifyArtifactPurpose(purpose || input.agent);
    const effectiveBranchRevisionId =
      input.branchRevisionId ??
      (this.promptSequence > 0 ? this.branchRevisionId : undefined);
    const effectivePromptSequence =
      input.promptSequence ??
      (this.promptSequence > 0 ? this.promptSequence : undefined);
    const existing = this.childRecords.get(input.childSessionId);
    if (existing) {
      existing.updatedAtIso = formatIso(now);
      existing.model = input.model;
      existing.variant = input.variant;
      existing.mode = input.mode;
      existing.purpose = purpose;
      existing.originalPrompt = input.promptText;
      existing.referencedArtifactPaths = unique(
        input.referencedArtifactPaths?.length
          ? [
              ...existing.referencedArtifactPaths,
              ...input.referencedArtifactPaths,
            ]
          : existing.referencedArtifactPaths,
      );
      this.writeChildArtifact(existing);
      this.upsertIndex(existing);
      return this.toResult(existing);
    }

    const timestamp = formatTimestampForFilename(now);
    const filename = `${input.childSessionId}_${timestamp}_${slug}.md`;
    const artifactFile = buildArtifactPath(
      this.workspaceRoot,
      this.rootDir,
      this.location,
      input.agent,
      filename,
    );
    const record: ChildArtifactRecord = {
      absolutePath: artifactFile.absolutePath,
      artifactPath: artifactFile.artifactPath,
      agent: input.agent,
      childSessionId: input.childSessionId,
      parentSessionId: input.parentSessionId,
      model: input.model,
      variant: input.variant,
      mode: input.mode,
      purpose,
      slug,
      originalPrompt: input.promptText,
      referencedArtifactPaths: unique(input.referencedArtifactPaths ?? []),
      createdAtIso: formatIso(now),
      updatedAtIso: formatIso(now),
      turns: [],
      latestStatus: 'open',
      branchRevisionId: effectiveBranchRevisionId,
      promptSequence: effectivePromptSequence,
    };

    this.childRecords.set(input.childSessionId, record);
    this.writeChildArtifact(record);
    this.upsertIndex(record);
    return this.toResult(record);
  }

  appendTurn(input: ArtifactTurnInput): ArtifactRecordResult | undefined {
    this.pruneExpired();
    const record = this.childRecords.get(input.childSessionId);
    if (!record) {
      return undefined;
    }

    const timestampIso = formatIso(this.now());
    record.turns.push({
      turnNumber: record.turns.length + 1,
      timestampIso,
      outputText: input.outputText,
      inlineSections: input.inlineSections,
      status: input.status,
    });
    record.updatedAtIso = timestampIso;
    record.latestStatus = input.status;
    this.writeChildArtifact(record);
    this.upsertIndex(record);
    return this.toResult(record);
  }

  markStatus(
    childSessionId: string,
    status: HandoffArtifactStatus,
  ): ArtifactRecordResult | undefined {
    const record = this.childRecords.get(childSessionId);
    if (!record) {
      return undefined;
    }
    record.latestStatus = status;
    record.updatedAtIso = formatIso(this.now());
    this.writeChildArtifact(record);
    this.upsertIndex(record);
    return this.toResult(record);
  }

  formatForPrompt(parentSessionId: string): string | undefined {
    const artifacts = this.selectRelevantArtifacts(parentSessionId, {
      context: 'prompt',
    });
    if (artifacts.length === 0) {
      return undefined;
    }

    const lines = artifacts.map(
      (entry) =>
        `- ${entry.agent} | ${entry.sessionId} | ${entry.latestStatus} | ${entry.purpose} | ${entry.artifactPath}`,
    );

    return [
      '### Handoff Artifacts',
      'Reuse these artifact paths instead of repasting prior subagent output.',
      '',
      ...lines,
    ].join('\n');
  }

  getArtifactPath(childSessionId: string): string | undefined {
    return this.childRecords.get(childSessionId)?.artifactPath;
  }

  getSessionInfo(childSessionId: string): ArtifactSessionInfo | undefined {
    const record = this.childRecords.get(childSessionId);
    if (!record) {
      return undefined;
    }
    const result = this.toResult(record);
    return {
      ...result,
      agent: record.agent,
      variant: record.variant,
      latestStatus: record.latestStatus,
      parentSessionId: record.parentSessionId,
      branchRevisionId: record.branchRevisionId,
      promptSequence: record.promptSequence,
    };
  }

  getIndexPath(parentSessionId: string): string {
    return this.getOrCreateIndex(parentSessionId).indexPath;
  }

  listSessionArtifacts(
    parentSessionId: string,
    options: DelegationContextOptions = {},
  ): ArtifactSessionInfo[] {
    const artifacts = [...this.childRecords.values()]
      .filter(
        (record) =>
          record.parentSessionId === parentSessionId &&
          record.childSessionId !== options.excludeChildSessionId,
      )
      .sort((a, b) => b.updatedAtIso.localeCompare(a.updatedAtIso))
      .map((record) => ({
        ...this.toResult(record),
        agent: record.agent,
        variant: record.variant,
        latestStatus: record.latestStatus,
        parentSessionId: record.parentSessionId,
        branchRevisionId: record.branchRevisionId,
        promptSequence: record.promptSequence,
      }));
    return artifacts;
  }

  /**
   * Agent dependency map: for a given target agent, which agents'
   * artifacts are considered prerequisite context.
   */
  private static readonly PREREQUISITE_AGENTS: Record<string, string[]> = {
    fixer: ['oracle', 'designer', 'steward'],
    oracle: ['steward', 'explorer', 'librarian'],
    designer: ['steward', 'explorer'],
    steward: [],
    explorer: [],
    librarian: [],
    interpreter: [],
  };

  /**
   * Select relevant artifacts for prompt recall or delegation, applying
   * branch-awareness, prompt-sequence cutoff, preference for explicit paths,
   * prerequisite-agent ordering, and result capping.
   */
  selectRelevantArtifacts(
    parentSessionId: string,
    options: RelevanceSelectionOptions = {},
  ): ArtifactSessionInfo[] {
    const cap = options.cap ?? (options.context === 'prompt' ? 3 : 5);
    // Only apply timeline defaults when the store has actually been advanced
    const branchRevId =
      options.branchRevisionId ??
      (this.promptSequence > 0 ? this.branchRevisionId : undefined);
    const cutoffPSeq =
      options.promptSequenceCutoff ??
      (this.promptSequence > 0 ? this.promptSequence : undefined);

    // Get all artifacts for this parent
    let artifacts = [...this.childRecords.values()].filter(
      (r) => r.parentSessionId === parentSessionId,
    );

    // Filter by branch revision (unversioned legacy artifacts are always included)
    if (branchRevId != null) {
      artifacts = artifacts.filter(
        (r) => !r.branchRevisionId || r.branchRevisionId === branchRevId,
      );
    }

    // Filter by prompt sequence cutoff (unversioned legacy artifacts are always included)
    if (cutoffPSeq != null) {
      artifacts = artifacts.filter(
        (r) => r.promptSequence == null || r.promptSequence <= cutoffPSeq,
      );
    }

    // Exclude 'open' status by default unless continuing the same child session
    if (!options.continueChildSessionId) {
      artifacts = artifacts.filter((r) => r.latestStatus !== 'open');
    }

    // Exclude a specific child session ID (for continuation to avoid self-reference)
    if (options.excludeChildSessionId) {
      artifacts = artifacts.filter(
        (r) => r.childSessionId !== options.excludeChildSessionId,
      );
    }

    // Separate explicit paths from the prompt
    const explicitSet = new Set(options.explicitPaths ?? []);
    const explicit: ChildArtifactRecord[] = [];
    const remaining: ChildArtifactRecord[] = [];

    for (const r of artifacts) {
      if (explicitSet.has(r.artifactPath)) {
        explicit.push(r);
      } else {
        remaining.push(r);
      }
    }

    // Sort by updatedAtIso descending
    const sortDesc = (a: ChildArtifactRecord, b: ChildArtifactRecord): number =>
      b.updatedAtIso.localeCompare(a.updatedAtIso);
    explicit.sort(sortDesc);
    remaining.sort(sortDesc);

    // Prefer prerequisite-agent artifacts for the target agent
    const prerequisites = options.targetAgent
      ? (HandoffArtifactStore.PREREQUISITE_AGENTS[options.targetAgent] ?? [])
      : [];

    const preferred: ChildArtifactRecord[] = [];
    const rest: ChildArtifactRecord[] = [];

    for (const r of remaining) {
      if (prerequisites.includes(r.agent)) {
        preferred.push(r);
      } else {
        rest.push(r);
      }
    }

    preferred.sort(sortDesc);
    rest.sort(sortDesc);

    // Combine: explicit first, then preferred, then rest
    const combined = [...explicit, ...preferred, ...rest];
    const capped = combined.slice(0, cap);

    return capped.map((r) => ({
      ...this.toResult(r),
      agent: r.agent,
      variant: r.variant,
      latestStatus: r.latestStatus,
      parentSessionId: r.parentSessionId,
      branchRevisionId: r.branchRevisionId,
      promptSequence: r.promptSequence,
    }));
  }

  formatForDelegation(
    parentSessionId: string,
    options: DelegationContextOptions & {
      targetAgent?: string;
      explicitPaths?: string[];
    } = {},
  ): string | undefined {
    const artifacts = this.selectRelevantArtifacts(parentSessionId, {
      context: 'delegation',
      targetAgent: options.targetAgent,
      explicitPaths: options.explicitPaths,
      excludeChildSessionId: options.excludeChildSessionId,
    });
    if (artifacts.length === 0) {
      return undefined;
    }

    const index = this.getOrCreateIndex(parentSessionId);
    const lines = [
      '<upstream_handoff_artifacts>',
      'HARD REQUIREMENT:',
      '- You MUST read the relevant handoff artifact files listed below before proceeding.',
      '- Treat these files as canonical prior findings from earlier subagents in the same orchestrator session.',
      '- Do NOT ask for context that is already present in these artifacts.',
      '- If a listed artifact is missing or unreadable, report that exact path in <blocked>.',
      '',
      `- Orchestrator index: ${index.indexPath}`,
    ];

    for (const artifact of artifacts) {
      lines.push(
        '',
        `- Agent: ${artifact.agent}`,
        `  - Child session: ${artifact.sessionId}`,
        `  - Status: ${artifact.latestStatus}`,
        `  - Variant: ${artifact.variant ?? '(default)'}`,
        `  - Purpose: ${artifact.purpose}`,
        `  - Artifact path: ${artifact.artifactPath}`,
      );
    }

    lines.push('</upstream_handoff_artifacts>');
    return lines.join('\n');
  }

  private toResult(record: ChildArtifactRecord): ArtifactRecordResult {
    const index = this.getOrCreateIndex(record.parentSessionId);
    return {
      artifactPath: record.artifactPath,
      artifactAbsolutePath: record.absolutePath,
      indexPath: index.indexPath,
      indexAbsolutePath: index.absolutePath,
      purpose: record.purpose,
      sessionId: record.childSessionId,
    };
  }

  private getOrCreateIndex(parentSessionId: string): OrchestratorIndexRecord {
    const existing = this.orchestratorIndexes.get(parentSessionId);
    if (existing) {
      return existing;
    }

    const indexFile = buildArtifactPath(
      this.workspaceRoot,
      this.rootDir,
      this.location,
      ORCHESTRATOR_INDEX_DIRNAME,
      `${parentSessionId}.md`,
    );
    const record: OrchestratorIndexRecord = {
      absolutePath: indexFile.absolutePath,
      indexPath: indexFile.artifactPath,
      parentSessionId,
      updatedAtIso: formatIso(this.now()),
      entries: new Map(),
    };
    this.orchestratorIndexes.set(parentSessionId, record);
    writeFileAtomic(record.absolutePath, renderOrchestratorIndex(record));
    return record;
  }

  private upsertIndex(record: ChildArtifactRecord): void {
    const index = this.getOrCreateIndex(record.parentSessionId);
    index.entries.set(record.childSessionId, {
      agent: record.agent,
      childSessionId: record.childSessionId,
      artifactPath: record.artifactPath,
      model: record.model,
      variant: record.variant,
      purpose: record.purpose,
      slug: record.slug,
      createdAtIso: record.createdAtIso,
      updatedAtIso: record.updatedAtIso,
      latestStatus: record.latestStatus,
      branchRevisionId: record.branchRevisionId,
      promptSequence: record.promptSequence,
    });
    index.updatedAtIso = record.updatedAtIso;
    writeFileAtomic(index.absolutePath, renderOrchestratorIndex(index));
  }

  private writeChildArtifact(record: ChildArtifactRecord): void {
    writeFileAtomic(record.absolutePath, renderChildArtifact(record));
  }
}

export function extractArtifactPathsFromPrompt(promptText: string): string[] {
  const extracted: string[] = [];
  for (const line of promptText.split(/\r?\n/)) {
    const trimmed = line.trim();
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx >= 0) {
      const label = trimmed.slice(0, colonIdx).toLowerCase();
      if (
        label.endsWith('artifact') ||
        label.endsWith('artifact path') ||
        label.endsWith('orchestrator index') ||
        label.endsWith('index path')
      ) {
        const maybePath = trimmed
          .slice(colonIdx + 1)
          .trim()
          .replace(/^`|`$/g, '');
        if (
          maybePath.endsWith('.md') &&
          (maybePath.startsWith('.opencode-dux/') ||
            /^[A-Za-z]:\//.test(maybePath) ||
            maybePath.startsWith('/'))
        ) {
          extracted.push(maybePath);
        }
      }
    }
  }

  return unique(
    [
      ...extracted,
      ...((promptText.match(
        /(?:^|[\s`(])((?:\.opencode-dux\/|[A-Za-z]:\/|\/)[^`\r\n]+?\.md)(?=$|[\s`)])/gm,
      ) ?? [])
        .map((match) => match.replace(/^[\s`(]+/, '').replace(/[\s`)]+$/, ''))
        .filter(Boolean)),
    ],
  );
}

export function summarizeArtifactOutput(text: string): string {
  const preview = extractTextPreview(text);
  return preview || 'Artifact updated.';
}
