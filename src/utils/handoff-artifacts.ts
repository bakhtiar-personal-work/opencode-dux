import * as fs from 'node:fs';
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
  relativePath: string;
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
}

interface OrchestratorIndexEntry {
  agent: Exclude<AgentName, 'orchestrator'>;
  childSessionId: string;
  artifactRelativePath: string;
  model: string;
  variant?: string;
  purpose: string;
  slug: string;
  createdAtIso: string;
  updatedAtIso: string;
  latestStatus: HandoffArtifactStatus;
}

interface OrchestratorIndexRecord {
  absolutePath: string;
  relativePath: string;
  parentSessionId: string;
  updatedAtIso: string;
  entries: Map<string, OrchestratorIndexEntry>;
}

interface HandoffArtifactStoreOptions {
  now?: () => Date;
  retentionMs?: number;
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
}

interface DelegationContextOptions {
  excludeChildSessionId?: string;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function formatTimestampForFilename(date: Date): string {
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
  ].join('') +
    '-' +
    [pad(date.getUTCHours()), pad(date.getUTCMinutes()), pad(date.getUTCSeconds())].join('');
}

function formatIso(date: Date): string {
  return date.toISOString();
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
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
    `- Artifact Path: ${record.relativePath}`,
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

  lines.push('', '### Original Delegation Prompt', '```text', record.originalPrompt, '```', '');

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
  lines.push(`- Detected needs_user: ${record.latestStatus === 'needs_user' ? 'yes' : 'no'}`);
  lines.push(`- Detected blocked: ${record.latestStatus === 'blocked' ? 'yes' : 'no'}`);
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
    `- Index Path: ${record.relativePath}`,
    `- Updated: ${record.updatedAtIso}`,
    '',
    '| Agent | Child Session ID | Status | Variant | Purpose | Artifact | Created | Updated |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ];

  for (const entry of entries) {
    lines.push(
      `| ${entry.agent} | ${entry.childSessionId} | ${entry.latestStatus} | ${entry.variant ?? '(default)'} | ${entry.purpose} | ${entry.artifactRelativePath} | ${entry.createdAtIso} | ${entry.updatedAtIso} |`,
    );
  }

  return lines.join('\n');
}

export class HandoffArtifactStore {
  private readonly workspaceRoot: string;
  private readonly rootDir: string;
  private readonly now: () => Date;
  private readonly retentionMs: number;
  private readonly childRecords = new Map<string, ChildArtifactRecord>();
  private readonly orchestratorIndexes = new Map<string, OrchestratorIndexRecord>();

  constructor(
    workspaceRoot: string,
    options: HandoffArtifactStoreOptions = {},
  ) {
    this.workspaceRoot = workspaceRoot;
    this.rootDir = path.join(workspaceRoot, ARTIFACT_ROOT_DIRNAME);
    this.now = options.now ?? (() => new Date());
    this.retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS;
  }

  getRootDir(): string {
    return this.rootDir;
  }

  getRootDirRelative(): string {
    return ARTIFACT_ROOT_DIRNAME;
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
    const purpose = derivePurpose(input.purpose || input.promptText, input.agent);
    const slug = slugifyArtifactPurpose(purpose || input.agent);
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
          ? [...existing.referencedArtifactPaths, ...input.referencedArtifactPaths]
          : existing.referencedArtifactPaths,
      );
      this.writeChildArtifact(existing);
      this.upsertIndex(existing);
      return this.toResult(existing);
    }

    const timestamp = formatTimestampForFilename(now);
    const filename = `${input.childSessionId}_${timestamp}_${slug}.md`;
    const relativePath = path
      .join(ARTIFACT_ROOT_DIRNAME, input.agent, filename)
      .split(path.sep)
      .join('/');
    const record: ChildArtifactRecord = {
      absolutePath: path.join(this.workspaceRoot, relativePath),
      relativePath,
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
    const index = this.orchestratorIndexes.get(parentSessionId);
    if (!index || index.entries.size === 0) {
      return undefined;
    }

    const lines = [...index.entries.values()]
      .sort((a, b) => b.updatedAtIso.localeCompare(a.updatedAtIso))
      .map(
        (entry) =>
          `- ${entry.agent} | ${entry.childSessionId} | ${entry.latestStatus} | ${entry.purpose} | ${entry.artifactRelativePath}`,
      );

    return [
      '### Handoff Artifacts',
      'Reuse these artifact paths instead of repasting prior subagent output.',
      '',
      ...lines,
    ].join('\n');
  }

  getArtifactPath(childSessionId: string): string | undefined {
    return this.childRecords.get(childSessionId)?.relativePath;
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
    };
  }

  getIndexPath(parentSessionId: string): string {
    return this.getOrCreateIndex(parentSessionId).relativePath;
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
      }));
    return artifacts;
  }

  formatForDelegation(
    parentSessionId: string,
    options: DelegationContextOptions = {},
  ): string | undefined {
    const artifacts = this.listSessionArtifacts(parentSessionId, options);
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
      `- Orchestrator index (relative): ${index.relativePath}`,
    ];

    for (const artifact of artifacts) {
      lines.push(
        '',
        `- Agent: ${artifact.agent}`,
        `  - Child session: ${artifact.sessionId}`,
        `  - Status: ${artifact.latestStatus}`,
        `  - Variant: ${artifact.variant ?? '(default)'}`,
        `  - Purpose: ${artifact.purpose}`,
        `  - Relative artifact path: ${artifact.artifactPath}`,
      );
    }

    lines.push('</upstream_handoff_artifacts>');
    return lines.join('\n');
  }

  private toResult(record: ChildArtifactRecord): ArtifactRecordResult {
    const index = this.getOrCreateIndex(record.parentSessionId);
    return {
      artifactPath: record.relativePath,
      artifactAbsolutePath: record.absolutePath,
      indexPath: index.relativePath,
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

    const relativePath = path
      .join(ARTIFACT_ROOT_DIRNAME, ORCHESTRATOR_INDEX_DIRNAME, `${parentSessionId}.md`)
      .split(path.sep)
      .join('/');
    const record: OrchestratorIndexRecord = {
      absolutePath: path.join(this.workspaceRoot, relativePath),
      relativePath,
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
      artifactRelativePath: record.relativePath,
      model: record.model,
      variant: record.variant,
      purpose: record.purpose,
      slug: record.slug,
      createdAtIso: record.createdAtIso,
      updatedAtIso: record.updatedAtIso,
      latestStatus: record.latestStatus,
    });
    index.updatedAtIso = record.updatedAtIso;
    writeFileAtomic(index.absolutePath, renderOrchestratorIndex(index));
  }

  private writeChildArtifact(record: ChildArtifactRecord): void {
    writeFileAtomic(record.absolutePath, renderChildArtifact(record));
  }
}

export function extractArtifactPathsFromPrompt(promptText: string): string[] {
  const matches = promptText.match(
    /(?:^|[\s`(])(\.opencode-dux\/[A-Za-z0-9._\-\/]+\.md)(?=$|[\s`)])/gm,
  );
  if (!matches) {
    return [];
  }

  return unique(
    matches
      .map((match) =>
        match.replace(/^[\s`(]+/, '').replace(/[\s`)]+$/, ''),
      )
      .filter(Boolean),
  );
}

export function summarizeArtifactOutput(text: string): string {
  const preview = extractTextPreview(text);
  return preview || 'Artifact updated.';
}
