import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type {
  SubscriptionProvider,
  SubscriptionUsageEntry,
} from './subscriptions/types';

export type { SubscriptionUsageEntry };

/** Sidebar state for one OpenCode session (orchestrator or subagent). */
export interface SessionNode {
  title: string;
  agent: string;
  model: string;
  variant?: string;
  parentId?: string;
  childIds: string[];
  status: 'busy' | 'idle' | 'retry';
  mode?: 'blocking' | 'fire_forget';
  createdAt: number;
  finishedAt?: number;
  usage?: SessionUsageEntry;
}

export interface SessionUsageEntry {
  contextUsed: number;
  contextLimit: number;
  contextPct: number;
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
  updatedAt: number;
}

export interface OrchestrationSigmaAccum {
  contextUsed: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface SessionUsageDeltaBasis {
  contextUsed: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** One OpenCode orchestration/session tree keyed by root session id. */
export interface TuiSessionBundle {
  rootSessionId: string;
  lastActivityAt: number;
  projectPath?: string;
  tree: Record<string, SessionNode>;
  orchestrationSigmaAccum?: OrchestrationSigmaAccum;
  orchestrationUsageLastSeen: Record<string, SessionUsageDeltaBasis>;
}

export interface TuiSnapshot {
  version: 6;
  pluginVersion?: string;
  updatedAt: number;
  sessions: Record<string, TuiSessionBundle>;
  subscriptionUsage: Record<string, SubscriptionUsageEntry>;
  activeSubscriptionByProvider: Partial<Record<SubscriptionProvider, string>>;
}

export const sessionTreeStore: Record<string, SessionNode> = {};

export const SESSION_BUNDLE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

function emptyBundle(rootSessionId: string): TuiSessionBundle {
  return {
    rootSessionId,
    lastActivityAt: Date.now(),
    tree: {},
    orchestrationUsageLastSeen: {},
  };
}

/** Normalized resolved directory for comparisons. */
export function normalizeProjectDirectory(raw: string): string {
  return path.normalize(path.resolve(raw));
}

export function mergedSessionTree(
  snapshot: TuiSnapshot,
): Record<string, SessionNode> {
  const out: Record<string, SessionNode> = {};
  for (const bundle of Object.values(snapshot.sessions)) {
    Object.assign(out, bundle.tree);
  }
  return out;
}

/** 0-100, from current context used ÷ limit (single source of truth for CTX %). */
export function deriveSessionContextPct(used: number, limit: number): number {
  if (!(limit > 0)) return 0;
  if (!(Number.isFinite(used) && Number.isFinite(limit))) return 0;
  const safeUsed = Math.max(0, used);
  return Math.max(0, Math.min(100, (safeUsed / limit) * 100));
}

function coerceSessionUsageEntry(
  raw: Partial<SessionUsageEntry> | undefined,
): SessionUsageEntry | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  return {
    contextUsed:
      typeof raw.contextUsed === 'number' ? Math.max(0, raw.contextUsed) : 0,
    contextLimit:
      typeof raw.contextLimit === 'number' ? Math.max(0, raw.contextLimit) : 0,
    contextPct:
      typeof raw.contextPct === 'number'
        ? Math.max(0, Math.min(100, raw.contextPct))
        : 0,
    input: typeof raw.input === 'number' ? Math.max(0, raw.input) : 0,
    output: typeof raw.output === 'number' ? Math.max(0, raw.output) : 0,
    reasoning:
      typeof raw.reasoning === 'number' ? Math.max(0, raw.reasoning) : 0,
    cacheRead:
      typeof raw.cacheRead === 'number' ? Math.max(0, raw.cacheRead) : 0,
    cacheWrite:
      typeof raw.cacheWrite === 'number' ? Math.max(0, raw.cacheWrite) : 0,
    updatedAt:
      typeof raw.updatedAt === 'number' ? Math.max(0, raw.updatedAt) : 0,
  };
}

/** Token / model telemetry merged from nodes (see {@link SessionNode.usage}). */
export function mergedSessionUsage(
  snapshot: TuiSnapshot,
): Record<string, SessionUsageEntry> {
  const out: Record<string, SessionUsageEntry> = {};
  for (const bundle of Object.values(snapshot.sessions)) {
    for (const [sid, node] of Object.entries(bundle.tree)) {
      if (node.usage === undefined) continue;
      const usage = coerceSessionUsageEntry(node.usage);
      if (usage) out[sid] = usage;
    }
  }
  return out;
}

export function mergedSessionModels(
  snapshot: TuiSnapshot,
): Record<string, string> {
  const out: Record<string, string> = {};
  const tree = mergedSessionTree(snapshot);
  for (const [sid, node] of Object.entries(tree)) {
    if (node.model) out[sid] = node.model;
  }
  return out;
}

export function mergedSessionVariants(
  snapshot: TuiSnapshot,
): Record<string, string> {
  const out: Record<string, string> = {};
  const tree = mergedSessionTree(snapshot);
  for (const [sid, node] of Object.entries(tree)) {
    if (typeof node.variant === 'string' && node.variant.length > 0) {
      out[sid] = node.variant;
    }
  }
  return out;
}

export function mergedOrchestrationUsageLastSeen(
  snapshot: TuiSnapshot,
): Record<string, SessionUsageDeltaBasis> {
  const out: Record<string, SessionUsageDeltaBasis> = {};
  for (const bundle of Object.values(snapshot.sessions)) {
    Object.assign(out, bundle.orchestrationUsageLastSeen);
  }
  return out;
}

export function mergedOrchestrationSigmaAccum(
  snapshot: TuiSnapshot,
): Record<string, OrchestrationSigmaAccum> {
  const out: Record<string, OrchestrationSigmaAccum> = {};
  for (const [rootId, bundle] of Object.entries(snapshot.sessions)) {
    if (bundle.orchestrationSigmaAccum) {
      out[rootId] = bundle.orchestrationSigmaAccum;
    }
  }
  return out;
}

function touchBundle(bundle: TuiSessionBundle): void {
  bundle.lastActivityAt = Date.now();
}

function locateBundleForSession(
  snapshot: TuiSnapshot,
  sessionID: string,
): { rootId: string; bundle: TuiSessionBundle } | undefined {
  for (const [rootId, bundle] of Object.entries(snapshot.sessions)) {
    if (bundle.tree[sessionID]) return { rootId, bundle };
  }
  return undefined;
}

export function mapOpenCodeStatusToTreeStatus(
  raw: string,
): 'busy' | 'idle' | 'retry' {
  const t = raw.trim().toLowerCase();
  if (t === 'idle') return 'idle';
  if (t === 'retry') return 'retry';
  if (t === 'busy') return 'busy';
  return 'busy';
}

function applyOpenCodeSessionStatus(
  snapshot: TuiSnapshot,
  sessionID: string,
  rawType: string,
): void {
  const mapped = mapOpenCodeStatusToTreeStatus(rawType);
  const hit = locateBundleForSession(snapshot, sessionID);
  if (hit) {
    hit.bundle.tree[sessionID].status = mapped;
    touchBundle(hit.bundle);
    sessionTreeStore[sessionID] = hit.bundle.tree[sessionID];
    return;
  }
  const store = sessionTreeStore[sessionID];
  if (store) store.status = mapped;
}

export function syncOpenCodeStatusesIntoSessionTree(
  snapshot: TuiSnapshot,
  statuses: Record<string, { type: string }>,
): void {
  for (const [sid, row] of Object.entries(statuses)) {
    applyOpenCodeSessionStatus(snapshot, sid, row.type);
  }
}

function upwardRootFrom(
  mergedTree: Record<string, SessionNode>,
  startSessionId: string,
): string {
  let cur = startSessionId;
  const visited = new Set<string>();
  while (!visited.has(cur)) {
    visited.add(cur);
    const parent = mergedTree[cur]?.parentId;
    if (!parent) break;
    cur = parent;
  }
  return cur;
}

function resolveBundleRootForSession(
  snapshot: TuiSnapshot,
  sessionID: string,
  explicitParentId?: string,
): string {
  const merged = mergedSessionTree(snapshot);
  if (!explicitParentId) {
    if (merged[sessionID]) return upwardRootFrom(merged, sessionID);
    return sessionID;
  }
  return upwardRootFrom(merged, explicitParentId);
}

function ensureBundle(
  snapshot: TuiSnapshot,
  rootSessionId: string,
): TuiSessionBundle {
  let bundle = snapshot.sessions[rootSessionId];
  if (!bundle) {
    bundle = emptyBundle(rootSessionId);
    snapshot.sessions[rootSessionId] = bundle;
    touchBundle(bundle);
  }
  return bundle;
}

/** Ensure a writable node exists under this bundle and sync {@link sessionTreeStore}. */
function getOrCreateTreeNode(
  bundle: TuiSessionBundle,
  sessionID: string,
): SessionNode {
  const merged = sessionTreeStore[sessionID] ??
    bundle.tree[sessionID] ?? {
      title: '',
      agent: '',
      model: '',
      childIds: [],
      status: 'busy' as const,
      createdAt: Date.now(),
    };
  bundle.tree[sessionID] = merged;
  sessionTreeStore[sessionID] = merged;
  return merged;
}

function deleteBundleCascade(
  snapshot: TuiSnapshot,
  rootSessionId: string,
): Set<string> {
  const bundle = snapshot.sessions[rootSessionId];
  if (!bundle) return new Set();
  const removedIds = new Set(Object.keys(bundle.tree));
  delete snapshot.sessions[rootSessionId];
  return removedIds;
}

function pruneSessionSidDataInBundle(
  bundle: TuiSessionBundle,
  sid: string,
): void {
  const node = bundle.tree[sid];
  if (node) {
    const needsFlashStart =
      node.status !== 'idle' || node.finishedAt === undefined;
    node.status = 'idle';
    if (needsFlashStart) {
      node.finishedAt = Date.now();
    }
    delete node.usage;
  }
  delete bundle.orchestrationUsageLastSeen[sid];
}

function normalizedBundleProjectForSession(
  snapshot: TuiSnapshot,
  sessionID: string,
): string | undefined {
  const hit = locateBundleForSession(snapshot, sessionID);
  if (!hit?.bundle.projectPath) return undefined;
  return normalizeProjectDirectory(hit.bundle.projectPath);
}

export function expandMissingSessionCascade(
  mergedTree: Record<string, SessionNode>,
  seeds: Iterable<string>,
): Set<string> {
  const ids = new Set(seeds);
  let added = true;
  while (added) {
    added = false;
    for (const [sid, node] of Object.entries(mergedTree)) {
      if (ids.has(sid)) continue;
      const parentId = node.parentId;
      if (parentId && ids.has(parentId)) {
        ids.add(sid);
        added = true;
      }
    }
  }
  return ids;
}

/** True if `descendantCandidate` is not `ancestorId` and has `ancestorId` on its parent chain. */
function isStrictDescendantInMergedTree(
  mergedTree: Record<string, SessionNode>,
  ancestorId: string,
  descendantCandidate: string,
): boolean {
  if (ancestorId === descendantCandidate) return false;
  let cur: string | undefined = descendantCandidate;
  const visited = new Set<string>();
  while (cur && !visited.has(cur)) {
    visited.add(cur);
    if (cur === ancestorId) return true;
    cur = mergedTree[cur]?.parentId;
  }
  return false;
}

function softPruneTargetHasPollDescendant(
  mergedTree: Record<string, SessionNode>,
  targetSid: string,
  opencodeIds: ReadonlySet<string>,
): boolean {
  for (const pollId of opencodeIds) {
    if (isStrictDescendantInMergedTree(mergedTree, targetSid, pollId)) {
      return true;
    }
  }
  return false;
}

/**
 * Drop idle bundles (TTL, whole-tree gone from OpenCode) and soft-prune
 * sessions missing from {@link input.opencodeIds}. Soft-prune skips any id
 * still present in that set so incomplete polls cannot idle a busy child
 * whose parent row was omitted. Ancestors are skipped while any polled id is
 * still their descendant (avoids idling the orchestrator and clearing sigma
 * when the poll omits the root). If incomplete polls persist, callers may add
 * debouncing or skip soft-prune when poll cardinality collapses abruptly.
 */
export function pruneStaleTuiSessionBundles(
  snapshot: TuiSnapshot,
  input: {
    opencodeIds: ReadonlySet<string>;
    currentProjectDir: string;
    now: number;
  },
): Set<string> {
  const strippedFromFile = new Set<string>();

  for (const rootId of Object.keys(snapshot.sessions)) {
    const bundle = snapshot.sessions[rootId];
    if (!bundle) continue;
    if (
      bundle.lastActivityAt > 0 &&
      input.now - bundle.lastActivityAt >= SESSION_BUNDLE_RETENTION_MS
    ) {
      for (const id of deleteBundleCascade(snapshot, rootId)) {
        strippedFromFile.add(id);
      }
    }
  }

  const projectMatched = normalizeProjectDirectory(input.currentProjectDir);

  // Only compare against OpenCode's id list when non-empty. Reconciliation
  // skips when session.status is `{}` (cannot treat as authoritative).
  if (input.opencodeIds.size > 0) {
    for (const rootId of [...Object.keys(snapshot.sessions)]) {
      const bundle = snapshot.sessions[rootId];
      if (!bundle?.projectPath) continue;
      if (normalizeProjectDirectory(bundle.projectPath) !== projectMatched) {
        continue;
      }
      const treeIds = Object.keys(bundle.tree);
      if (treeIds.length === 0) continue;
      if (treeIds.every((id) => !input.opencodeIds.has(id))) {
        for (const id of deleteBundleCascade(snapshot, rootId)) {
          strippedFromFile.add(id);
        }
      }
    }
  }

  const merged = mergedSessionTree(snapshot);
  const missingSeeds =
    input.opencodeIds.size > 0
      ? Object.keys(merged).filter((id) => !input.opencodeIds.has(id))
      : [];
  const expandedMissing = expandMissingSessionCascade(merged, missingSeeds);

  for (const sid of expandedMissing) {
    // OpenCode still lists this session - never wipe it as "missing" just
    // because a parent id was absent from the poll (expandMissingSessionCascade
    // would otherwise include busy children).
    if (input.opencodeIds.has(sid)) continue;
    if (softPruneTargetHasPollDescendant(merged, sid, input.opencodeIds)) {
      continue;
    }

    const projected = normalizedBundleProjectForSession(snapshot, sid);
    if (projected === undefined || projected !== projectMatched) continue;

    const located = locateBundleForSession(snapshot, sid);
    if (!located) continue;

    const { bundle, rootId } = located;
    pruneSessionSidDataInBundle(bundle, sid);
    strippedFromFile.add(sid);

    if (located.bundle.tree[sid]?.agent === 'orchestrator' && sid === rootId) {
      delete bundle.orchestrationSigmaAccum;
    }
    touchBundle(bundle);
  }

  return strippedFromFile;
}

const STATE_DIR = 'opencode-dux';
const STATE_FILE = 'tui-state.json';

function dataDir(): string {
  return (
    process.env.XDG_DATA_HOME ?? path.join(os.homedir(), '.local', 'share')
  );
}

export function getTuiStatePath(): string {
  return path.join(dataDir(), 'opencode', 'storage', STATE_DIR, STATE_FILE);
}

function emptySnapshot(): TuiSnapshot {
  return {
    version: 6,
    updatedAt: Date.now(),
    sessions: {},
    subscriptionUsage: {},
    activeSubscriptionByProvider: {},
  };
}

function normalizeSubscriptionUsage(
  usage: Record<string, SubscriptionUsageEntry>,
): Record<string, SubscriptionUsageEntry> {
  return usage;
}

function normalizeSigmaAccum(
  value: Partial<OrchestrationSigmaAccum> | undefined,
): OrchestrationSigmaAccum | undefined {
  if (!value) return undefined;
  return {
    contextUsed:
      typeof value.contextUsed === 'number'
        ? Math.max(0, value.contextUsed)
        : 0,
    input: typeof value.input === 'number' ? Math.max(0, value.input) : 0,
    output: typeof value.output === 'number' ? Math.max(0, value.output) : 0,
    cacheRead:
      typeof value.cacheRead === 'number' ? Math.max(0, value.cacheRead) : 0,
    cacheWrite:
      typeof value.cacheWrite === 'number' ? Math.max(0, value.cacheWrite) : 0,
  };
}

function normalizeUsageLastSeen(
  value: Record<string, Partial<SessionUsageDeltaBasis>>,
): Record<string, SessionUsageDeltaBasis> {
  const result: Record<string, SessionUsageDeltaBasis> = {};
  for (const [sessionID, entry] of Object.entries(value)) {
    if (!entry) continue;
    result[sessionID] = {
      contextUsed:
        typeof entry.contextUsed === 'number'
          ? Math.max(0, entry.contextUsed)
          : 0,
      input: typeof entry.input === 'number' ? Math.max(0, entry.input) : 0,
      output: typeof entry.output === 'number' ? Math.max(0, entry.output) : 0,
      cacheRead:
        typeof entry.cacheRead === 'number' ? Math.max(0, entry.cacheRead) : 0,
      cacheWrite:
        typeof entry.cacheWrite === 'number'
          ? Math.max(0, entry.cacheWrite)
          : 0,
    };
  }
  return result;
}

function hydrateTreeUsages(tree: Record<string, SessionNode>): void {
  for (const node of Object.values(tree)) {
    if (node.usage === undefined || node.usage === null) continue;
    const u = coerceSessionUsageEntry(node.usage as Partial<SessionUsageEntry>);
    if (u) node.usage = u;
    else delete node.usage;
  }
}

function parseSessionBundles(raw: unknown): Record<string, TuiSessionBundle> {
  const out: Record<string, TuiSessionBundle> = {};
  if (!raw || typeof raw !== 'object') return out;
  const entries = Object.entries(raw as Record<string, unknown>);
  for (const [rootId, value] of entries) {
    if (!value || typeof value !== 'object') continue;
    const v = value as Record<string, unknown>;
    const tree =
      v.tree && typeof v.tree === 'object'
        ? (v.tree as Record<string, SessionNode>)
        : {};
    hydrateTreeUsages(tree);

    const lastActivityAt =
      typeof v.lastActivityAt === 'number' ? v.lastActivityAt : Date.now();
    const projectPath =
      typeof v.projectPath === 'string' && v.projectPath.length > 0
        ? normalizeProjectDirectory(v.projectPath)
        : undefined;

    const bundle: TuiSessionBundle = {
      rootSessionId:
        typeof v.rootSessionId === 'string' && v.rootSessionId.length > 0
          ? v.rootSessionId
          : rootId,
      lastActivityAt,
      projectPath,
      tree,
      orchestrationSigmaAccum: normalizeSigmaAccum(
        v.orchestrationSigmaAccum &&
          typeof v.orchestrationSigmaAccum === 'object'
          ? (v.orchestrationSigmaAccum as Partial<OrchestrationSigmaAccum>)
          : undefined,
      ),
      orchestrationUsageLastSeen: normalizeUsageLastSeen(
        typeof v.orchestrationUsageLastSeen === 'object' &&
          v.orchestrationUsageLastSeen
          ? (v.orchestrationUsageLastSeen as Record<
              string,
              Partial<SessionUsageDeltaBasis>
            >)
          : {},
      ),
    };
    out[rootId] = bundle;
  }
  return out;
}

function parseSnapshot(value: string): TuiSnapshot | null {
  try {
    const parsed = JSON.parse(value) as Partial<TuiSnapshot> | undefined;
    if (parsed?.version !== 6) return null;

    const activeSubscriptionByProvider: Partial<
      Record<SubscriptionProvider, string>
    > = {};
    if (parsed.activeSubscriptionByProvider) {
      for (const provider of ['opencode-go', 'neuralwatt', 'codex'] as const) {
        const name = parsed.activeSubscriptionByProvider[provider];
        if (typeof name === 'string' && name.length > 0) {
          activeSubscriptionByProvider[provider] = name;
        }
      }
    }

    return {
      version: 6,
      updatedAt:
        typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
      sessions: parseSessionBundles(parsed.sessions ?? {}),
      subscriptionUsage: normalizeSubscriptionUsage(
        typeof parsed.subscriptionUsage === 'object' && parsed.subscriptionUsage
          ? (parsed.subscriptionUsage as Record<string, SubscriptionUsageEntry>)
          : {},
      ),
      activeSubscriptionByProvider,
    };
  } catch {
    return null;
  }
}

function tryReadSnapshot(): {
  snapshot: TuiSnapshot;
  okForMutation: boolean;
} {
  const filePath = getTuiStatePath();
  try {
    const parsed = parseSnapshot(fs.readFileSync(filePath, 'utf8'));
    if (parsed) {
      return { snapshot: parsed, okForMutation: true };
    }
    return { snapshot: emptySnapshot(), okForMutation: false };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { snapshot: emptySnapshot(), okForMutation: true };
    }
    return { snapshot: emptySnapshot(), okForMutation: false };
  }
}

export function readTuiSnapshot(): TuiSnapshot {
  return tryReadSnapshot().snapshot;
}

export async function readTuiSnapshotAsync(): Promise<TuiSnapshot> {
  try {
    const parsed = parseSnapshot(
      await fs.promises.readFile(getTuiStatePath(), 'utf8'),
    );
    return parsed ?? emptySnapshot();
  } catch {
    return emptySnapshot();
  }
}

function writeTuiSnapshot(snapshot: TuiSnapshot): void {
  try {
    const filePath = getTuiStatePath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(snapshot)}\n`);
  } catch {
    // best-effort
  }
}

/**
 * Coalesces read-modify-write so overlapping callers never overwrite each
 * other's in-flight edits; nested `updateSnapshot` shares one read+write
 * within the same stack.
 */
let isDrainingSnapshot = false;
const snapshotMutatorQueue: Array<(snapshot: TuiSnapshot) => void> = [];

export function updateSnapshot(mutator: (snapshot: TuiSnapshot) => void): void {
  snapshotMutatorQueue.push(mutator);
  if (isDrainingSnapshot) {
    return;
  }
  isDrainingSnapshot = true;
  try {
    while (snapshotMutatorQueue.length > 0) {
      try {
        const { snapshot, okForMutation } = tryReadSnapshot();
        if (!okForMutation) {
          snapshotMutatorQueue.length = 0;
          break;
        }
        while (snapshotMutatorQueue.length > 0) {
          const m = snapshotMutatorQueue.shift();
          if (m === undefined) {
            break;
          }
          m(snapshot);
        }
        snapshot.updatedAt = Date.now();
        writeTuiSnapshot(snapshot);
      } catch {
        snapshotMutatorQueue.length = 0;
        break;
      }
    }
  } finally {
    isDrainingSnapshot = false;
  }
}

/**
 * Resolves after any pending synchronous `updateSnapshot` work on this thread
 * has finished (writes are synchronous today).
 */
export function flushTuiSnapshot(): Promise<void> {
  return Promise.resolve();
}

export type RecordSessionUsageInput = {
  sessionID: string;
  contextUsed?: number;
  contextLimit?: number;
  contextPct?: number;
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
};

function applyRecordSessionUsageToSnapshot(
  snapshot: TuiSnapshot,
  input: RecordSessionUsageInput,
): void {
  let bundle: TuiSessionBundle | undefined;

  const located = locateBundleForSession(snapshot, input.sessionID);
  if (located) bundle = located.bundle;
  else {
    const rootFallback = resolveBundleRootForSession(snapshot, input.sessionID);
    bundle = ensureBundle(snapshot, rootFallback);
  }

  const node = getOrCreateTreeNode(bundle, input.sessionID);
  const prev = coerceSessionUsageEntry(node.usage);

  const nextContextUsed =
    input.contextUsed !== undefined
      ? Math.max(0, input.contextUsed)
      : (prev?.contextUsed ?? 0);
  const nextContextLimit =
    input.contextLimit != null && input.contextLimit > 0
      ? input.contextLimit
      : (prev?.contextLimit ?? 0);

  const next: SessionUsageEntry = {
    contextUsed: nextContextUsed,
    contextLimit: nextContextLimit,
    contextPct: deriveSessionContextPct(nextContextUsed, nextContextLimit),
    input:
      input.input !== undefined
        ? Math.max(prev?.input ?? 0, input.input)
        : (prev?.input ?? 0),
    output:
      input.output !== undefined
        ? Math.max(prev?.output ?? 0, input.output)
        : (prev?.output ?? 0),
    reasoning:
      input.reasoning !== undefined
        ? Math.max(prev?.reasoning ?? 0, input.reasoning)
        : (prev?.reasoning ?? 0),
    cacheRead:
      input.cacheRead !== undefined
        ? Math.max(prev?.cacheRead ?? 0, input.cacheRead)
        : (prev?.cacheRead ?? 0),
    cacheWrite:
      input.cacheWrite !== undefined
        ? Math.max(prev?.cacheWrite ?? 0, input.cacheWrite)
        : (prev?.cacheWrite ?? 0),
    updatedAt: Date.now(),
  };
  node.usage = next;
  touchBundle(bundle);

  const rootSessionID = resolveOrchestrationRootSessionID(
    snapshot,
    input.sessionID,
  );
  if (!rootSessionID) return;

  const orchBundle = locateBundleForSession(snapshot, rootSessionID);
  if (!orchBundle) return;

  const previousSeen = orchBundle.bundle.orchestrationUsageLastSeen[
    input.sessionID
  ] ?? {
    contextUsed: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  };
  const nextSeen: SessionUsageDeltaBasis = {
    contextUsed: next.contextUsed,
    input: next.input,
    output: next.output,
    cacheRead: next.cacheRead,
    cacheWrite: next.cacheWrite,
  };
  const deltaContextUsed = Math.max(
    0,
    nextSeen.contextUsed - previousSeen.contextUsed,
  );
  const deltaInput = Math.max(0, nextSeen.input - previousSeen.input);
  const deltaOutput = Math.max(0, nextSeen.output - previousSeen.output);
  const deltaCacheRead = Math.max(
    0,
    nextSeen.cacheRead - previousSeen.cacheRead,
  );
  const deltaCacheWrite = Math.max(
    0,
    nextSeen.cacheWrite - previousSeen.cacheWrite,
  );
  const prevAccum = orchBundle.bundle.orchestrationSigmaAccum ?? {
    contextUsed: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  };
  orchBundle.bundle.orchestrationSigmaAccum = {
    contextUsed: prevAccum.contextUsed + deltaContextUsed,
    input: prevAccum.input + deltaInput,
    output: prevAccum.output + deltaOutput,
    cacheRead: prevAccum.cacheRead + deltaCacheRead,
    cacheWrite: prevAccum.cacheWrite + deltaCacheWrite,
  };
  orchBundle.bundle.orchestrationUsageLastSeen[input.sessionID] = nextSeen;
  touchBundle(orchBundle.bundle);
}

export function recordSessionUsagesBatch(
  inputs: RecordSessionUsageInput[],
): void {
  if (inputs.length === 0) return;
  updateSnapshot((snapshot) => {
    for (const input of inputs) {
      applyRecordSessionUsageToSnapshot(snapshot, input);
    }
  });
}

/**
 * One persisted write for delegate-spawned subagent: tree node + parent
 * `childIds` + {@link sessionTreeStore} parent link.
 */
export function recordDelegatedSubagentSession(input: {
  sessionID: string;
  parentSessionId: string;
  agent: string;
  variant?: string;
  mode?: 'blocking' | 'fire_forget';
}): void {
  updateSnapshot((snapshot) => {
    const rootId = resolveBundleRootForSession(
      snapshot,
      input.sessionID,
      input.parentSessionId,
    );
    const bundle = ensureBundle(snapshot, rootId);

    const existing = sessionTreeStore[input.sessionID] ??
      bundle.tree[input.sessionID] ?? {
        title: '',
        agent: '',
        model: '',
        childIds: [],
        status: 'busy' as const,
        createdAt: Date.now(),
      };
    const node: SessionNode = {
      ...existing,
      title: existing.title,
      agent: input.agent || existing.agent,
      model: existing.model,
      variant: input.variant !== undefined ? input.variant : existing.variant,
      parentId: input.parentSessionId,
      mode: input.mode !== undefined ? input.mode : existing.mode,
      status: existing.status,
      createdAt: existing.createdAt,
    };
    bundle.tree[input.sessionID] = node;
    sessionTreeStore[input.sessionID] = node;
    touchBundle(bundle);

    for (const b of Object.values(snapshot.sessions)) {
      const parent = b.tree[input.parentSessionId];
      if (!parent) continue;
      if (!parent.childIds.includes(input.sessionID)) {
        parent.childIds.push(input.sessionID);
      }
      b.lastActivityAt = Date.now();
    }
    const storeParent = sessionTreeStore[input.parentSessionId];
    if (storeParent && !storeParent.childIds.includes(input.sessionID)) {
      storeParent.childIds.push(input.sessionID);
    }
  });
}

/**
 * One persisted write for `session.created`: node, optional parent `childIds`,
 * optional project path.
 */
export function recordChildSessionSnapshot(input: {
  sessionID: string;
  title: string;
  parentSessionId?: string;
  projectPath?: string;
}): void {
  updateSnapshot((snapshot) => {
    const rootId = resolveBundleRootForSession(
      snapshot,
      input.sessionID,
      input.parentSessionId,
    );
    const bundle = ensureBundle(snapshot, rootId);

    const existing = sessionTreeStore[input.sessionID] ??
      bundle.tree[input.sessionID] ?? {
        title: '',
        agent: '',
        model: '',
        childIds: [],
        status: 'busy' as const,
        createdAt: Date.now(),
      };
    const node: SessionNode = {
      ...existing,
      title: input.title ?? existing.title,
      agent: existing.agent,
      model: existing.model,
      variant: existing.variant,
      parentId:
        input.parentSessionId !== undefined
          ? input.parentSessionId
          : existing.parentId,
      mode: existing.mode,
      status: existing.status,
      createdAt: existing.createdAt,
    };
    bundle.tree[input.sessionID] = node;
    sessionTreeStore[input.sessionID] = node;
    touchBundle(bundle);

    if (input.parentSessionId) {
      for (const b of Object.values(snapshot.sessions)) {
        const parent = b.tree[input.parentSessionId];
        if (!parent) continue;
        if (!parent.childIds.includes(input.sessionID)) {
          parent.childIds.push(input.sessionID);
        }
        b.lastActivityAt = Date.now();
      }
      const storeParent = sessionTreeStore[input.parentSessionId];
      if (storeParent && !storeParent.childIds.includes(input.sessionID)) {
        storeParent.childIds.push(input.sessionID);
      }
    }

    if (input.projectPath !== undefined && input.projectPath.length > 0) {
      const normalized = normalizeProjectDirectory(input.projectPath);
      const rootForProject = resolveBundleRootForSession(
        snapshot,
        input.sessionID,
      );
      const projectBundle = ensureBundle(snapshot, rootForProject);
      projectBundle.projectPath = normalized;
      touchBundle(projectBundle);
    }
  });
}

export function patchSessionTreeStatusFromOpenCode(
  sessionID: string,
  rawType: string,
): void {
  updateSnapshot((snapshot) => {
    applyOpenCodeSessionStatus(snapshot, sessionID, rawType);
  });
}

export function recordSessionEnd(sessionID: string): void {
  updateSnapshot((snapshot) => {
    const located = locateBundleForSession(snapshot, sessionID);
    const node = located?.bundle.tree[sessionID] ?? sessionTreeStore[sessionID];
    if (node) delete node.usage;
    if (located) touchBundle(located.bundle);
  });
}

export function recordSessionModel(input: {
  sessionID: string;
  model: string;
}): void {
  updateSnapshot((snapshot) => {
    const rootId = resolveBundleRootForSession(snapshot, input.sessionID);
    const bundle = ensureBundle(snapshot, rootId);
    const node = getOrCreateTreeNode(bundle, input.sessionID);
    node.model = input.model;
    touchBundle(bundle);
  });
}

export function recordSessionVariant(input: {
  sessionID: string;
  variant: string;
}): void {
  updateSnapshot((snapshot) => {
    const rootId = resolveBundleRootForSession(snapshot, input.sessionID);
    const bundle = ensureBundle(snapshot, rootId);
    const node = getOrCreateTreeNode(bundle, input.sessionID);
    node.variant = input.variant;
    touchBundle(bundle);
  });
}

export function recordSessionNode(input: {
  sessionID: string;
  /** Omit to keep the existing title (e.g. from `session.created`). Pass `''` to clear. */
  title?: string;
  agent: string;
  model?: string;
  variant?: string;
  parentId?: string;
  mode?: 'blocking' | 'fire_forget';
  status?: 'busy' | 'idle' | 'retry';
}): void {
  updateSnapshot((snapshot) => {
    const rootId = resolveBundleRootForSession(
      snapshot,
      input.sessionID,
      input.parentId,
    );
    const bundle = ensureBundle(snapshot, rootId);

    const existing = sessionTreeStore[input.sessionID] ??
      bundle.tree[input.sessionID] ?? {
        title: '',
        agent: '',
        model: '',
        childIds: [],
        status: 'busy' as const,
        createdAt: Date.now(),
      };
    const node = {
      ...existing,
      title: input.title !== undefined ? input.title : existing.title,
      agent: input.agent || existing.agent,
      model: input.model ?? existing.model,
      variant: input.variant !== undefined ? input.variant : existing.variant,
      parentId:
        input.parentId !== undefined ? input.parentId : existing.parentId,
      mode: input.mode !== undefined ? input.mode : existing.mode,
      status: input.status ?? existing.status,
      createdAt: existing.createdAt,
    };
    bundle.tree[input.sessionID] = node;
    sessionTreeStore[input.sessionID] = node;
    touchBundle(bundle);
  });
}

/** Persist session title from OpenCode when the SDK reports a non-empty name. */
export function recordSessionTitle(input: {
  sessionID: string;
  title: string;
}): void {
  const trimmed = input.title.trim();
  if (!trimmed) return;
  updateSnapshot((snapshot) => {
    const hit = locateBundleForSession(snapshot, input.sessionID);
    if (hit) {
      const node = hit.bundle.tree[input.sessionID];
      if (node) {
        node.title = trimmed;
        sessionTreeStore[input.sessionID] = node;
        touchBundle(hit.bundle);
      }
      return;
    }
    const rootId = resolveBundleRootForSession(snapshot, input.sessionID);
    const bundle = ensureBundle(snapshot, rootId);
    const node = getOrCreateTreeNode(bundle, input.sessionID);
    node.title = trimmed;
    touchBundle(bundle);
  });
}

export function recordSessionDone(sessionID: string): void {
  updateSnapshot((snapshot) => {
    const hit = locateBundleForSession(snapshot, sessionID);
    if (hit) {
      const node = hit.bundle.tree[sessionID];
      if (node) {
        node.status = 'idle';
        node.finishedAt = Date.now();
      }
      touchBundle(hit.bundle);
    }
    const storeNode = sessionTreeStore[sessionID];
    if (storeNode) {
      storeNode.status = 'idle';
      storeNode.finishedAt = Date.now();
    }
  });
}

function resolveOrchestrationRootSessionID(
  snapshot: TuiSnapshot,
  sessionID: string,
): string | null {
  const merged = mergedSessionTree(snapshot);
  let currentID: string | undefined = sessionID;
  const visited = new Set<string>();
  while (currentID && !visited.has(currentID)) {
    visited.add(currentID);
    const treeNode: SessionNode | undefined = merged[currentID];
    if (!treeNode) return null;
    if (treeNode.agent === 'orchestrator') return currentID;
    currentID = treeNode.parentId;
  }
  return null;
}

export function recordSessionUsage(input: RecordSessionUsageInput): void {
  updateSnapshot((snapshot) => {
    applyRecordSessionUsageToSnapshot(snapshot, input);
  });
}

export function subscriptionUsageKey(
  provider: SubscriptionProvider,
  accountName: string,
): string {
  return `${provider}\u0000${accountName}`;
}

export function recordSubscriptionUsage(usage: SubscriptionUsageEntry[]): void {
  updateSnapshot((snapshot) => {
    snapshot.subscriptionUsage = {};
    for (const entry of usage) {
      if (entry.accountName) {
        snapshot.subscriptionUsage[
          subscriptionUsageKey(entry.provider, entry.accountName)
        ] = entry;
      }
    }
  });
}

export function removeSubscriptionUsageEntry(
  provider: SubscriptionProvider,
  name: string,
): void {
  updateSnapshot((snapshot) => {
    delete snapshot.subscriptionUsage[subscriptionUsageKey(provider, name)];
  });
}

export function recordSessionProject(input: {
  sessionID: string;
  projectPath: string;
}): void {
  const normalized = normalizeProjectDirectory(input.projectPath);
  updateSnapshot((snapshot) => {
    const rootId = resolveBundleRootForSession(snapshot, input.sessionID);
    const bundle = ensureBundle(snapshot, rootId);
    bundle.projectPath = normalized;
    touchBundle(bundle);
  });
}

export function deleteSessionEntries(sessionID: string): void {
  updateSnapshot((snapshot) => {
    const located = locateBundleForSession(snapshot, sessionID);
    if (!located) return;
    const { bundle, rootId } = located;

    delete bundle.orchestrationUsageLastSeen[sessionID];

    // Root bundle key removed - drop entire orchestration snapshot for this tree.
    if (sessionID === rootId) {
      for (const id of deleteBundleCascade(snapshot, rootId)) {
        delete sessionTreeStore[id];
      }
      return;
    }

    const node = bundle.tree[sessionID];
    const parentId = node?.parentId;
    delete bundle.tree[sessionID];
    delete sessionTreeStore[sessionID];

    if (parentId) {
      const parent = bundle.tree[parentId];
      if (parent) {
        parent.childIds = parent.childIds.filter((c) => c !== sessionID);
      }
      const storeParent = sessionTreeStore[parentId];
      if (storeParent?.childIds) {
        storeParent.childIds = storeParent.childIds.filter(
          (c) => c !== sessionID,
        );
      }
    }

    if (Object.keys(bundle.tree).length === 0) {
      delete snapshot.sessions[rootId];
      return;
    }

    touchBundle(bundle);
  });
}

export function recordActiveSubscriptionForProvider(
  provider: SubscriptionProvider,
  name: string | null,
): void {
  updateSnapshot((snapshot) => {
    if (name) {
      snapshot.activeSubscriptionByProvider[provider] = name;
    } else {
      delete snapshot.activeSubscriptionByProvider[provider];
    }
  });
}
