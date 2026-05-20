import { createRequire } from "node:module";
var __create = Object.create;
var __getProtoOf = Object.getPrototypeOf;
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
function __accessProp(key) {
  return this[key];
}
var __toESMCache_node;
var __toESMCache_esm;
var __toESM = (mod, isNodeMode, target) => {
  var canCache = mod != null && typeof mod === "object";
  if (canCache) {
    var cache = isNodeMode ? __toESMCache_node ??= new WeakMap : __toESMCache_esm ??= new WeakMap;
    var cached = cache.get(mod);
    if (cached)
      return cached;
  }
  target = mod != null ? __create(__getProtoOf(mod)) : {};
  const to = isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target;
  for (let key of __getOwnPropNames(mod))
    if (!__hasOwnProp.call(to, key))
      __defProp(to, key, {
        get: __accessProp.bind(mod, key),
        enumerable: true
      });
  if (canCache)
    cache.set(mod, to);
  return to;
};
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var __require = /* @__PURE__ */ createRequire(import.meta.url);

// src/tui.ts
import { createElement, insert, setProp } from "@opentui/solid";
import { createSignal } from "solid-js";

// src/agents/descriptions.ts
var AGENT_DESCRIPTIONS = {
  explorer: `<agent name="@explorer">
- Role: codebase search specialist
- Delegate when: locate files, usages, symbols, tests, config links
- Do not use when: exact file is already known and must be read in full
</agent>`,
  librarian: `<agent name="@librarian">
- Role: external docs and API reference specialist
- Delegate when: library behavior, version details, official examples, upstream GitHub issues/PRs/releases
- Do not use when: pure language fundamentals or local code discovery
</agent>`,
  oracle: `<agent name="@oracle">
- Role: technical analysis and code review; uses orchestrator \`model\` + \`variant\` matrix
- Delegate when: debugging, architecture, tradeoffs, risk, any review depth
- Do not use when: pure local discovery (@explorer) or docs-only (@librarian)
</agent>`,
  designer: `<agent name="@designer">
- Role: UI/UX specialist for ALL user-facing UI — new pages, existing component changes, layout updates, styling, visual polish, a11y
- Delegate when: ANY change to TSX/JSX files, components, pages, layouts, styling, or user-facing visual elements — BEFORE @oracle or @fixer
- Do not use when: backend-only, non-visual work, or pure logic changes (hooks/utils) that don't affect rendering
</agent>`,
  fixer: `<agent name="@fixer">
- Role: implementation specialist
- Delegate when: edits, tests, scoped commands-after gates in <first_gate> when applicable
- Do not use when: strategy/conventions/UI design still unresolved-delegate upward first
</agent>`,
  steward: `<agent name="@steward">
- Role: rules citation from steward_paths — verbatim excerpts only; does NOT analyze, evaluate, or compare rules
- Delegate when: repo conventions needed before oracle/fixer (see <first_gate> 1)
- Do not use when: pure symbol search (@explorer); rules analysis (@oracle).
</agent>`,
  interpreter: `<agent name="@interpreter">
- Role: screenshot / attached-image analyst
- Delegate when: user message has images and task is not redesign-only
- Do not use when: redesign-only-use @designer; text-only prompts
</agent>`
};
var AGENT_SIDEBAR_DESCRIPTIONS = {
  orchestrator: "Orchestrates",
  explorer: "File Search",
  librarian: "Doc Search",
  oracle: "Architecture",
  designer: "Design",
  fixer: "Implement",
  steward: "Repo rules",
  interpreter: "Vision"
};

// src/tui-state.ts
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
var sessionTreeStore = {};
var SESSION_BUNDLE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
function emptyBundle(rootSessionId) {
  return {
    rootSessionId,
    lastActivityAt: Date.now(),
    tree: {},
    orchestrationUsageLastSeen: {}
  };
}
function normalizeProjectDirectory(raw) {
  return path.normalize(path.resolve(raw));
}
function mergedSessionTree(snapshot) {
  const out = {};
  for (const bundle of Object.values(snapshot.sessions)) {
    Object.assign(out, bundle.tree);
  }
  return out;
}
function deriveSessionContextPct(used, limit) {
  if (!(limit > 0))
    return 0;
  if (!(Number.isFinite(used) && Number.isFinite(limit)))
    return 0;
  const safeUsed = Math.max(0, used);
  return Math.max(0, Math.min(100, safeUsed / limit * 100));
}
function coerceSessionUsageEntry(raw) {
  if (!raw || typeof raw !== "object")
    return;
  return {
    contextUsed: typeof raw.contextUsed === "number" ? Math.max(0, raw.contextUsed) : 0,
    contextLimit: typeof raw.contextLimit === "number" ? Math.max(0, raw.contextLimit) : 0,
    contextPct: typeof raw.contextPct === "number" ? Math.max(0, Math.min(100, raw.contextPct)) : 0,
    input: typeof raw.input === "number" ? Math.max(0, raw.input) : 0,
    output: typeof raw.output === "number" ? Math.max(0, raw.output) : 0,
    reasoning: typeof raw.reasoning === "number" ? Math.max(0, raw.reasoning) : 0,
    cacheRead: typeof raw.cacheRead === "number" ? Math.max(0, raw.cacheRead) : 0,
    cacheWrite: typeof raw.cacheWrite === "number" ? Math.max(0, raw.cacheWrite) : 0,
    updatedAt: typeof raw.updatedAt === "number" ? Math.max(0, raw.updatedAt) : 0
  };
}
function mergedSessionUsage(snapshot) {
  const out = {};
  for (const bundle of Object.values(snapshot.sessions)) {
    for (const [sid, node] of Object.entries(bundle.tree)) {
      if (node.usage === undefined)
        continue;
      const usage = coerceSessionUsageEntry(node.usage);
      if (usage)
        out[sid] = usage;
    }
  }
  return out;
}
function mergedSessionModels(snapshot) {
  const out = {};
  const tree = mergedSessionTree(snapshot);
  for (const [sid, node] of Object.entries(tree)) {
    if (node.model)
      out[sid] = node.model;
  }
  return out;
}
function mergedOrchestrationSigmaAccum(snapshot) {
  const out = {};
  for (const [rootId, bundle] of Object.entries(snapshot.sessions)) {
    if (bundle.orchestrationSigmaAccum) {
      out[rootId] = bundle.orchestrationSigmaAccum;
    }
  }
  return out;
}
function touchBundle(bundle) {
  bundle.lastActivityAt = Date.now();
}
function locateBundleForSession(snapshot, sessionID) {
  for (const [rootId, bundle] of Object.entries(snapshot.sessions)) {
    if (bundle.tree[sessionID])
      return { rootId, bundle };
  }
  return;
}
function mapOpenCodeStatusToTreeStatus(raw) {
  const t = raw.trim().toLowerCase();
  if (t === "idle")
    return "idle";
  if (t === "retry")
    return "retry";
  if (t === "busy")
    return "busy";
  return "busy";
}
function applyOpenCodeSessionStatus(snapshot, sessionID, rawType) {
  const mapped = mapOpenCodeStatusToTreeStatus(rawType);
  const hit = locateBundleForSession(snapshot, sessionID);
  if (hit) {
    hit.bundle.tree[sessionID].status = mapped;
    touchBundle(hit.bundle);
    sessionTreeStore[sessionID] = hit.bundle.tree[sessionID];
    return;
  }
  const store = sessionTreeStore[sessionID];
  if (store)
    store.status = mapped;
}
function syncOpenCodeStatusesIntoSessionTree(snapshot, statuses) {
  for (const [sid, row] of Object.entries(statuses)) {
    applyOpenCodeSessionStatus(snapshot, sid, row.type);
  }
}
function upwardRootFrom(mergedTree, startSessionId) {
  let cur = startSessionId;
  const visited = new Set;
  while (!visited.has(cur)) {
    visited.add(cur);
    const parent = mergedTree[cur]?.parentId;
    if (!parent)
      break;
    cur = parent;
  }
  return cur;
}
function resolveBundleRootForSession(snapshot, sessionID, explicitParentId) {
  const merged = mergedSessionTree(snapshot);
  if (!explicitParentId) {
    if (merged[sessionID])
      return upwardRootFrom(merged, sessionID);
    return sessionID;
  }
  return upwardRootFrom(merged, explicitParentId);
}
function ensureBundle(snapshot, rootSessionId) {
  let bundle = snapshot.sessions[rootSessionId];
  if (!bundle) {
    bundle = emptyBundle(rootSessionId);
    snapshot.sessions[rootSessionId] = bundle;
    touchBundle(bundle);
  }
  return bundle;
}
function getOrCreateTreeNode(bundle, sessionID) {
  const merged = sessionTreeStore[sessionID] ?? bundle.tree[sessionID] ?? {
    title: "",
    agent: "",
    model: "",
    childIds: [],
    status: "busy",
    createdAt: Date.now()
  };
  bundle.tree[sessionID] = merged;
  sessionTreeStore[sessionID] = merged;
  return merged;
}
function deleteBundleCascade(snapshot, rootSessionId) {
  const bundle = snapshot.sessions[rootSessionId];
  if (!bundle)
    return new Set;
  const removedIds = new Set(Object.keys(bundle.tree));
  delete snapshot.sessions[rootSessionId];
  return removedIds;
}
function pruneSessionSidDataInBundle(bundle, sid) {
  const node = bundle.tree[sid];
  if (node) {
    const needsFlashStart = node.status !== "idle" || node.finishedAt === undefined;
    node.status = "idle";
    if (needsFlashStart) {
      node.finishedAt = Date.now();
    }
    delete node.usage;
  }
  delete bundle.orchestrationUsageLastSeen[sid];
}
function normalizedBundleProjectForSession(snapshot, sessionID) {
  const hit = locateBundleForSession(snapshot, sessionID);
  if (!hit?.bundle.projectPath)
    return;
  return normalizeProjectDirectory(hit.bundle.projectPath);
}
function expandMissingSessionCascade(mergedTree, seeds) {
  const ids = new Set(seeds);
  let added = true;
  while (added) {
    added = false;
    for (const [sid, node] of Object.entries(mergedTree)) {
      if (ids.has(sid))
        continue;
      const parentId = node.parentId;
      if (parentId && ids.has(parentId)) {
        ids.add(sid);
        added = true;
      }
    }
  }
  return ids;
}
function isStrictDescendantInMergedTree(mergedTree, ancestorId, descendantCandidate) {
  if (ancestorId === descendantCandidate)
    return false;
  let cur = descendantCandidate;
  const visited = new Set;
  while (cur && !visited.has(cur)) {
    visited.add(cur);
    if (cur === ancestorId)
      return true;
    cur = mergedTree[cur]?.parentId;
  }
  return false;
}
function softPruneTargetHasPollDescendant(mergedTree, targetSid, opencodeIds) {
  for (const pollId of opencodeIds) {
    if (isStrictDescendantInMergedTree(mergedTree, targetSid, pollId)) {
      return true;
    }
  }
  return false;
}
function pruneStaleTuiSessionBundles(snapshot, input) {
  const strippedFromFile = new Set;
  for (const rootId of Object.keys(snapshot.sessions)) {
    const bundle = snapshot.sessions[rootId];
    if (!bundle)
      continue;
    if (bundle.lastActivityAt > 0 && input.now - bundle.lastActivityAt >= SESSION_BUNDLE_RETENTION_MS) {
      for (const id of deleteBundleCascade(snapshot, rootId)) {
        strippedFromFile.add(id);
      }
    }
  }
  const projectMatched = normalizeProjectDirectory(input.currentProjectDir);
  if (input.opencodeIds.size > 0) {
    for (const rootId of [...Object.keys(snapshot.sessions)]) {
      const bundle = snapshot.sessions[rootId];
      if (!bundle?.projectPath)
        continue;
      if (normalizeProjectDirectory(bundle.projectPath) !== projectMatched) {
        continue;
      }
      const treeIds = Object.keys(bundle.tree);
      if (treeIds.length === 0)
        continue;
      if (treeIds.every((id) => !input.opencodeIds.has(id))) {
        for (const id of deleteBundleCascade(snapshot, rootId)) {
          strippedFromFile.add(id);
        }
      }
    }
  }
  const merged = mergedSessionTree(snapshot);
  const missingSeeds = input.opencodeIds.size > 0 ? Object.keys(merged).filter((id) => !input.opencodeIds.has(id)) : [];
  const expandedMissing = expandMissingSessionCascade(merged, missingSeeds);
  for (const sid of expandedMissing) {
    if (input.opencodeIds.has(sid))
      continue;
    if (softPruneTargetHasPollDescendant(merged, sid, input.opencodeIds)) {
      continue;
    }
    const projected = normalizedBundleProjectForSession(snapshot, sid);
    if (projected === undefined || projected !== projectMatched)
      continue;
    const located = locateBundleForSession(snapshot, sid);
    if (!located)
      continue;
    const { bundle, rootId } = located;
    pruneSessionSidDataInBundle(bundle, sid);
    strippedFromFile.add(sid);
    if (located.bundle.tree[sid]?.agent === "orchestrator" && sid === rootId) {
      delete bundle.orchestrationSigmaAccum;
    }
    touchBundle(bundle);
  }
  return strippedFromFile;
}
var STATE_DIR = "opencode-dux";
var STATE_FILE = "tui-state.json";
function dataDir() {
  return process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share");
}
function getTuiStatePath() {
  return path.join(dataDir(), "opencode", "storage", STATE_DIR, STATE_FILE);
}
function emptySnapshot() {
  return {
    version: 6,
    updatedAt: Date.now(),
    sessions: {},
    subscriptionUsage: {},
    activeSubscriptionByProvider: {}
  };
}
function normalizeSubscriptionUsage(usage) {
  return usage;
}
function normalizeSigmaAccum(value) {
  if (!value)
    return;
  return {
    contextUsed: typeof value.contextUsed === "number" ? Math.max(0, value.contextUsed) : 0,
    input: typeof value.input === "number" ? Math.max(0, value.input) : 0,
    output: typeof value.output === "number" ? Math.max(0, value.output) : 0,
    cacheRead: typeof value.cacheRead === "number" ? Math.max(0, value.cacheRead) : 0,
    cacheWrite: typeof value.cacheWrite === "number" ? Math.max(0, value.cacheWrite) : 0
  };
}
function normalizeUsageLastSeen(value) {
  const result = {};
  for (const [sessionID, entry] of Object.entries(value)) {
    if (!entry)
      continue;
    result[sessionID] = {
      contextUsed: typeof entry.contextUsed === "number" ? Math.max(0, entry.contextUsed) : 0,
      input: typeof entry.input === "number" ? Math.max(0, entry.input) : 0,
      output: typeof entry.output === "number" ? Math.max(0, entry.output) : 0,
      cacheRead: typeof entry.cacheRead === "number" ? Math.max(0, entry.cacheRead) : 0,
      cacheWrite: typeof entry.cacheWrite === "number" ? Math.max(0, entry.cacheWrite) : 0
    };
  }
  return result;
}
function hydrateTreeUsages(tree) {
  for (const node of Object.values(tree)) {
    if (node.usage === undefined || node.usage === null)
      continue;
    const u = coerceSessionUsageEntry(node.usage);
    if (u)
      node.usage = u;
    else
      delete node.usage;
  }
}
function parseSessionBundles(raw) {
  const out = {};
  if (!raw || typeof raw !== "object")
    return out;
  const entries = Object.entries(raw);
  for (const [rootId, value] of entries) {
    if (!value || typeof value !== "object")
      continue;
    const v = value;
    const tree = v.tree && typeof v.tree === "object" ? v.tree : {};
    hydrateTreeUsages(tree);
    const lastActivityAt = typeof v.lastActivityAt === "number" ? v.lastActivityAt : Date.now();
    const projectPath = typeof v.projectPath === "string" && v.projectPath.length > 0 ? normalizeProjectDirectory(v.projectPath) : undefined;
    const bundle = {
      rootSessionId: typeof v.rootSessionId === "string" && v.rootSessionId.length > 0 ? v.rootSessionId : rootId,
      lastActivityAt,
      projectPath,
      tree,
      orchestrationSigmaAccum: normalizeSigmaAccum(v.orchestrationSigmaAccum && typeof v.orchestrationSigmaAccum === "object" ? v.orchestrationSigmaAccum : undefined),
      orchestrationUsageLastSeen: normalizeUsageLastSeen(typeof v.orchestrationUsageLastSeen === "object" && v.orchestrationUsageLastSeen ? v.orchestrationUsageLastSeen : {})
    };
    out[rootId] = bundle;
  }
  return out;
}
function parseSnapshot(value) {
  try {
    const parsed = JSON.parse(value);
    if (parsed?.version !== 6)
      return null;
    const activeSubscriptionByProvider = {};
    if (parsed.activeSubscriptionByProvider) {
      for (const provider of ["opencode-go", "neuralwatt"]) {
        const name = parsed.activeSubscriptionByProvider[provider];
        if (typeof name === "string" && name.length > 0) {
          activeSubscriptionByProvider[provider] = name;
        }
      }
    }
    return {
      version: 6,
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : Date.now(),
      sessions: parseSessionBundles(parsed.sessions ?? {}),
      subscriptionUsage: normalizeSubscriptionUsage(typeof parsed.subscriptionUsage === "object" && parsed.subscriptionUsage ? parsed.subscriptionUsage : {}),
      activeSubscriptionByProvider
    };
  } catch {
    return null;
  }
}
function tryReadSnapshot() {
  const filePath = getTuiStatePath();
  try {
    const parsed = parseSnapshot(fs.readFileSync(filePath, "utf8"));
    if (parsed) {
      return { snapshot: parsed, okForMutation: true };
    }
    return { snapshot: emptySnapshot(), okForMutation: false };
  } catch (error) {
    if (error.code === "ENOENT") {
      return { snapshot: emptySnapshot(), okForMutation: true };
    }
    return { snapshot: emptySnapshot(), okForMutation: false };
  }
}
function readTuiSnapshot() {
  return tryReadSnapshot().snapshot;
}
async function readTuiSnapshotAsync() {
  try {
    const parsed = parseSnapshot(await fs.promises.readFile(getTuiStatePath(), "utf8"));
    return parsed ?? emptySnapshot();
  } catch {
    return emptySnapshot();
  }
}
function writeTuiSnapshot(snapshot) {
  try {
    const filePath = getTuiStatePath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(snapshot)}
`);
  } catch {}
}
var isDrainingSnapshot = false;
var snapshotMutatorQueue = [];
function updateSnapshot(mutator) {
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
function applyRecordSessionUsageToSnapshot(snapshot, input) {
  let bundle;
  const located = locateBundleForSession(snapshot, input.sessionID);
  if (located)
    bundle = located.bundle;
  else {
    const rootFallback = resolveBundleRootForSession(snapshot, input.sessionID);
    bundle = ensureBundle(snapshot, rootFallback);
  }
  const node = getOrCreateTreeNode(bundle, input.sessionID);
  const prev = coerceSessionUsageEntry(node.usage);
  const nextContextUsed = input.contextUsed !== undefined ? Math.max(0, input.contextUsed) : prev?.contextUsed ?? 0;
  const nextContextLimit = input.contextLimit != null && input.contextLimit > 0 ? input.contextLimit : prev?.contextLimit ?? 0;
  const next = {
    contextUsed: nextContextUsed,
    contextLimit: nextContextLimit,
    contextPct: deriveSessionContextPct(nextContextUsed, nextContextLimit),
    input: input.input !== undefined ? Math.max(prev?.input ?? 0, input.input) : prev?.input ?? 0,
    output: input.output !== undefined ? Math.max(prev?.output ?? 0, input.output) : prev?.output ?? 0,
    reasoning: input.reasoning !== undefined ? Math.max(prev?.reasoning ?? 0, input.reasoning) : prev?.reasoning ?? 0,
    cacheRead: input.cacheRead !== undefined ? Math.max(prev?.cacheRead ?? 0, input.cacheRead) : prev?.cacheRead ?? 0,
    cacheWrite: input.cacheWrite !== undefined ? Math.max(prev?.cacheWrite ?? 0, input.cacheWrite) : prev?.cacheWrite ?? 0,
    updatedAt: Date.now()
  };
  node.usage = next;
  touchBundle(bundle);
  const rootSessionID = resolveOrchestrationRootSessionID(snapshot, input.sessionID);
  if (!rootSessionID)
    return;
  const orchBundle = locateBundleForSession(snapshot, rootSessionID);
  if (!orchBundle)
    return;
  const previousSeen = orchBundle.bundle.orchestrationUsageLastSeen[input.sessionID] ?? {
    contextUsed: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0
  };
  const nextSeen = {
    contextUsed: next.contextUsed,
    input: next.input,
    output: next.output,
    cacheRead: next.cacheRead,
    cacheWrite: next.cacheWrite
  };
  const deltaContextUsed = Math.max(0, nextSeen.contextUsed - previousSeen.contextUsed);
  const deltaInput = Math.max(0, nextSeen.input - previousSeen.input);
  const deltaOutput = Math.max(0, nextSeen.output - previousSeen.output);
  const deltaCacheRead = Math.max(0, nextSeen.cacheRead - previousSeen.cacheRead);
  const deltaCacheWrite = Math.max(0, nextSeen.cacheWrite - previousSeen.cacheWrite);
  const prevAccum = orchBundle.bundle.orchestrationSigmaAccum ?? {
    contextUsed: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0
  };
  orchBundle.bundle.orchestrationSigmaAccum = {
    contextUsed: prevAccum.contextUsed + deltaContextUsed,
    input: prevAccum.input + deltaInput,
    output: prevAccum.output + deltaOutput,
    cacheRead: prevAccum.cacheRead + deltaCacheRead,
    cacheWrite: prevAccum.cacheWrite + deltaCacheWrite
  };
  orchBundle.bundle.orchestrationUsageLastSeen[input.sessionID] = nextSeen;
  touchBundle(orchBundle.bundle);
}
function recordSessionUsagesBatch(inputs) {
  if (inputs.length === 0)
    return;
  updateSnapshot((snapshot) => {
    for (const input of inputs) {
      applyRecordSessionUsageToSnapshot(snapshot, input);
    }
  });
}
function recordDelegatedSubagentSession(input) {
  updateSnapshot((snapshot) => {
    const rootId = resolveBundleRootForSession(snapshot, input.sessionID, input.parentSessionId);
    const bundle = ensureBundle(snapshot, rootId);
    const existing = sessionTreeStore[input.sessionID] ?? bundle.tree[input.sessionID] ?? {
      title: "",
      agent: "",
      model: "",
      childIds: [],
      status: "busy",
      createdAt: Date.now()
    };
    const node = {
      ...existing,
      title: existing.title,
      agent: input.agent || existing.agent,
      model: existing.model,
      variant: input.variant !== undefined ? input.variant : existing.variant,
      parentId: input.parentSessionId,
      mode: input.mode !== undefined ? input.mode : existing.mode,
      status: existing.status,
      createdAt: existing.createdAt
    };
    bundle.tree[input.sessionID] = node;
    sessionTreeStore[input.sessionID] = node;
    touchBundle(bundle);
    for (const b of Object.values(snapshot.sessions)) {
      const parent = b.tree[input.parentSessionId];
      if (!parent)
        continue;
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
function recordChildSessionSnapshot(input) {
  updateSnapshot((snapshot) => {
    const rootId = resolveBundleRootForSession(snapshot, input.sessionID, input.parentSessionId);
    const bundle = ensureBundle(snapshot, rootId);
    const existing = sessionTreeStore[input.sessionID] ?? bundle.tree[input.sessionID] ?? {
      title: "",
      agent: "",
      model: "",
      childIds: [],
      status: "busy",
      createdAt: Date.now()
    };
    const node = {
      ...existing,
      title: input.title ?? existing.title,
      agent: existing.agent,
      model: existing.model,
      variant: existing.variant,
      parentId: input.parentSessionId !== undefined ? input.parentSessionId : existing.parentId,
      mode: existing.mode,
      status: existing.status,
      createdAt: existing.createdAt
    };
    bundle.tree[input.sessionID] = node;
    sessionTreeStore[input.sessionID] = node;
    touchBundle(bundle);
    if (input.parentSessionId) {
      for (const b of Object.values(snapshot.sessions)) {
        const parent = b.tree[input.parentSessionId];
        if (!parent)
          continue;
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
      const rootForProject = resolveBundleRootForSession(snapshot, input.sessionID);
      const projectBundle = ensureBundle(snapshot, rootForProject);
      projectBundle.projectPath = normalized;
      touchBundle(projectBundle);
    }
  });
}
function patchSessionTreeStatusFromOpenCode(sessionID, rawType) {
  updateSnapshot((snapshot) => {
    applyOpenCodeSessionStatus(snapshot, sessionID, rawType);
  });
}
function recordSessionEnd(sessionID) {
  updateSnapshot((snapshot) => {
    const located = locateBundleForSession(snapshot, sessionID);
    const node = located?.bundle.tree[sessionID] ?? sessionTreeStore[sessionID];
    if (node)
      delete node.usage;
    if (located)
      touchBundle(located.bundle);
  });
}
function recordSessionModel(input) {
  updateSnapshot((snapshot) => {
    const rootId = resolveBundleRootForSession(snapshot, input.sessionID);
    const bundle = ensureBundle(snapshot, rootId);
    const node = getOrCreateTreeNode(bundle, input.sessionID);
    node.model = input.model;
    touchBundle(bundle);
  });
}
function recordSessionVariant(input) {
  updateSnapshot((snapshot) => {
    const rootId = resolveBundleRootForSession(snapshot, input.sessionID);
    const bundle = ensureBundle(snapshot, rootId);
    const node = getOrCreateTreeNode(bundle, input.sessionID);
    node.variant = input.variant;
    touchBundle(bundle);
  });
}
function recordSessionNode(input) {
  updateSnapshot((snapshot) => {
    const rootId = resolveBundleRootForSession(snapshot, input.sessionID, input.parentId);
    const bundle = ensureBundle(snapshot, rootId);
    const existing = sessionTreeStore[input.sessionID] ?? bundle.tree[input.sessionID] ?? {
      title: "",
      agent: "",
      model: "",
      childIds: [],
      status: "busy",
      createdAt: Date.now()
    };
    const node = {
      ...existing,
      title: input.title !== undefined ? input.title : existing.title,
      agent: input.agent || existing.agent,
      model: input.model ?? existing.model,
      variant: input.variant !== undefined ? input.variant : existing.variant,
      parentId: input.parentId !== undefined ? input.parentId : existing.parentId,
      mode: input.mode !== undefined ? input.mode : existing.mode,
      status: input.status ?? existing.status,
      createdAt: existing.createdAt
    };
    bundle.tree[input.sessionID] = node;
    sessionTreeStore[input.sessionID] = node;
    touchBundle(bundle);
  });
}
function recordSessionTitle(input) {
  const trimmed = input.title.trim();
  if (!trimmed)
    return;
  updateSnapshot((snapshot) => {
    const hit = locateBundleForSession(snapshot, input.sessionID);
    if (hit) {
      const node2 = hit.bundle.tree[input.sessionID];
      if (node2) {
        node2.title = trimmed;
        sessionTreeStore[input.sessionID] = node2;
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
function recordSessionDone(sessionID) {
  updateSnapshot((snapshot) => {
    const hit = locateBundleForSession(snapshot, sessionID);
    if (hit) {
      const node = hit.bundle.tree[sessionID];
      if (node) {
        node.status = "idle";
        node.finishedAt = Date.now();
      }
      touchBundle(hit.bundle);
    }
    const storeNode = sessionTreeStore[sessionID];
    if (storeNode) {
      storeNode.status = "idle";
      storeNode.finishedAt = Date.now();
    }
  });
}
function resolveOrchestrationRootSessionID(snapshot, sessionID) {
  const merged = mergedSessionTree(snapshot);
  let currentID = sessionID;
  const visited = new Set;
  while (currentID && !visited.has(currentID)) {
    visited.add(currentID);
    const treeNode = merged[currentID];
    if (!treeNode)
      return null;
    if (treeNode.agent === "orchestrator")
      return currentID;
    currentID = treeNode.parentId;
  }
  return null;
}
function recordSessionUsage(input) {
  updateSnapshot((snapshot) => {
    applyRecordSessionUsageToSnapshot(snapshot, input);
  });
}
function subscriptionUsageKey(provider, accountName) {
  return `${provider}\x00${accountName}`;
}
function recordSubscriptionUsage(usage) {
  updateSnapshot((snapshot) => {
    snapshot.subscriptionUsage = {};
    for (const entry of usage) {
      if (entry.accountName) {
        snapshot.subscriptionUsage[subscriptionUsageKey(entry.provider, entry.accountName)] = entry;
      }
    }
  });
}
function removeSubscriptionUsageEntry(provider, name) {
  updateSnapshot((snapshot) => {
    delete snapshot.subscriptionUsage[subscriptionUsageKey(provider, name)];
  });
}
function recordSessionProject(input) {
  const normalized = normalizeProjectDirectory(input.projectPath);
  updateSnapshot((snapshot) => {
    const rootId = resolveBundleRootForSession(snapshot, input.sessionID);
    const bundle = ensureBundle(snapshot, rootId);
    bundle.projectPath = normalized;
    touchBundle(bundle);
  });
}
function deleteSessionEntries(sessionID) {
  updateSnapshot((snapshot) => {
    const located = locateBundleForSession(snapshot, sessionID);
    if (!located)
      return;
    const { bundle, rootId } = located;
    delete bundle.orchestrationUsageLastSeen[sessionID];
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
        storeParent.childIds = storeParent.childIds.filter((c) => c !== sessionID);
      }
    }
    if (Object.keys(bundle.tree).length === 0) {
      delete snapshot.sessions[rootId];
      return;
    }
    touchBundle(bundle);
  });
}
function recordActiveSubscriptionForProvider(provider, name) {
  updateSnapshot((snapshot) => {
    if (name) {
      snapshot.activeSubscriptionByProvider[provider] = name;
    } else {
      delete snapshot.activeSubscriptionByProvider[provider];
    }
  });
}

// src/tui.ts
var PLUGIN_NAME = "opencode-dux";
var BORDER = { type: "single" };
var SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
var AGENT_SORT_PRIORITY = {
  orchestrator: 0,
  explorer: 1,
  librarian: 2,
  steward: 3,
  fixer: 4,
  oracle: 5,
  designer: 6,
  interpreter: 7
};
var SIDEBAR_MODEL_DISPLAY_MAX = 20;
var ORCH_ROOT_TITLE_DISPLAY_MAX = 22;
var ORCH_ROOT_SESSION_ID_DISPLAY_MAX = 27;
var ORCH_ROOT_MODEL_DISPLAY_MAX = 28;
var ORCH_CHILD_MODEL_DISPLAY_MAX = 22;
var ORCH_DEFAULT_TITLE_LABEL = "New session";
function element(tag, props, children = []) {
  const node = createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value !== undefined)
      setProp(node, key, value);
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false)
      continue;
    insert(node, child);
  }
  return node;
}
function text(props, children) {
  return element("text", props, children);
}
function box(props, children = []) {
  return element("box", props, children);
}
function truncate(value, max = 24) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
function formatTokenAbbrev(value) {
  if (!Number.isFinite(value) || value <= 0)
    return "0";
  if (value < 1000)
    return Math.round(value).toString();
  if (value < 1e6) {
    const k = Math.round(value / 1000);
    if (k >= 1000)
      return `${Math.round(value / 1e6)}M`;
    return `${k}K`;
  }
  return `${Math.round(value / 1e6)}M`;
}
function formatTokenAbbrevDecimal(value) {
  if (!Number.isFinite(value) || value <= 0)
    return "0";
  if (value < 1000)
    return Math.round(value).toString();
  if (value < 1e6) {
    return `${(value / 1000).toFixed(1)}K`;
  }
  return `${(value / 1e6).toFixed(1)}M`;
}
function formatTokenExact(value) {
  if (!Number.isFinite(value) || value <= 0)
    return "0";
  return new Intl.NumberFormat("en-US").format(Math.round(value));
}
function formatSidebarModelName(model) {
  const lastSlash = model.lastIndexOf("/");
  return lastSlash === -1 ? model : model.slice(lastSlash + 1);
}
var ELLIPSIS_CHAR = "…";
function truncateModelBasenameByHyphenSegments(name, maxTotalLen) {
  if (name.length <= maxTotalLen)
    return name;
  const budget = maxTotalLen - ELLIPSIS_CHAR.length;
  if (budget <= 0)
    return truncate(name, maxTotalLen);
  const parts = name.split("-").filter((p) => p.length > 0);
  if (parts.length === 0)
    return truncate(name, maxTotalLen);
  const head = parts[0];
  if (parts.length === 1) {
    return head ? truncate(head, maxTotalLen) : truncate(name, maxTotalLen);
  }
  if (!head)
    return truncate(name, maxTotalLen);
  if (head.length > budget)
    return truncate(head, maxTotalLen);
  let acc = head;
  for (let i = 1;i < parts.length; i++) {
    const piece = parts[i];
    if (!piece)
      continue;
    const next = `${acc}-${piece}`;
    if (next.length > budget)
      break;
    acc = next;
  }
  if (acc.length >= name.length)
    return name;
  return `${acc}${ELLIPSIS_CHAR}`;
}
function formatSidebarModelAndVariant(rawModel, variant, maxModelDisplayLen = SIDEBAR_MODEL_DISPLAY_MAX) {
  const name = rawModel ? formatSidebarModelName(rawModel) : "";
  const extraVariant = variant?.trim() ?? "";
  if (!name)
    return extraVariant;
  const modelShown = truncateModelBasenameByHyphenSegments(name, maxModelDisplayLen);
  if (!extraVariant)
    return modelShown;
  return `${modelShown} - ${extraVariant}`;
}
function formatAgentName(name) {
  if (name.length <= 16)
    return name;
  return `${name.slice(0, 13)}...`;
}
function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0)
    return "0:00";
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor(totalSeconds % 3600 / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
function formatSessionUsageRows(snapshot, sessionID, options) {
  const abbreviateLeft = options?.abbreviateLeft ?? false;
  const usage = mergedSessionUsage(snapshot)[sessionID];
  const contextUsed = usage?.contextUsed ?? 0;
  const contextLimit = usage?.contextLimit ?? 0;
  const contextPct = Math.round(deriveSessionContextPct(contextUsed, contextLimit));
  const inputTotal = usage?.input ?? 0;
  const outputTotal = usage?.output ?? 0;
  const cacheRead = usage?.cacheRead ?? 0;
  const cacheWrite = usage?.cacheWrite ?? 0;
  const cacheTotal = cacheRead + cacheWrite;
  return {
    contextPct,
    ctxLabel: "CTX",
    ctxValue: `${abbreviateLeft ? formatTokenAbbrevDecimal(contextUsed) : formatTokenExact(contextUsed)}/${abbreviateLeft ? formatTokenAbbrev(contextLimit) : formatTokenExact(contextLimit)} (${contextPct}%)`,
    ioInputAbbrev: formatTokenAbbrev(inputTotal),
    ioOutputAbbrev: formatTokenAbbrev(outputTotal),
    cacheLabel: "CACHE",
    cacheValue: formatTokenExact(cacheTotal),
    cacheReadAbbrev: formatTokenExact(cacheRead),
    cacheWriteAbbrev: formatTokenExact(cacheWrite)
  };
}
function aggregateOrchestrationUsage(snapshot, rootSessionID) {
  const accum = mergedOrchestrationSigmaAccum(snapshot)[rootSessionID];
  if (!accum) {
    return {
      inputTotal: 0,
      outputTotal: 0,
      cacheRead: 0,
      cacheWrite: 0,
      contextUsed: 0
    };
  }
  return {
    inputTotal: accum.input,
    outputTotal: accum.output,
    cacheRead: accum.cacheRead,
    cacheWrite: accum.cacheWrite,
    contextUsed: accum.contextUsed
  };
}
function getSidebarAgentNames(snapshot) {
  const names = Object.keys(AGENT_SIDEBAR_DESCRIPTIONS);
  return names.sort((a, b) => {
    const pa = AGENT_SORT_PRIORITY[a] ?? 99;
    const pb = AGENT_SORT_PRIORITY[b] ?? 99;
    if (pa !== pb)
      return pa - pb;
    return a.localeCompare(b);
  });
}
function formatUsageTime(iso) {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0)
    return "now";
  const totalMin = Math.ceil(diff / 60000);
  const hours = Math.floor(totalMin / 60);
  const minutes = totalMin % 60;
  if (hours > 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }
  if (hours > 0)
    return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
function neuralwattTokensFormatted(tokens) {
  if (!Number.isFinite(tokens))
    return "0";
  return Math.trunc(tokens).toLocaleString("en-US");
}
function pushNeuralwattMonthlyTokensRow(rows, theme, u) {
  rows.push(box({ width: "100%", flexDirection: "row" }, [
    text({ fg: theme.textMuted }, [
      `   ${neuralwattTokensFormatted(u.current_month.tokens)} Tokens this month`
    ])
  ]));
}
var BAR_WIDTH = 18;
var SIGMA_TOTAL_COLOR = "#F5B041";
var METRIC_PAIR_GAP = " ";
function renderMetricPairRight(leftIcon, leftValue, rightIcon, rightValue, colors) {
  return box({ flexDirection: "row", flexShrink: 0 }, [
    text({ fg: colors.leftFg }, [`${leftIcon} ${leftValue}`]),
    text({ fg: colors.gapFg }, [METRIC_PAIR_GAP]),
    text({ fg: colors.rightFg }, [`${rightIcon} ${rightValue}`])
  ]);
}
function renderUsageBar(percent) {
  const filled = Math.round(percent / 100 * BAR_WIDTH);
  const empty = BAR_WIDTH - filled;
  return "█".repeat(filled) + "░".repeat(empty);
}
function getUsageColor(percentRemaining) {
  if (percentRemaining < 25)
    return "#E74C3C";
  if (percentRemaining < 50)
    return "#F39C12";
  return "";
}
function renderOpenCodeGoBars(entry, rows, theme) {
  const windows = [];
  if (entry.rolling)
    windows.push({ label: "R", w: entry.rolling });
  if (entry.weekly)
    windows.push({ label: "W", w: entry.weekly });
  if (entry.monthly)
    windows.push({ label: "M", w: entry.monthly });
  for (let i = 0;i < windows.length; i++) {
    const { label, w } = windows[i];
    if (!w)
      continue;
    const usageColor = getUsageColor(w.percentRemaining);
    const bar = renderUsageBar(w.percentRemaining);
    const pct = w.percentRemaining.toFixed(0).padStart(3);
    const timeLeft = formatUsageTime(w.resetTimeIso);
    rows.push(box({
      width: "100%",
      flexDirection: "row",
      justifyContent: "space-between"
    }, [
      box({ flexDirection: "row" }, [
        text({ fg: theme.accent }, [`${label} `]),
        text({ fg: usageColor || theme.text }, [bar]),
        text({ fg: usageColor || theme.textMuted }, [` ${pct}%`])
      ]),
      text({ fg: theme.textMuted }, [timeLeft])
    ]));
  }
}
function renderNeuralwattUsage(entry, rows, theme) {
  const { subscription, balance, usage: u } = entry;
  if (subscription && subscription.status === "active") {
    const kwhIncluded = subscription.kwh_included ?? 0;
    const kwhUsed = subscription.kwh_used ?? 0;
    const kwhRemaining = subscription.kwh_remaining ?? 0;
    if (kwhIncluded > 0) {
      const kwhPct = Math.min(kwhUsed / kwhIncluded * 100, 100);
      const bar = renderUsageBar(100 - kwhPct);
      const remaining = kwhRemaining.toFixed(1);
      const resetTime = subscription.current_period_end ? formatUsageTime(subscription.current_period_end) : "";
      const color = kwhPct > 90 ? "#E74C3C" : kwhPct > 75 ? "#F39C12" : "";
      rows.push(box({
        width: "100%",
        flexDirection: "row",
        justifyContent: "space-between"
      }, [
        box({ flexDirection: "row" }, [
          text({ fg: theme.accent }, ["⚡ "]),
          text({ fg: color || theme.text }, [bar]),
          text({ fg: color || theme.textMuted }, [` ${remaining}kWh`])
        ]),
        text({ fg: theme.textMuted }, [resetTime])
      ]));
    }
    rows.push(box({
      width: "100%",
      flexDirection: "row",
      justifyContent: "space-between"
    }, [
      text({ fg: theme.textMuted }, [
        `   $${u.current_month.cost_usd.toFixed(2)} this month`
      ]),
      text({ fg: theme.textMuted }, [
        `⚡ ${u.current_month.energy_kwh.toFixed(1)} kWh`
      ])
    ]));
    pushNeuralwattMonthlyTokensRow(rows, theme, u);
  } else if (subscription && subscription.status !== "active") {
    const statusColor = subscription.status === "past_due" || subscription.status === "canceling" ? "#E74C3C" : "#F39C12";
    rows.push(box({
      width: "100%",
      flexDirection: "row",
      justifyContent: "space-between"
    }, [
      text({ fg: statusColor }, [`  Status: ${subscription.status}`]),
      text({ fg: theme.textMuted }, [
        `⚡ ${u.current_month.energy_kwh.toFixed(1)} kWh`
      ])
    ]));
    const kwhIncluded = subscription.kwh_included ?? 0;
    const kwhUsed = subscription.kwh_used ?? 0;
    const kwhRemaining = subscription.kwh_remaining ?? 0;
    if (kwhIncluded > 0) {
      const kwhPct = Math.min(kwhUsed / kwhIncluded * 100, 100);
      const bar = renderUsageBar(100 - kwhPct);
      const remaining = kwhRemaining.toFixed(1);
      const resetTime = subscription.current_period_end ? formatUsageTime(subscription.current_period_end) : "";
      const color = kwhPct > 90 ? "#E74C3C" : kwhPct > 75 ? "#F39C12" : "";
      rows.push(box({
        width: "100%",
        flexDirection: "row",
        justifyContent: "space-between"
      }, [
        box({ flexDirection: "row" }, [
          text({ fg: theme.accent }, ["⚡ "]),
          text({ fg: color || theme.text }, [bar]),
          text({ fg: color || theme.textMuted }, [` ${remaining}kWh`])
        ]),
        text({ fg: theme.textMuted }, [resetTime])
      ]));
    }
    if (balance.credits_remaining_usd > 0) {
      rows.push(box({
        width: "100%",
        flexDirection: "row",
        justifyContent: "space-between"
      }, [
        text({ fg: theme.textMuted }, [
          `  \uD83D\uDCB0 $${balance.credits_remaining_usd.toFixed(2)} remaining`
        ]),
        text({ fg: theme.textMuted }, [
          `$${u.current_month.cost_usd.toFixed(2)}/mo`
        ])
      ]));
    }
    pushNeuralwattMonthlyTokensRow(rows, theme, u);
  } else {
    rows.push(box({
      width: "100%",
      flexDirection: "row",
      justifyContent: "space-between"
    }, [
      text({ fg: theme.text }, [
        `\uD83D\uDCB0 $${balance.credits_remaining_usd.toFixed(2)} remaining`
      ]),
      text({ fg: theme.textMuted }, [
        `⚡ ${u.current_month.energy_kwh.toFixed(3)} kWh/mo`
      ])
    ]));
    rows.push(box({
      width: "100%",
      flexDirection: "row",
      justifyContent: "space-between"
    }, [
      text({ fg: theme.textMuted }, [
        `   $${u.current_month.cost_usd.toFixed(2)} this month`
      ])
    ]));
    pushNeuralwattMonthlyTokensRow(rows, theme, u);
  }
}
function renderSubscriptionPanel(snapshot, theme) {
  const usage = snapshot.subscriptionUsage ?? {};
  const usageEntries = Object.entries(usage).sort(([, a], [, b]) => {
    if (a.provider !== b.provider)
      return a.provider.localeCompare(b.provider);
    return a.accountName.localeCompare(b.accountName);
  });
  if (usageEntries.length === 0)
    return [];
  const rows = [];
  let isFirstAccount = true;
  for (const [, entry] of usageEntries) {
    const name = entry.accountName;
    const activeName = snapshot.activeSubscriptionByProvider?.[entry.provider];
    const isActive = activeName === name;
    const providerLabel = entry.provider === "neuralwatt" ? " [nw]" : " [go]";
    if (!isFirstAccount) {
      rows.push(box({ width: "100%", height: 1 }));
    }
    isFirstAccount = false;
    if (entry.error) {
      rows.push(box({ width: "100%", flexDirection: "row" }, [
        text(isActive ? { fg: theme.accent } : { fg: theme.text }, [
          isActive ? `★ ${truncate(name, 18)}${providerLabel}` : `${truncate(name, 16)}${providerLabel}`
        ]),
        text({ fg: theme.textMuted }, [" ⚠️"])
      ]));
      rows.push(text({ fg: theme.textMuted }, [`  ${truncate(entry.error, 56)}`]));
      continue;
    }
    const displayName = isActive ? `★ ${truncate(name, 18)}${providerLabel}` : `${truncate(name, 16)}${providerLabel}`;
    rows.push(box({ width: "100%", flexDirection: "row" }, [
      text(isActive ? { fg: theme.accent } : { fg: theme.text }, [
        displayName
      ])
    ]));
    if (entry.provider === "opencode-go") {
      renderOpenCodeGoBars(entry, rows, theme);
    } else if (entry.provider === "neuralwatt") {
      renderNeuralwattUsage(entry, rows, theme);
    } else {
      rows.push(text({ fg: "#F39C12" }, [
        "  ⚠️ Provider field missing - re-add account with /subscriptions"
      ]));
    }
  }
  return rows;
}
var FLASH_DURATION_MS = 2000;
function getStatusText(snapshot, sessionID) {
  return mergedSessionTree(snapshot)[sessionID]?.status ?? "-";
}
function getStatusWithDuration(snapshot, sessionID, node, now) {
  const status = getStatusText(snapshot, sessionID);
  if (node.status === "busy" || node.status === "retry") {
    const elapsed = now - node.createdAt;
    return `${status} (${formatDuration(elapsed)})`;
  }
  return status;
}
function getSpinnerChar(now) {
  return SPINNER_FRAMES[Math.floor(now / 80) % SPINNER_FRAMES.length];
}
function getStatusColor(status, theme) {
  const normalized = status.trim();
  if (normalized === "busy" || normalized.startsWith("busy "))
    return theme.accent;
  if (normalized === "retry" || normalized.startsWith("retry "))
    return theme.error ?? "#EF4444";
  if (status === "idle")
    return theme.textMuted;
  return theme.text;
}
function splitStatusAndTimer(full) {
  const m = full.match(/^(\S+)\s+(\([^)]+\))$/);
  if (!m)
    return null;
  return { status: m[1], timer: full.slice(m[1].length) };
}
function renderStatusLineWithOptionalTimer(full, theme) {
  const split = splitStatusAndTimer(full);
  if (!split) {
    return text({ fg: getStatusColor(full, theme) }, [full]);
  }
  return box({ flexDirection: "row", flexShrink: 0 }, [
    text({ fg: getStatusColor(split.status, theme) }, [split.status]),
    text({ fg: theme.text }, [split.timer])
  ]);
}
function buildOrchestratingRows(snapshot, now, theme) {
  const tree = mergedSessionTree(snapshot);
  const usageBySession = mergedSessionUsage(snapshot);
  const spinner = getSpinnerChar(now);
  const isVisibleSession = (node) => {
    if (node.status === "busy" || node.status === "retry")
      return true;
    if (node.status !== "idle" || !node.finishedAt)
      return false;
    return now - node.finishedAt < FLASH_DURATION_MS + 1000;
  };
  const getVisibleChildren = (parentID) => Object.entries(tree).filter(([, child]) => child.parentId === parentID && isVisibleSession(child));
  const pushUsageRows = (rows2, sessionID, prefix, abbreviateLeft) => {
    const metrics = formatSessionUsageRows(snapshot, sessionID, {
      abbreviateLeft
    });
    const isChild = !!tree[sessionID]?.parentId;
    if (isChild) {
      rows2.push(box({ width: "100%", flexDirection: "row" }, [
        text({ fg: theme.textMuted }, [prefix]),
        text({ fg: theme.accent }, [`${metrics.ctxLabel} `]),
        text({ fg: theme.text }, [metrics.ctxValue])
      ]));
      const cacheTotalForRow = (usageBySession[sessionID]?.cacheRead ?? 0) + (usageBySession[sessionID]?.cacheWrite ?? 0);
      rows2.push(box({ width: "100%", flexDirection: "row" }, [
        text({ fg: theme.textMuted }, [prefix]),
        text({ fg: theme.accent }, [`${metrics.cacheLabel} `]),
        text({ fg: theme.text }, [formatTokenExact(cacheTotalForRow)])
      ]));
      rows2.push(box({ width: "100%", flexDirection: "row" }, [
        text({ fg: theme.textMuted }, [prefix]),
        renderMetricPairRight("↓", `Input ${metrics.ioInputAbbrev}`, "↑", `Output ${metrics.ioOutputAbbrev}`, {
          leftFg: "#5DADE2",
          rightFg: "#58D68D",
          gapFg: theme.textMuted
        })
      ]));
      rows2.push(box({ width: "100%", flexDirection: "row" }, [
        text({ fg: theme.textMuted }, [prefix]),
        renderMetricPairRight("\uD83D\uDCD6", `Read ${metrics.cacheReadAbbrev}`, "\uD83D\uDCDD", `Write ${metrics.cacheWriteAbbrev}`, {
          leftFg: "#5DADE2",
          rightFg: "#AF7AC5",
          gapFg: theme.textMuted
        })
      ]));
    } else {
      rows2.push(box({
        width: "100%",
        flexDirection: "row",
        justifyContent: "space-between"
      }, [
        box({ flexDirection: "row" }, [
          text({ fg: theme.textMuted }, [prefix]),
          text({ fg: theme.accent }, [`${metrics.ctxLabel} `]),
          text({ fg: theme.text }, [metrics.ctxValue])
        ]),
        renderMetricPairRight("↓", metrics.ioInputAbbrev, "↑", metrics.ioOutputAbbrev, {
          leftFg: "#5DADE2",
          rightFg: "#58D68D",
          gapFg: theme.textMuted
        })
      ]));
      rows2.push(box({
        width: "100%",
        flexDirection: "row",
        justifyContent: "space-between"
      }, [
        box({ flexDirection: "row" }, [
          text({ fg: theme.textMuted }, [prefix]),
          text({ fg: theme.accent }, [`${metrics.cacheLabel} `]),
          text({ fg: theme.text }, [metrics.cacheValue])
        ]),
        renderMetricPairRight("\uD83D\uDCD6", metrics.cacheReadAbbrev, "\uD83D\uDCDD", metrics.cacheWriteAbbrev, {
          leftFg: "#5DADE2",
          rightFg: "#AF7AC5",
          gapFg: theme.textMuted
        })
      ]));
    }
  };
  const pushAggregateRows = (rows2, sessionID, prefix) => {
    const totals = aggregateOrchestrationUsage(snapshot, sessionID);
    const totalIo = totals.contextUsed;
    const totalCache = totals.cacheRead + totals.cacheWrite;
    const isChild = !!tree[sessionID]?.parentId;
    if (isChild) {
      rows2.push(box({ width: "100%", flexDirection: "row" }, [
        text({ fg: theme.textMuted }, [prefix]),
        text({ fg: SIGMA_TOTAL_COLOR }, ["Σ TOTAL "]),
        text({ fg: theme.text }, [formatTokenExact(totalIo)])
      ]));
      rows2.push(box({ width: "100%", flexDirection: "row" }, [
        text({ fg: theme.textMuted }, [prefix]),
        text({ fg: SIGMA_TOTAL_COLOR }, ["Σ CACHE "]),
        text({ fg: theme.text }, [formatTokenAbbrev(totalCache)])
      ]));
      rows2.push(box({ width: "100%", flexDirection: "row" }, [
        text({ fg: theme.textMuted }, [prefix]),
        renderMetricPairRight("↓", `Input ${formatTokenAbbrev(totals.inputTotal)}`, "↑", `Output ${formatTokenAbbrev(totals.outputTotal)}`, {
          leftFg: "#5DADE2",
          rightFg: "#58D68D",
          gapFg: theme.textMuted
        })
      ]));
      rows2.push(box({ width: "100%", flexDirection: "row" }, [
        text({ fg: theme.textMuted }, [prefix]),
        renderMetricPairRight("\uD83D\uDCD6", `Read ${formatTokenAbbrev(totals.cacheRead)}`, "\uD83D\uDCDD", `Write ${formatTokenAbbrev(totals.cacheWrite)}`, {
          leftFg: "#5DADE2",
          rightFg: "#AF7AC5",
          gapFg: theme.textMuted
        })
      ]));
    } else {
      rows2.push(box({
        width: "100%",
        flexDirection: "row",
        justifyContent: "space-between"
      }, [
        box({ flexDirection: "row" }, [
          text({ fg: theme.textMuted }, [prefix]),
          text({ fg: SIGMA_TOTAL_COLOR }, ["Σ TOTAL "]),
          text({ fg: theme.text }, [formatTokenExact(totalIo)])
        ]),
        renderMetricPairRight("↓", formatTokenAbbrev(totals.inputTotal), "↑", formatTokenAbbrev(totals.outputTotal), {
          leftFg: "#5DADE2",
          rightFg: "#58D68D",
          gapFg: theme.textMuted
        })
      ]));
      rows2.push(box({
        width: "100%",
        flexDirection: "row",
        justifyContent: "space-between"
      }, [
        box({ flexDirection: "row" }, [
          text({ fg: theme.textMuted }, [prefix]),
          text({ fg: SIGMA_TOTAL_COLOR }, ["Σ CACHE "]),
          text({ fg: theme.text }, [formatTokenExact(totalCache)])
        ]),
        renderMetricPairRight("\uD83D\uDCD6", formatTokenAbbrev(totals.cacheRead), "\uD83D\uDCDD", formatTokenAbbrev(totals.cacheWrite), {
          leftFg: "#5DADE2",
          rightFg: "#AF7AC5",
          gapFg: theme.textMuted
        })
      ]));
    }
  };
  const visibleOrchSessions = [];
  for (const [id, node] of Object.entries(tree)) {
    if (node.agent !== "orchestrator")
      continue;
    if (node.status === "busy" || node.status === "retry") {
      visibleOrchSessions.push([id, node]);
    } else if (node.status === "idle") {
      const hasVisibleChildren = getVisibleChildren(id).length > 0;
      if (hasVisibleChildren) {
        visibleOrchSessions.push([id, node]);
      } else if (node.finishedAt) {
        const elapsed = now - node.finishedAt;
        if (elapsed < FLASH_DURATION_MS + 1000) {
          visibleOrchSessions.push([id, node]);
        }
      } else {
        visibleOrchSessions.push([id, node]);
      }
    }
  }
  const countLabel = `${visibleOrchSessions.length} active`;
  if (visibleOrchSessions.length === 0) {
    return [
      countLabel,
      text({ fg: theme.textMuted }, ["No active orchestrations"])
    ];
  }
  const rows = [];
  const renderChildren = (parentID, indentPrefix) => {
    const visibleChildren = getVisibleChildren(parentID);
    for (let i = 0;i < visibleChildren.length; i++) {
      const [childId, child] = visibleChildren[i];
      const isLast = i === visibleChildren.length - 1;
      const branchChar = isLast ? "└" : "├";
      const pipeChar = isLast ? " " : "│";
      const childFlash = child.status === "idle" && child.finishedAt && Math.floor((now - child.finishedAt) / 200) % 2 === 0;
      const indicator = child.status === "busy" || child.status === "retry" ? spinner : childFlash ? "·" : " ";
      const childStatusText = getStatusWithDuration(snapshot, childId, child, now);
      const childVariant = child.variant;
      const detailPrefix = `${indentPrefix}${pipeChar}    `;
      rows.push(box({
        width: "100%",
        flexDirection: "row",
        justifyContent: "space-between"
      }, [
        box({ flexDirection: "row", flexShrink: 0 }, [
          text({ fg: theme.textMuted }, [`${indentPrefix}${branchChar}─ `]),
          text({ fg: theme.text }, [`${indicator} ${child.agent}`])
        ]),
        renderStatusLineWithOptionalTimer(childStatusText, theme)
      ]));
      rows.push(box({ width: "100%", flexDirection: "row" }, [
        text({ fg: theme.textMuted }, [detailPrefix]),
        text({ fg: theme.textMuted }, [
          formatSidebarModelAndVariant(child.model, childVariant, ORCH_CHILD_MODEL_DISPLAY_MAX)
        ])
      ]));
      pushUsageRows(rows, childId, detailPrefix, false);
      renderChildren(childId, `${indentPrefix}${pipeChar}  `);
    }
  };
  for (const [orchId, orchNode] of visibleOrchSessions) {
    const visibleChildren = getVisibleChildren(orchId);
    const orchShowSpinner = orchNode.status === "busy" || orchNode.status === "retry" || orchNode.status === "idle" && visibleChildren.length > 0;
    const orchFlash = orchNode.status === "idle" && !orchShowSpinner && orchNode.finishedAt && now >= orchNode.finishedAt && Math.floor((now - orchNode.finishedAt) / 200) % 2 === 0;
    const orchDot = orchShowSpinner ? spinner : orchFlash ? "·" : " ";
    const row1Title = orchNode.title?.trim() ? truncate(orchNode.title, ORCH_ROOT_TITLE_DISPLAY_MAX) : ORCH_DEFAULT_TITLE_LABEL;
    rows.push(box({
      flexDirection: "row",
      justifyContent: "space-between"
    }, [
      box({ flexDirection: "row" }, [
        text({ fg: theme.accent }, [`${orchDot} `]),
        text({ fg: theme.text }, [row1Title])
      ]),
      text({ fg: theme.text }, [
        orchNode.status === "busy" || orchNode.status === "retry" ? `(${formatDuration(now - orchNode.createdAt)})` : ""
      ])
    ]));
    const orchStatusText = getStatusText(snapshot, orchId);
    rows.push(box({
      width: "100%",
      flexDirection: "row",
      justifyContent: "space-between"
    }, [
      box({ flexDirection: "row", flexShrink: 0 }, [
        text({ fg: theme.textMuted }, ["  "]),
        text({ fg: theme.text }, [
          truncate(orchId, ORCH_ROOT_SESSION_ID_DISPLAY_MAX)
        ])
      ]),
      renderStatusLineWithOptionalTimer(orchStatusText, theme)
    ]));
    const modelLine = formatSidebarModelAndVariant(orchNode.model, orchNode.variant, ORCH_ROOT_MODEL_DISPLAY_MAX);
    rows.push(box({ width: "100%", flexDirection: "row" }, [
      text({ fg: theme.textMuted }, ["  "]),
      text({ fg: theme.textMuted }, [
        modelLine.length > 0 ? modelLine : "pending"
      ])
    ]));
    pushUsageRows(rows, orchId, "  ", true);
    pushAggregateRows(rows, orchId, "  ");
    renderChildren(orchId, "  ");
    rows.push(box({ width: "100%", height: 1 }));
  }
  return [countLabel, ...rows];
}
function getActiveSessions(snapshot, now) {
  const entries = [];
  const tree = mergedSessionTree(snapshot);
  for (const [sessionID, node] of Object.entries(tree)) {
    const agentName = node.agent;
    if (!agentName)
      continue;
    if (node.status === "busy" || node.status === "retry") {
      entries.push({ sessionID, agentName, running: true, finished: false });
    } else if (node.status === "idle" && node.finishedAt) {
      let running = false;
      if (agentName === "orchestrator") {
        const hasVisibleChildren = Object.entries(tree).some(([_cid, cnode]) => cnode.parentId === sessionID && (cnode.status === "busy" || cnode.status === "retry" || cnode.status === "idle" && cnode.finishedAt && now - cnode.finishedAt < FLASH_DURATION_MS + 1000));
        if (hasVisibleChildren)
          running = true;
      }
      if (now - node.finishedAt < FLASH_DURATION_MS + 1000) {
        entries.push({
          sessionID,
          agentName,
          running,
          finished: !running
        });
      }
    }
  }
  return entries;
}
function renderSidebar(snapshot, theme) {
  const now = Date.now();
  const mergedTreeSidebar = mergedSessionTree(snapshot);
  const sessions = getActiveSessions(snapshot, now);
  const totalActive = sessions.filter((s) => s.running).length;
  const spinner = getSpinnerChar(now);
  const ourSessions = sessions.filter((s) => (s.agentName in AGENT_SORT_PRIORITY)).sort((a, b) => {
    const pa = AGENT_SORT_PRIORITY[a.agentName] ?? 99;
    const pb = AGENT_SORT_PRIORITY[b.agentName] ?? 99;
    if (pa !== pb)
      return pa - pb;
    return a.agentName.localeCompare(b.agentName);
  });
  const customSessions = sessions.filter((s) => !(s.agentName in AGENT_SORT_PRIORITY)).sort((a, b) => a.agentName.localeCompare(b.agentName));
  const agentRows = [];
  const ourGroups = new Map;
  for (const entry of ourSessions) {
    const { sessionID, agentName, running, finished } = entry;
    const rawModel = mergedTreeSidebar[sessionID]?.model;
    const model = rawModel ? formatSidebarModelName(rawModel) : "pending";
    const variant = mergedTreeSidebar[sessionID]?.variant;
    const key = `${agentName}\x00${model}\x00${variant ?? ""}`;
    const group = ourGroups.get(key);
    if (group) {
      group.count++;
      group.running = group.running || running;
      group.finished = group.finished || finished;
    } else {
      ourGroups.set(key, {
        sessionID,
        agentName,
        running,
        finished,
        count: 1,
        model,
        variant
      });
    }
  }
  for (const entry of ourGroups.values()) {
    const { sessionID, agentName, running, finished, count, variant } = entry;
    const elapsed = finished ? now - (mergedTreeSidebar[sessionID]?.finishedAt ?? 0) : 0;
    const flashDot = finished && Math.floor(elapsed / 200) % 2 === 0;
    const indicator = running ? spinner : flashDot ? "·" : " ";
    const desc = AGENT_SIDEBAR_DESCRIPTIONS[agentName] ?? agentName;
    const indicatorColor = theme.accent;
    const nameStr = formatAgentName(agentName);
    const descStr = truncate(desc, 10);
    agentRows.push(box({
      width: "100%",
      flexDirection: "row",
      justifyContent: "space-between"
    }, [
      box({ flexDirection: "row" }, [
        text({ fg: indicatorColor }, [`${indicator} `]),
        text({ fg: theme.text }, [nameStr]),
        text({ fg: theme.accent }, [` x${count}`])
      ]),
      box({ flexDirection: "row" }, [text({ fg: theme.text }, [descStr])])
    ]));
    const rawModel = mergedTreeSidebar[sessionID]?.model;
    const modelVariantLine = formatSidebarModelAndVariant(rawModel, variant);
    const statusText = getStatusText(snapshot, sessionID);
    agentRows.push(box({
      width: "100%",
      flexDirection: "row",
      justifyContent: "space-between"
    }, [
      text({ fg: theme.textMuted }, [
        modelVariantLine.length > 0 ? `  ${modelVariantLine}` : "  pending"
      ]),
      text({
        fg: getStatusColor(statusText, theme)
      }, [statusText])
    ]));
  }
  if (customSessions.length > 0) {
    agentRows.push(box({ width: "100%" }));
    const customGroups = new Map;
    for (const entry of customSessions) {
      const { sessionID, agentName, running, finished } = entry;
      const rawModel = mergedTreeSidebar[sessionID]?.model;
      const model = rawModel ? formatSidebarModelName(rawModel) : "pending";
      const variant = mergedTreeSidebar[sessionID]?.variant;
      const key = `${agentName}\x00${model}\x00${variant ?? ""}`;
      const group = customGroups.get(key);
      if (group) {
        group.count++;
        group.running = group.running || running;
        group.finished = group.finished || finished;
      } else {
        customGroups.set(key, {
          sessionID,
          agentName,
          running,
          finished,
          count: 1,
          model,
          variant
        });
      }
    }
    for (const entry of customGroups.values()) {
      const { sessionID, agentName, running, finished, count, variant } = entry;
      const elapsed = finished ? now - (mergedTreeSidebar[sessionID]?.finishedAt ?? 0) : 0;
      const flashDot = finished && Math.floor(elapsed / 200) % 2 === 0;
      const indicator = running ? spinner : flashDot ? "·" : " ";
      const nameStr = formatAgentName(agentName);
      const rawModelChild = mergedTreeSidebar[sessionID]?.model;
      const modelVariantLineCustom = formatSidebarModelAndVariant(rawModelChild, variant);
      const customStatusText = getStatusText(snapshot, sessionID);
      agentRows.push(box({
        width: "100%",
        flexDirection: "row",
        justifyContent: "space-between"
      }, [
        box({ flexDirection: "row" }, [
          text({ fg: theme.accent }, [`${indicator} `]),
          text({ fg: theme.text }, [nameStr]),
          text({ fg: theme.accent }, [` x${count}`])
        ])
      ]));
      agentRows.push(box({
        width: "100%",
        flexDirection: "row",
        justifyContent: "space-between"
      }, [
        text({ fg: theme.textMuted }, [
          modelVariantLineCustom.length > 0 ? `  ${modelVariantLineCustom}` : "  pending"
        ]),
        text({ fg: getStatusColor(customStatusText, theme) }, [
          customStatusText
        ])
      ]));
    }
  }
  if (agentRows.length === 0) {
    agentRows.push(text({ fg: theme.textMuted }, ["No active agents"]));
  }
  const orchestratingRows = buildOrchestratingRows(snapshot, now, theme);
  const usageRows = renderSubscriptionPanel(snapshot, theme);
  return box({
    width: "100%",
    flexDirection: "column",
    border: BORDER,
    borderColor: theme.borderActive,
    paddingTop: 0,
    paddingBottom: 0,
    paddingLeft: 0,
    paddingRight: 0
  }, [
    box({
      width: "100%",
      flexDirection: "row",
      justifyContent: "space-between"
    }, [
      text({ fg: theme.text }, ["Agents"]),
      text({ fg: theme.textMuted }, [`[${totalActive} active]`])
    ]),
    ...agentRows,
    ...orchestratingRows.length > 0 ? [
      box({ width: "100%", height: 1 }),
      box({
        width: "100%",
        flexDirection: "column",
        border: BORDER,
        borderColor: theme.borderActive,
        paddingTop: 0,
        paddingBottom: 0,
        paddingLeft: 0,
        paddingRight: 0
      }, [
        box({
          width: "100%",
          flexDirection: "row",
          justifyContent: "space-between"
        }, [
          text({ fg: theme.text }, ["Orchestrating"]),
          text({ fg: theme.textMuted }, [
            `[${orchestratingRows[0]}]`
          ])
        ]),
        ...orchestratingRows.slice(1)
      ])
    ] : [],
    ...usageRows.length > 0 ? [
      box({ width: "100%", height: 1 }),
      box({
        width: "100%",
        flexDirection: "column",
        border: BORDER,
        borderColor: theme.borderActive,
        paddingTop: 0,
        paddingBottom: 0,
        paddingLeft: 0,
        paddingRight: 0
      }, [
        box({
          width: "100%",
          flexDirection: "row",
          justifyContent: "space-between"
        }, [text({ fg: theme.text }, ["API Usage"])]),
        ...usageRows
      ])
    ] : []
  ]);
}
var plugin = {
  id: `${PLUGIN_NAME}:tui`,
  tui: async (api, _options, _meta) => {
    const [snapshot, setSnapshot] = createSignal(readTuiSnapshot());
    const [tick, setTick] = createSignal(0);
    const dataTimer = setInterval(async () => {
      try {
        setSnapshot(await readTuiSnapshotAsync());
      } catch {}
    }, 1000);
    const animTimer = setInterval(() => {
      setTick(tick() + 1);
    }, 50);
    api.lifecycle.onDispose(() => {
      clearInterval(dataTimer);
      clearInterval(animTimer);
    });
    api.slots.register({
      order: 150,
      slots: {
        sidebar_content() {
          tick();
          return renderSidebar(snapshot(), api.theme.current);
        }
      }
    });
  }
};
var tui_default = plugin;
export {
  getSidebarAgentNames,
  formatTokenAbbrevDecimal,
  formatTokenAbbrev,
  formatSidebarModelName,
  formatSidebarModelAndVariant,
  formatSessionUsageRows,
  formatDuration,
  formatAgentName,
  tui_default as default,
  aggregateOrchestrationUsage
};
