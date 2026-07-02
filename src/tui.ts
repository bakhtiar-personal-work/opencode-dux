import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TuiPluginModule } from '@opencode-ai/plugin/tui';
import type { JSX } from '@opentui/solid';
import { createElement, insert, setProp } from '@opentui/solid';
import { createSignal } from 'solid-js';
import { AGENT_SIDEBAR_DESCRIPTIONS } from './agents/descriptions';
import { deriveActiveNames } from './subscriptions/active-state';
import { tuiProviderLabel } from './subscriptions/provider';
import type {
  CodexUsageEntry,
  DeepSeekUsageEntry,
  MiMoUsageEntry,
  NeuralwattUsage,
  NeuralwattUsageEntry,
} from './subscriptions/types';
import type { SubscriptionUsageEntry } from './tui-state';
import {
  deriveSessionContextPct,
  mergedOrchestrationSigmaAccum,
  mergedSessionTree,
  mergedSessionUsage,
  readTuiSnapshot,
  readTuiSnapshotAsync,
  type SessionNode,
  type TuiSnapshot,
} from './tui-state';

function getPluginVersion(): string {
  try {
    const modDir = dirname(fileURLToPath(import.meta.url));
    const rootDir = dirname(modDir);
    const pkgPath = join(rootDir, 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      return pkg.version || '0.0.0';
    }
  } catch {}
  return '0.0.0';
}

const PLUGIN_VERSION = getPluginVersion();

function getPluginVersionInfo(): {
  installed: string;
  latest?: string;
  isLatest: boolean;
} {
  const installed = PLUGIN_VERSION;
  const snapshot = readTuiSnapshot();
  const latest = snapshot.versionCheck?.latestVersion ?? undefined;
  return {
    installed,
    latest,
    isLatest: latest !== undefined && installed === latest,
  };
}

const PLUGIN_NAME = 'opencode-dux';
const BORDER = { type: 'single' };
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

const AGENT_SORT_PRIORITY: Record<string, number> = {
  orchestrator: 0,
  explorer: 1,
  librarian: 2,
  steward: 3,
  fixer: 4,
  oracle: 5,
  designer: 6,
  interpreter: 7,
};

/** Model id display cap for the Agents sidebar (active session list). */
const SIDEBAR_MODEL_DISPLAY_MAX = 20;

/**
 * Orchestrating panel - root session (orchestrator row only).
 * Tune independently from child rows and from the Agents sidebar.
 */
const ORCH_ROOT_TITLE_DISPLAY_MAX = 22;
const ORCH_ROOT_SESSION_ID_DISPLAY_MAX = 27;
/** Hyphen-segment model id cap (incl. ellipsis); OpenCode variant suffix stays full. */
const ORCH_ROOT_MODEL_DISPLAY_MAX = 28;

/**
 * Orchestrating panel - every nested subagent under the root (recursive).
 */
const ORCH_CHILD_MODEL_DISPLAY_MAX = 18;

const ORCH_DEFAULT_TITLE_LABEL = 'New session';

type Child = JSX.Element | string | number | null | undefined | false;

function element(
  tag: string,
  props: Record<string, unknown>,
  children: Child[] = [],
) {
  const node = createElement(tag);

  for (const [key, value] of Object.entries(props)) {
    if (value !== undefined) setProp(node, key, value);
  }

  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    insert(node, child);
  }

  return node as JSX.Element;
}

function text(props: Record<string, unknown>, children: Child[]) {
  return element('text', props, children);
}

function box(props: Record<string, unknown>, children: Child[] = []) {
  return element('box', props, children);
}

function truncate(value: string, max = 24): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export function formatTokenAbbrev(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0';
  if (value < 1000) return Math.round(value).toString();
  if (value < 1_000_000) {
    const k = Math.round(value / 1000);
    if (k >= 1000) return `${Math.round(value / 1_000_000)}M`;
    return `${k}K`;
  }
  return `${Math.round(value / 1_000_000)}M`;
}

export function formatTokenAbbrevDecimal(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0';
  if (value < 1000) return Math.round(value).toString();
  if (value < 1_000_000) {
    return `${(value / 1000).toFixed(1)}K`;
  }
  return `${(value / 1_000_000).toFixed(1)}M`;
}

function formatTokenExact(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0';
  return new Intl.NumberFormat('en-US').format(Math.round(value));
}

export function formatSidebarModelName(model: string): string {
  const lastSlash = model.lastIndexOf('/');
  return lastSlash === -1 ? model : model.slice(lastSlash + 1);
}

const ELLIPSIS_CHAR = '…';

/**
 * Shorten a model id (basename after `/`) to at most `maxTotalLen` characters,
 * keeping full `-` segments (e.g. `Qwen3.5-397B-A17B-FP8` → `Qwen3.5-397B…`).
 */
function truncateModelBasenameByHyphenSegments(
  name: string,
  maxTotalLen: number,
): string {
  if (name.length <= maxTotalLen) return name;
  const budget = maxTotalLen - ELLIPSIS_CHAR.length;
  if (budget <= 0) return truncate(name, maxTotalLen);

  const parts = name.split('-').filter((p) => p.length > 0);
  if (parts.length === 0) return truncate(name, maxTotalLen);
  const head = parts[0];
  if (parts.length === 1) {
    return head ? truncate(head, maxTotalLen) : truncate(name, maxTotalLen);
  }
  if (!head) return truncate(name, maxTotalLen);
  if (head.length > budget) return truncate(head, maxTotalLen);

  let acc = head;
  for (let i = 1; i < parts.length; i++) {
    const piece = parts[i];
    if (!piece) continue;
    const next = `${acc}-${piece}`;
    if (next.length > budget) break;
    acc = next;
  }
  if (acc.length >= name.length) return name;
  return `${acc}${ELLIPSIS_CHAR}`;
}

/**
 * Show `provider/model-id` compactly: shorten long basenames on hyphen
 * boundaries, then append the OpenCode `variant` in full (`model… - High`).
 */
export function formatSidebarModelAndVariant(
  rawModel: string | undefined,
  variant: string | undefined,
  maxModelDisplayLen: number = SIDEBAR_MODEL_DISPLAY_MAX,
): string {
  const name = rawModel ? formatSidebarModelName(rawModel) : '';
  const extraVariant = variant?.trim() ?? '';

  if (!name) return extraVariant;

  const modelShown = truncateModelBasenameByHyphenSegments(
    name,
    maxModelDisplayLen,
  );
  if (!extraVariant) return modelShown;
  return `${modelShown} - ${extraVariant}`;
}

export function formatAgentName(name: string): string {
  if (name.length <= 16) return name;
  return `${name.slice(0, 13)}...`;
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0:00';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function formatSessionUsageRows(
  snapshot: TuiSnapshot,
  sessionID: string,
  options?: { abbreviateLeft?: boolean },
): {
  contextPct: number;
  ctxLabel: string;
  ctxValue: string;
  ioInputAbbrev: string;
  ioOutputAbbrev: string;
  cacheLabel: string;
  cacheValue: string;
  cacheReadAbbrev: string;
  cacheWriteAbbrev: string;
} {
  const abbreviateLeft = options?.abbreviateLeft ?? false;
  const usage = mergedSessionUsage(snapshot)[sessionID];
  const contextUsed = usage?.contextUsed ?? 0;
  const contextLimit = usage?.contextLimit ?? 0;
  const contextPct = Math.round(
    deriveSessionContextPct(contextUsed, contextLimit),
  );
  const inputTotal = usage?.input ?? 0;
  const outputTotal = usage?.output ?? 0;
  const cacheRead = usage?.cacheRead ?? 0;
  const cacheWrite = usage?.cacheWrite ?? 0;
  const cacheTotal = cacheRead + cacheWrite;

  return {
    contextPct,
    ctxLabel: 'CTX',
    ctxValue: `${abbreviateLeft ? formatTokenAbbrevDecimal(contextUsed) : formatTokenExact(contextUsed)}/${abbreviateLeft ? formatTokenAbbrev(contextLimit) : formatTokenExact(contextLimit)} (${contextPct}%)`,
    ioInputAbbrev: formatTokenAbbrev(inputTotal),
    ioOutputAbbrev: formatTokenAbbrev(outputTotal),
    cacheLabel: 'CACHE',
    // User preference: don't abbreviate cache usage in the sidebar.
    cacheValue: formatTokenExact(cacheTotal),
    cacheReadAbbrev: formatTokenExact(cacheRead),
    cacheWriteAbbrev: formatTokenExact(cacheWrite),
  };
}

export function aggregateOrchestrationUsage(
  snapshot: TuiSnapshot,
  rootSessionID: string,
): {
  inputTotal: number;
  outputTotal: number;
  cacheRead: number;
  cacheWrite: number;
  contextUsed: number;
} {
  const accum = mergedOrchestrationSigmaAccum(snapshot)[rootSessionID];
  if (!accum) {
    return {
      inputTotal: 0,
      outputTotal: 0,
      cacheRead: 0,
      cacheWrite: 0,
      contextUsed: 0,
    };
  }
  return {
    inputTotal: accum.input,
    outputTotal: accum.output,
    cacheRead: accum.cacheRead,
    cacheWrite: accum.cacheWrite,
    contextUsed: accum.contextUsed,
  };
}

export function getSidebarAgentNames(snapshot: TuiSnapshot): string[] {
  void snapshot;
  const names = Object.keys(AGENT_SIDEBAR_DESCRIPTIONS);
  return names.sort((a, b) => {
    const pa = AGENT_SORT_PRIORITY[a] ?? 99;
    const pb = AGENT_SORT_PRIORITY[b] ?? 99;
    if (pa !== pb) return pa - pb;
    return a.localeCompare(b);
  });
}

function formatUsageTime(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return 'now';
  const totalMin = Math.ceil(diff / 60000);
  const hours = Math.floor(totalMin / 60);
  const minutes = totalMin % 60;
  if (hours > 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/** Neuralwatt token counts: integer with grouping (e.g. 66,837,723), no K/M/B shorthand. */
function neuralwattTokensFormatted(tokens: number): string {
  if (!Number.isFinite(tokens)) return '0';
  return Math.trunc(tokens).toLocaleString('en-US');
}

function formatBalanceAmount(value: string, currency: string): string {
  const amount = Number(value);
  if (Number.isFinite(amount)) {
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency,
      }).format(amount);
    } catch {
      return `${currency} ${amount.toFixed(2)}`;
    }
  }
  return `${currency} ${value}`;
}

function pushNeuralwattMonthlyTokensRow(
  rows: Child[],
  theme: { textMuted: unknown },
  u: NeuralwattUsage,
): void {
  rows.push(
    box({ width: '100%', flexDirection: 'row' }, [
      text({ fg: theme.textMuted }, [
        `   ${neuralwattTokensFormatted(u.current_month.tokens)} Tokens this month`,
      ]),
    ]),
  );
}

const BAR_WIDTH = 18;
const SIGMA_TOTAL_COLOR = '#F5B041';

/** Gap between the two compact metrics on the right (icon+value each). */
const METRIC_PAIR_GAP = ' ';

type MetricPairTheme = {
  leftFg: unknown;
  rightFg: unknown;
  gapFg: unknown;
};

function renderMetricPairRight(
  leftIcon: string,
  leftValue: string,
  rightIcon: string,
  rightValue: string,
  colors: MetricPairTheme,
): Child {
  return box({ flexDirection: 'row', flexShrink: 0 }, [
    text({ fg: colors.leftFg }, [`${leftIcon} ${leftValue}`]),
    text({ fg: colors.gapFg }, [METRIC_PAIR_GAP]),
    text({ fg: colors.rightFg }, [`${rightIcon} ${rightValue}`]),
  ]);
}

function renderUsageBar(percent: number): string {
  const filled = Math.round((percent / 100) * BAR_WIDTH);
  const empty = BAR_WIDTH - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

function getUsageColor(percentRemaining: number): string {
  if (percentRemaining < 25) return '#E74C3C'; // red
  if (percentRemaining < 50) return '#F39C12'; // amber/yellow
  return ''; // empty = use default theme color
}

function renderOpenCodeGoBars(
  entry: SubscriptionUsageEntry & { provider: 'opencode-go' },
  rows: Child[],
  theme: { text: unknown; textMuted: unknown; accent: unknown },
): void {
  const windows: Array<{
    label: string;
    w: { percentRemaining: number; resetTimeIso: string };
  }> = [];

  if (entry.rolling) windows.push({ label: 'R', w: entry.rolling });
  if (entry.weekly) windows.push({ label: 'W', w: entry.weekly });
  if (entry.monthly) windows.push({ label: 'M', w: entry.monthly });

  for (let i = 0; i < windows.length; i++) {
    const { label, w } = windows[i];
    if (!w) continue;
    const usageColor = getUsageColor(w.percentRemaining);
    const bar = renderUsageBar(w.percentRemaining);
    const pct = w.percentRemaining.toFixed(0).padStart(3);
    const timeLeft = formatUsageTime(w.resetTimeIso);

    rows.push(
      box(
        {
          width: '100%',
          flexDirection: 'row',
          justifyContent: 'space-between',
        },
        [
          box({ flexDirection: 'row' }, [
            text({ fg: theme.accent }, [`${label} `]),
            text({ fg: usageColor || theme.text }, [bar]),
            text({ fg: usageColor || theme.textMuted }, [` ${pct}%`]),
          ]),
          text({ fg: theme.textMuted }, [timeLeft]),
        ],
      ),
    );
  }
}

function renderNeuralwattUsage(
  entry: NeuralwattUsageEntry,
  rows: Child[],
  theme: { text: unknown; textMuted: unknown; accent: unknown },
): void {
  const { subscription, balance, usage: u } = entry;

  if (subscription && subscription.status === 'active') {
    // Active subscription: show kWh bar with remaining and reset time
    const kwhIncluded = subscription.kwh_included ?? 0;
    const kwhUsed = subscription.kwh_used ?? 0;
    const kwhRemaining = subscription.kwh_remaining ?? 0;

    if (kwhIncluded > 0) {
      const kwhPct = Math.min((kwhUsed / kwhIncluded) * 100, 100);
      const bar = renderUsageBar(100 - kwhPct); // remaining percent
      const remaining = kwhRemaining.toFixed(1);
      const resetTime = subscription.current_period_end
        ? formatUsageTime(subscription.current_period_end)
        : '';
      const color = kwhPct > 90 ? '#E74C3C' : kwhPct > 75 ? '#F39C12' : '';

      rows.push(
        box(
          {
            width: '100%',
            flexDirection: 'row',
            justifyContent: 'space-between',
          },
          [
            box({ flexDirection: 'row' }, [
              text({ fg: theme.accent }, ['⚡ ']),
              text({ fg: color || theme.text }, [bar]),
              text({ fg: color || theme.textMuted }, [` ${remaining}kWh`]),
            ]),
            text({ fg: theme.textMuted }, [resetTime]),
          ],
        ),
      );
    }

    // Also show monthly cost
    rows.push(
      box(
        {
          width: '100%',
          flexDirection: 'row',
          justifyContent: 'space-between',
        },
        [
          text({ fg: theme.textMuted }, [
            `   $${u.current_month.cost_usd.toFixed(2)} this month`,
          ]),
          text({ fg: theme.textMuted }, [
            `⚡ ${u.current_month.energy_kwh.toFixed(1)} kWh`,
          ]),
        ],
      ),
    );
    pushNeuralwattMonthlyTokensRow(rows, theme, u);
  } else if (subscription && subscription.status !== 'active') {
    // Non-active subscription (canceling, past_due, paused, trialing)
    const statusColor =
      subscription.status === 'past_due' || subscription.status === 'canceling'
        ? '#E74C3C'
        : '#F39C12';

    rows.push(
      box(
        {
          width: '100%',
          flexDirection: 'row',
          justifyContent: 'space-between',
        },
        [
          text({ fg: statusColor }, [`  Status: ${subscription.status}`]),
          text({ fg: theme.textMuted }, [
            `⚡ ${u.current_month.energy_kwh.toFixed(1)} kWh`,
          ]),
        ],
      ),
    );

    // Show kWh bar if available
    const kwhIncluded = subscription.kwh_included ?? 0;
    const kwhUsed = subscription.kwh_used ?? 0;
    const kwhRemaining = subscription.kwh_remaining ?? 0;
    if (kwhIncluded > 0) {
      const kwhPct = Math.min((kwhUsed / kwhIncluded) * 100, 100);
      const bar = renderUsageBar(100 - kwhPct);
      const remaining = kwhRemaining.toFixed(1);
      const resetTime = subscription.current_period_end
        ? formatUsageTime(subscription.current_period_end)
        : '';
      const color = kwhPct > 90 ? '#E74C3C' : kwhPct > 75 ? '#F39C12' : '';

      rows.push(
        box(
          {
            width: '100%',
            flexDirection: 'row',
            justifyContent: 'space-between',
          },
          [
            box({ flexDirection: 'row' }, [
              text({ fg: theme.accent }, ['⚡ ']),
              text({ fg: color || theme.text }, [bar]),
              text({ fg: color || theme.textMuted }, [` ${remaining}kWh`]),
            ]),
            text({ fg: theme.textMuted }, [resetTime]),
          ],
        ),
      );
    }

    // Show credits if available
    if (balance.credits_remaining_usd > 0) {
      rows.push(
        box(
          {
            width: '100%',
            flexDirection: 'row',
            justifyContent: 'space-between',
          },
          [
            text({ fg: theme.textMuted }, [
              `  💰 $${balance.credits_remaining_usd.toFixed(2)} remaining`,
            ]),
            text({ fg: theme.textMuted }, [
              `$${u.current_month.cost_usd.toFixed(2)}/mo`,
            ]),
          ],
        ),
      );
    }
    pushNeuralwattMonthlyTokensRow(rows, theme, u);
  } else {
    // No subscription (credit-only): show credits and monthly usage
    rows.push(
      box(
        {
          width: '100%',
          flexDirection: 'row',
          justifyContent: 'space-between',
        },
        [
          text({ fg: theme.text }, [
            `💰 $${balance.credits_remaining_usd.toFixed(2)} remaining`,
          ]),
          text({ fg: theme.textMuted }, [
            `⚡ ${u.current_month.energy_kwh.toFixed(3)} kWh/mo`,
          ]),
        ],
      ),
    );
    rows.push(
      box(
        {
          width: '100%',
          flexDirection: 'row',
          justifyContent: 'space-between',
        },
        [
          text({ fg: theme.textMuted }, [
            `   $${u.current_month.cost_usd.toFixed(2)} this month`,
          ]),
        ],
      ),
    );
    pushNeuralwattMonthlyTokensRow(rows, theme, u);
  }
}

function renderCodexUsage(
  entry: CodexUsageEntry,
  rows: Child[],
  theme: { text: unknown; textMuted: unknown; accent: unknown },
): void {
  // Primary usage window (5H for paid, 7D for free)
  if (entry.primaryWindow) {
    const w = entry.primaryWindow;
    const usageColor = getUsageColor(w.percentRemaining);
    const bar = renderUsageBar(w.percentRemaining);
    const pct = w.percentRemaining.toFixed(0).padStart(3);
    const timeLeft = formatUsageTime(w.resetTimeIso);

    rows.push(
      box(
        {
          width: '100%',
          flexDirection: 'row',
          justifyContent: 'space-between',
        },
        [
          box({ flexDirection: 'row' }, [
            text({ fg: theme.accent }, [entry.secondaryWindow ? '5H ' : '7D ']),
            text({ fg: usageColor || theme.text }, [bar]),
            text({ fg: usageColor || theme.textMuted }, [` ${pct}%`]),
          ]),
          text({ fg: theme.textMuted }, [timeLeft]),
        ],
      ),
    );
  }

  // 7D row
  if (entry.secondaryWindow) {
    const w = entry.secondaryWindow;
    const usageColor = getUsageColor(w.percentRemaining);
    const bar = renderUsageBar(w.percentRemaining);
    const pct = w.percentRemaining.toFixed(0).padStart(3);
    const timeLeft = formatUsageTime(w.resetTimeIso);

    rows.push(
      box(
        {
          width: '100%',
          flexDirection: 'row',
          justifyContent: 'space-between',
        },
        [
          box({ flexDirection: 'row' }, [
            text({ fg: theme.accent }, ['7D ']),
            text({ fg: usageColor || theme.text }, [bar]),
            text({ fg: usageColor || theme.textMuted }, [` ${pct}%`]),
          ]),
          text({ fg: theme.textMuted }, [timeLeft]),
        ],
      ),
    );
  }

  // Credits row
  const balance = entry.credits.balance;
  rows.push(
    box({ width: '100%', flexDirection: 'row' }, [
      text({ fg: theme.text }, [
        entry.credits.unlimited
          ? '💰 Unlimited credits'
          : `💰 $${balance.toFixed(2)} credits`,
      ]),
    ]),
  );

  // Banked rate-limit reset credits row
  if (
    entry.rateLimitResetCredits &&
    entry.rateLimitResetCredits.availableCount > 0
  ) {
    const rlc = entry.rateLimitResetCredits;
    if (rlc.credits.length === 0) {
      rows.push(
        box({ width: '100%', flexDirection: 'row' }, [
          text({ fg: theme.textMuted }, [
            `   Resets: ${rlc.availableCount} available`,
          ]),
        ]),
      );
    } else {
      const expiries = rlc.credits
        .map((c) => formatUsageTime(c.expiresAt))
        .slice(0, 3);
      const extra = rlc.credits.length - 3;
      const expiryText =
        extra > 0 ? `${expiries.join(', ')} +${extra}` : expiries.join(', ');
      rows.push(
        box({ width: '100%', flexDirection: 'row' }, [
          text({ fg: theme.textMuted }, [
            `   Resets: ${rlc.availableCount} · expires ${expiryText}`,
          ]),
        ]),
      );
    }
  }

  // Plan type row
  if (entry.planType) {
    const displayPlan =
      entry.planType.charAt(0).toUpperCase() + entry.planType.slice(1);
    rows.push(
      box({ width: '100%', flexDirection: 'row' }, [
        text({ fg: theme.textMuted }, [`   Plan: ${displayPlan}`]),
      ]),
    );
  }
}

function renderDeepSeekUsage(
  entry: DeepSeekUsageEntry,
  rows: Child[],
  theme: { text: unknown; textMuted: unknown; accent: unknown },
): void {
  if (!entry.is_available) {
    rows.push(
      box({ width: '100%', flexDirection: 'row' }, [
        text({ fg: '#E74C3C' }, ['  Status: insufficient balance']),
      ]),
    );
  }

  if (entry.balance_infos.length === 0) {
    rows.push(
      box({ width: '100%', flexDirection: 'row' }, [
        text({ fg: theme.textMuted }, ['  💰 No balance data']),
      ]),
    );
    return;
  }

  for (const balanceInfo of entry.balance_infos) {
    rows.push(
      box({ width: '100%', flexDirection: 'row' }, [
        text({ fg: theme.text }, [
          `💰 ${formatBalanceAmount(balanceInfo.total_balance, balanceInfo.currency)} total`,
        ]),
      ]),
    );
    rows.push(
      box({ width: '100%', flexDirection: 'row' }, [
        text({ fg: theme.textMuted }, [
          `   Top-up ${formatBalanceAmount(balanceInfo.topped_up_balance, balanceInfo.currency)}`,
        ]),
      ]),
    );
    rows.push(
      box({ width: '100%', flexDirection: 'row' }, [
        text({ fg: theme.textMuted }, [
          `   Grant ${formatBalanceAmount(balanceInfo.granted_balance, balanceInfo.currency)}`,
        ]),
      ]),
    );
  }
}

/** Format a token count as a human-readable decimal string (e.g. "77.234M"). */
function formatMimoTokenDecimal(tokens: number): string {
  if (tokens >= 1_000_000_000) {
    return `${(tokens / 1_000_000_000).toFixed(3)}B`;
  }
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(3)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(3)}K`;
  }
  return tokens.toFixed(3);
}

function renderMiMoUsage(
  entry: MiMoUsageEntry,
  rows: Child[],
  theme: { text: unknown; textMuted: unknown; accent: unknown },
): void {
  // Row 1: AI Credits (used / max limit)
  const planTotalItem = entry.planUsage.items.find(
    (i) => i.name === 'plan_total_token',
  );
  if (planTotalItem) {
    const usedStr = formatMimoTokenDecimal(planTotalItem.used);
    const limitStr = formatMimoTokenDecimal(planTotalItem.limit);
    rows.push(
      box({ width: '100%', flexDirection: 'row' }, [
        text({ fg: theme.accent }, [`${usedStr} / ${limitStr} AI Credits`]),
      ]),
    );
  }

  // Row 2: Progress bar with remaining percentage
  const percentRemaining = planTotalItem
    ? 100 - (planTotalItem.percent ?? 0) * 100
    : 100;
  const bar = renderUsageBar(percentRemaining);
  const color = getUsageColor(percentRemaining);
  rows.push(
    box({ width: '100%', flexDirection: 'row' }, [
      text({ fg: color || theme.text }, [
        `${bar} ${percentRemaining.toFixed(1)}%`,
      ]),
    ]),
  );

  // Row 3: Balance
  const balance = entry.balance.balance ?? '0';
  rows.push(
    box({ width: '100%', flexDirection: 'row' }, [
      text({ fg: theme.text }, [`💰 $${balance} remaining`]),
    ]),
  );

  // Row 4: Plan name
  const planName = entry.planDetail.planName || 'Unknown';
  rows.push(
    box({ width: '100%', flexDirection: 'row' }, [
      text({ fg: theme.textMuted }, [`   Plan: ${planName}`]),
    ]),
  );
}

function renderSubscriptionPanel(
  snapshot: TuiSnapshot,
  theme: {
    text: unknown;
    textMuted: unknown;
    accent: unknown;
    borderActive: unknown;
  },
): Child[] {
  const usage = snapshot.subscriptionUsage ?? {};
  const usageEntries = Object.entries(usage).sort(([, a], [, b]) => {
    if (a.provider !== b.provider) return a.provider.localeCompare(b.provider);
    return a.accountName.localeCompare(b.accountName);
  });
  if (usageEntries.length === 0) return [];

  const activeNames = deriveActiveNames(
    snapshot.activeSubscriptionByProvider ?? {},
  );
  const rows: Child[] = [];
  let isFirstAccount = true;

  for (const [, entry] of usageEntries) {
    const name = entry.accountName;
    const isActive = activeNames.has(name);
    const providerLabel = tuiProviderLabel(entry.provider);

    if (!isFirstAccount) {
      rows.push(box({ width: '100%', height: 1 }));
    }
    isFirstAccount = false;

    if (entry.error) {
      rows.push(
        box({ width: '100%', flexDirection: 'row' }, [
          text(isActive ? { fg: theme.accent } : { fg: theme.text }, [
            isActive
              ? `★ ${truncate(name, 18)}${providerLabel}`
              : `${truncate(name, 16)}${providerLabel}`,
          ]),
          text({ fg: theme.textMuted }, [' ⚠️']),
        ]),
      );
      rows.push(
        text({ fg: theme.textMuted }, [`  ${truncate(entry.error, 56)}`]),
      );
      continue;
    }

    const displayName = isActive
      ? `★ ${truncate(name, 18)}${providerLabel}`
      : `${truncate(name, 16)}${providerLabel}`;

    rows.push(
      box({ width: '100%', flexDirection: 'row' }, [
        text(isActive ? { fg: theme.accent } : { fg: theme.text }, [
          displayName,
        ]),
      ]),
    );

    // Provider-specific rendering
    if (entry.provider === 'opencode-go') {
      renderOpenCodeGoBars(entry, rows, theme);
    } else if (entry.provider === 'neuralwatt') {
      renderNeuralwattUsage(entry, rows, theme);
    } else if (entry.provider === 'deepseek') {
      renderDeepSeekUsage(entry as DeepSeekUsageEntry, rows, theme);
    } else if (entry.provider === 'mimo') {
      try {
        renderMiMoUsage(entry as MiMoUsageEntry, rows, theme);
      } catch (_e) {
        rows.push(text({ fg: '#E74C3C' }, ['  ⚠️ Error rendering MiMo usage']));
      }
    } else if (entry.provider === 'codex') {
      try {
        renderCodexUsage(entry as CodexUsageEntry, rows, theme);
      } catch (_e) {
        rows.push(text({ fg: '#E74C3C' }, ['  ⚠️ Error rendering Codex usage']));
      }
    } else {
      rows.push(
        text({ fg: '#F39C12' }, [
          '  ⚠️ Provider field missing - re-add account with /subscriptions',
        ]),
      );
    }
  }

  return rows;
}

const FLASH_DURATION_MS = 2000;

function getStatusText(snapshot: TuiSnapshot, sessionID: string): string {
  return mergedSessionTree(snapshot)[sessionID]?.status ?? '-';
}

function getStatusWithDuration(
  snapshot: TuiSnapshot,
  sessionID: string,
  node: SessionNode,
  now: number,
): string {
  const status = getStatusText(snapshot, sessionID);
  // Only show duration for running sessions (busy/retry)
  if (node.status === 'busy' || node.status === 'retry') {
    const elapsed = now - node.createdAt;
    return `${status} (${formatDuration(elapsed)})`;
  }
  return status;
}

function getSpinnerChar(now: number): string {
  return SPINNER_FRAMES[Math.floor(now / 80) % SPINNER_FRAMES.length];
}

function getStatusColor(
  status: string,
  theme: {
    text: unknown;
    textMuted: unknown;
    accent: unknown;
    error?: unknown; // Add optional error color
  },
): unknown {
  const normalized = status.trim();
  if (normalized === 'busy' || normalized.startsWith('busy '))
    return theme.accent;
  if (normalized === 'retry' || normalized.startsWith('retry '))
    return theme.error ?? '#EF4444'; // Red for retry
  if (status === 'idle') return theme.textMuted;
  return theme.text;
}

/** `busy (0:12)` → status + timer; timer uses normal text color in the UI. */
function splitStatusAndTimer(
  full: string,
): { status: string; timer: string } | null {
  const m = full.match(/^(\S+)\s+(\([^)]+\))$/);
  if (!m) return null;
  return { status: m[1], timer: full.slice(m[1].length) };
}

function renderStatusLineWithOptionalTimer(
  full: string,
  theme: {
    text: unknown;
    textMuted: unknown;
    accent: unknown;
    error?: unknown;
  },
): Child {
  const split = splitStatusAndTimer(full);
  if (!split) {
    return text({ fg: getStatusColor(full, theme) }, [full]);
  }
  return box({ flexDirection: 'row', flexShrink: 0 }, [
    text({ fg: getStatusColor(split.status, theme) }, [split.status]),
    text({ fg: theme.text }, [split.timer]),
  ]);
}

interface SessionEntry {
  sessionID: string;
  agentName: string;
  running: boolean;
  finished: boolean;
}

function buildOrchestratingRows(
  snapshot: TuiSnapshot,
  now: number,
  theme: {
    text: unknown;
    textMuted: unknown;
    accent: unknown;
    error?: unknown;
  },
): [string, ...Child[]] {
  const tree = mergedSessionTree(snapshot);
  const usageBySession = mergedSessionUsage(snapshot);
  const spinner = getSpinnerChar(now);
  const isVisibleSession = (node: SessionNode): boolean => {
    if (node.status === 'busy' || node.status === 'retry') return true;
    if (node.status !== 'idle' || !node.finishedAt) return false;
    return now - node.finishedAt < FLASH_DURATION_MS + 1000;
  };
  const getVisibleChildren = (parentID: string): Array<[string, SessionNode]> =>
    Object.entries(tree).filter(
      ([, child]) => child.parentId === parentID && isVisibleSession(child),
    );
  const pushUsageRows = (
    rows: Child[],
    sessionID: string,
    prefix: string,
    abbreviateLeft: boolean,
  ): void => {
    const metrics = formatSessionUsageRows(snapshot, sessionID, {
      abbreviateLeft,
    });
    const isChild = !!tree[sessionID]?.parentId;

    if (isChild) {
      // Child session: 4-row vertical stack (after tree header + model).
      // Row 1: CTX | Row 2: CACHE total | Row 3: Input/Output | Row 4: Read/Write
      rows.push(
        box({ width: '100%', flexDirection: 'row' }, [
          text({ fg: theme.textMuted }, [prefix]),
          text({ fg: theme.accent }, [`${metrics.ctxLabel} `]),
          text({ fg: theme.text }, [metrics.ctxValue]),
        ]),
      );
      const cacheTotalForRow =
        (usageBySession[sessionID]?.cacheRead ?? 0) +
        (usageBySession[sessionID]?.cacheWrite ?? 0);
      rows.push(
        box({ width: '100%', flexDirection: 'row' }, [
          text({ fg: theme.textMuted }, [prefix]),
          text({ fg: theme.accent }, [`${metrics.cacheLabel} `]),
          text({ fg: theme.text }, [formatTokenExact(cacheTotalForRow)]),
        ]),
      );
      rows.push(
        box({ width: '100%', flexDirection: 'row' }, [
          text({ fg: theme.textMuted }, [prefix]),
          renderMetricPairRight(
            '↓',
            `Input ${metrics.ioInputAbbrev}`,
            '↑',
            `Output ${metrics.ioOutputAbbrev}`,
            {
              leftFg: '#5DADE2',
              rightFg: '#58D68D',
              gapFg: theme.textMuted,
            },
          ),
        ]),
      );
      rows.push(
        box({ width: '100%', flexDirection: 'row' }, [
          text({ fg: theme.textMuted }, [prefix]),
          renderMetricPairRight(
            '📖',
            `Read ${metrics.cacheReadAbbrev}`,
            '📝',
            `Write ${metrics.cacheWriteAbbrev}`,
            {
              leftFg: '#5DADE2',
              rightFg: '#AF7AC5',
              gapFg: theme.textMuted,
            },
          ),
        ]),
      );
    } else {
      // Orchestrator session: 2-row left-right compact layout
      // Row 1: CTX ... ↓ input ↑ output
      rows.push(
        box(
          {
            width: '100%',
            flexDirection: 'row',
            justifyContent: 'space-between',
          },
          [
            box({ flexDirection: 'row' }, [
              text({ fg: theme.textMuted }, [prefix]),
              text({ fg: theme.accent }, [`${metrics.ctxLabel} `]),
              text({ fg: theme.text }, [metrics.ctxValue]),
            ]),
            renderMetricPairRight(
              '↓',
              metrics.ioInputAbbrev,
              '↑',
              metrics.ioOutputAbbrev,
              {
                leftFg: '#5DADE2',
                rightFg: '#58D68D',
                gapFg: theme.textMuted,
              },
            ),
          ],
        ),
      );
      // Row 2: CACHE ... 📖 read  📝 write
      rows.push(
        box(
          {
            width: '100%',
            flexDirection: 'row',
            justifyContent: 'space-between',
          },
          [
            box({ flexDirection: 'row' }, [
              text({ fg: theme.textMuted }, [prefix]),
              text({ fg: theme.accent }, [`${metrics.cacheLabel} `]),
              text({ fg: theme.text }, [metrics.cacheValue]),
            ]),
            renderMetricPairRight(
              '📖',
              metrics.cacheReadAbbrev,
              '📝',
              metrics.cacheWriteAbbrev,
              {
                leftFg: '#5DADE2',
                rightFg: '#AF7AC5',
                gapFg: theme.textMuted,
              },
            ),
          ],
        ),
      );
    }
  };
  const pushAggregateRows = (
    rows: Child[],
    sessionID: string,
    prefix: string,
  ): void => {
    const totals = aggregateOrchestrationUsage(snapshot, sessionID);
    const totalIo = totals.contextUsed;
    const totalCache = totals.cacheRead + totals.cacheWrite;
    const isChild = !!tree[sessionID]?.parentId;

    if (isChild) {
      rows.push(
        box({ width: '100%', flexDirection: 'row' }, [
          text({ fg: theme.textMuted }, [prefix]),
          text({ fg: SIGMA_TOTAL_COLOR }, ['Σ TOTAL ']),
          text({ fg: theme.text }, [formatTokenExact(totalIo)]),
        ]),
      );
      rows.push(
        box({ width: '100%', flexDirection: 'row' }, [
          text({ fg: theme.textMuted }, [prefix]),
          text({ fg: SIGMA_TOTAL_COLOR }, ['Σ CACHE ']),
          text({ fg: theme.text }, [formatTokenAbbrev(totalCache)]),
        ]),
      );
      rows.push(
        box({ width: '100%', flexDirection: 'row' }, [
          text({ fg: theme.textMuted }, [prefix]),
          renderMetricPairRight(
            '↓',
            `Input ${formatTokenAbbrev(totals.inputTotal)}`,
            '↑',
            `Output ${formatTokenAbbrev(totals.outputTotal)}`,
            {
              leftFg: '#5DADE2',
              rightFg: '#58D68D',
              gapFg: theme.textMuted,
            },
          ),
        ]),
      );
      rows.push(
        box({ width: '100%', flexDirection: 'row' }, [
          text({ fg: theme.textMuted }, [prefix]),
          renderMetricPairRight(
            '📖',
            `Read ${formatTokenAbbrev(totals.cacheRead)}`,
            '📝',
            `Write ${formatTokenAbbrev(totals.cacheWrite)}`,
            {
              leftFg: '#5DADE2',
              rightFg: '#AF7AC5',
              gapFg: theme.textMuted,
            },
          ),
        ]),
      );
    } else {
      // Orchestrator session: 2-row left-right compact layout
      // Row 1: Σ TOTAL [value] ... ↓ Input [value] ↑ Output [value]
      rows.push(
        box(
          {
            width: '100%',
            flexDirection: 'row',
            justifyContent: 'space-between',
          },
          [
            box({ flexDirection: 'row' }, [
              text({ fg: theme.textMuted }, [prefix]),
              text({ fg: SIGMA_TOTAL_COLOR }, ['Σ TOTAL ']),
              text({ fg: theme.text }, [formatTokenExact(totalIo)]),
            ]),
            renderMetricPairRight(
              '↓',
              formatTokenAbbrev(totals.inputTotal),
              '↑',
              formatTokenAbbrev(totals.outputTotal),
              {
                leftFg: '#5DADE2',
                rightFg: '#58D68D',
                gapFg: theme.textMuted,
              },
            ),
          ],
        ),
      );
      // Row 2: Σ CACHE [value] ... 📖 Read [value] 📝 Write [value]
      rows.push(
        box(
          {
            width: '100%',
            flexDirection: 'row',
            justifyContent: 'space-between',
          },
          [
            box({ flexDirection: 'row' }, [
              text({ fg: theme.textMuted }, [prefix]),
              text({ fg: SIGMA_TOTAL_COLOR }, ['Σ CACHE ']),
              text({ fg: theme.text }, [formatTokenExact(totalCache)]),
            ]),
            renderMetricPairRight(
              '📖',
              formatTokenAbbrev(totals.cacheRead),
              '📝',
              formatTokenAbbrev(totals.cacheWrite),
              {
                leftFg: '#5DADE2',
                rightFg: '#AF7AC5',
                gapFg: theme.textMuted,
              },
            ),
          ],
        ),
      );
    }
  };

  // Collect visible orchestrator sessions (running + flashing done)
  const visibleOrchSessions: Array<[string, SessionNode]> = [];

  for (const [id, node] of Object.entries(tree)) {
    if (node.agent !== 'orchestrator') continue;
    if (node.status === 'busy' || node.status === 'retry') {
      visibleOrchSessions.push([id, node]);
    } else if (node.status === 'idle') {
      // Check if any children are still visible (running or flashing)
      const hasVisibleChildren = getVisibleChildren(id).length > 0;
      if (hasVisibleChildren) {
        // Children still active - keep orchestrator visible (will show spinner)
        visibleOrchSessions.push([id, node]);
      } else if (node.finishedAt) {
        // No children - flash timeout applies
        const elapsed = now - node.finishedAt;
        if (elapsed < FLASH_DURATION_MS + 1000) {
          visibleOrchSessions.push([id, node]);
        }
      } else {
        // Idle without finishedAt (edge case)
        visibleOrchSessions.push([id, node]);
      }
    }
  }

  const countLabel = `${visibleOrchSessions.length} active`;

  if (visibleOrchSessions.length === 0) {
    return [
      countLabel,
      text({ fg: theme.textMuted }, ['No active orchestrations']),
    ];
  }

  const rows: Child[] = [];

  const renderChildren = (parentID: string, indentPrefix: string): void => {
    const visibleChildren = getVisibleChildren(parentID);
    for (let i = 0; i < visibleChildren.length; i++) {
      const [childId, child] = visibleChildren[i];
      const isLast = i === visibleChildren.length - 1;
      const branchChar = isLast ? '└' : '├';
      const pipeChar = isLast ? ' ' : '│';

      const childFlash =
        child.status === 'idle' &&
        child.finishedAt &&
        Math.floor((now - child.finishedAt) / 200) % 2 === 0;
      const indicator =
        child.status === 'busy' || child.status === 'retry'
          ? spinner
          : childFlash
            ? '·'
            : ' ';
      const childStatusText = getStatusWithDuration(
        snapshot,
        childId,
        child,
        now,
      );
      const childVariant = child.variant;
      const detailPrefix = `${indentPrefix}${pipeChar}    `;

      rows.push(
        box(
          {
            width: '100%',
            flexDirection: 'row',
            justifyContent: 'space-between',
          },
          [
            box({ flexDirection: 'row', flexShrink: 0 }, [
              text({ fg: theme.textMuted }, [`${indentPrefix}${branchChar}─ `]),
              text({ fg: theme.text }, [`${indicator} ${child.agent}`]),
            ]),
            renderStatusLineWithOptionalTimer(childStatusText, theme),
          ],
        ),
      );
      rows.push(
        box({ width: '100%', flexDirection: 'row' }, [
          text({ fg: theme.textMuted }, [detailPrefix]),
          text({ fg: theme.textMuted }, [
            formatSidebarModelAndVariant(
              child.model,
              childVariant,
              ORCH_CHILD_MODEL_DISPLAY_MAX,
            ),
          ]),
        ]),
      );
      pushUsageRows(rows, childId, detailPrefix, false);

      renderChildren(childId, `${indentPrefix}${pipeChar}  `);
    }
  };

  for (const [orchId, orchNode] of visibleOrchSessions) {
    const visibleChildren = getVisibleChildren(orchId);

    // Orchestrator dot: spinner while busy or while idle but children still
    // visible; flash dot only when idle AND all children have cleared.
    const orchShowSpinner =
      orchNode.status === 'busy' ||
      orchNode.status === 'retry' ||
      (orchNode.status === 'idle' && visibleChildren.length > 0);
    const orchFlash =
      orchNode.status === 'idle' &&
      !orchShowSpinner &&
      orchNode.finishedAt &&
      now >= orchNode.finishedAt &&
      Math.floor((now - orchNode.finishedAt) / 200) % 2 === 0;
    const orchDot = orchShowSpinner ? spinner : orchFlash ? '·' : ' ';

    const row1Title = orchNode.title?.trim()
      ? truncate(orchNode.title, ORCH_ROOT_TITLE_DISPLAY_MAX)
      : ORCH_DEFAULT_TITLE_LABEL;

    rows.push(
      box(
        {
          flexDirection: 'row',
          justifyContent: 'space-between',
        },
        [
          box({ flexDirection: 'row' }, [
            text({ fg: theme.accent }, [`${orchDot} `]),
            text({ fg: theme.accent }, [row1Title]),
          ]),
          text({ fg: theme.text }, [
            orchNode.status === 'busy' || orchNode.status === 'retry'
              ? `(${formatDuration(now - orchNode.createdAt)})`
              : '',
          ]),
        ],
      ),
    );
    const bundle = snapshot.sessions[orchId];
    const projectName = bundle?.projectPath
      ? basename(bundle.projectPath)
      : undefined;
    if (projectName) {
      rows.push(
        box({ width: '100%', flexDirection: 'row' }, [
          text({ fg: theme.textMuted }, ['  ']),
          text({ fg: theme.text }, [
            truncate(projectName, ORCH_ROOT_TITLE_DISPLAY_MAX),
          ]),
        ]),
      );
    }
    const orchStatusText = getStatusText(snapshot, orchId);
    rows.push(
      box(
        {
          width: '100%',
          flexDirection: 'row',
          justifyContent: 'space-between',
        },
        [
          box({ flexDirection: 'row', flexShrink: 0 }, [
            text({ fg: theme.textMuted }, ['  ']),
            text({ fg: theme.textMuted }, [
              truncate(orchId, ORCH_ROOT_SESSION_ID_DISPLAY_MAX),
            ]),
          ]),
          renderStatusLineWithOptionalTimer(orchStatusText, theme),
        ],
      ),
    );
    const modelLine = formatSidebarModelAndVariant(
      orchNode.model,
      orchNode.variant,
      ORCH_ROOT_MODEL_DISPLAY_MAX,
    );
    rows.push(
      box({ width: '100%', flexDirection: 'row' }, [
        text({ fg: theme.textMuted }, ['  ']),
        text({ fg: theme.textMuted }, [
          modelLine.length > 0 ? modelLine : 'pending',
        ]),
      ]),
    );
    pushUsageRows(rows, orchId, '  ', true);
    pushAggregateRows(rows, orchId, '  ');
    renderChildren(orchId, '  ');

    rows.push(box({ width: '100%', height: 1 }));
  }

  return [countLabel, ...rows];
}

function getActiveSessions(snapshot: TuiSnapshot, now: number): SessionEntry[] {
  const entries: SessionEntry[] = [];
  const tree = mergedSessionTree(snapshot);

  for (const [sessionID, node] of Object.entries(tree)) {
    const agentName = node.agent;
    if (!agentName) continue;

    if (node.status === 'busy' || node.status === 'retry') {
      entries.push({ sessionID, agentName, running: true, finished: false });
    } else if (node.status === 'idle' && node.finishedAt) {
      // For the orchestrator, don't flash until all children have cleared.
      // Show spinner (running: true) while any child is still visible.
      let running = false;
      if (agentName === 'orchestrator') {
        const hasVisibleChildren = Object.entries(tree).some(
          ([_cid, cnode]) =>
            cnode.parentId === sessionID &&
            (cnode.status === 'busy' ||
              cnode.status === 'retry' ||
              (cnode.status === 'idle' &&
                cnode.finishedAt &&
                now - cnode.finishedAt < FLASH_DURATION_MS + 1000)),
        );
        if (hasVisibleChildren) running = true;
      }
      // Account for polling delay: TUI may not see the finish until 1s later
      if (now - node.finishedAt < FLASH_DURATION_MS + 1000) {
        entries.push({
          sessionID,
          agentName,
          running,
          finished: !running,
        });
      }
    }
  }

  return entries;
}

function renderSidebar(
  snapshot: TuiSnapshot,
  theme: {
    accent: unknown;
    borderActive: unknown;
    text: unknown;
    textMuted: unknown;
    error?: unknown;
  },
): JSX.Element {
  const now = Date.now();
  const mergedTreeSidebar = mergedSessionTree(snapshot);
  const sessions = getActiveSessions(snapshot, now);
  const totalActive = sessions.filter((s) => s.running).length;
  const spinner = getSpinnerChar(now);

  const ourSessions = sessions
    .filter((s) => s.agentName in AGENT_SORT_PRIORITY)
    .sort((a, b) => {
      const pa = AGENT_SORT_PRIORITY[a.agentName] ?? 99;
      const pb = AGENT_SORT_PRIORITY[b.agentName] ?? 99;
      if (pa !== pb) return pa - pb;
      return a.agentName.localeCompare(b.agentName);
    });

  const customSessions = sessions
    .filter((s) => !(s.agentName in AGENT_SORT_PRIORITY))
    .sort((a, b) => a.agentName.localeCompare(b.agentName));

  const agentRows: Child[] = [];

  interface SessionGroup {
    sessionID: string;
    agentName: string;
    running: boolean;
    finished: boolean;
    count: number;
    model: string;
    variant: string | undefined;
  }

  const ourGroups = new Map<string, SessionGroup>();
  for (const entry of ourSessions) {
    const { sessionID, agentName, running, finished } = entry;
    const rawModel = mergedTreeSidebar[sessionID]?.model;
    const model = rawModel ? formatSidebarModelName(rawModel) : 'pending';
    const variant = mergedTreeSidebar[sessionID]?.variant;
    const key = `${agentName}\x00${model}\x00${variant ?? ''}`;

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
        variant,
      });
    }
  }

  for (const entry of ourGroups.values()) {
    const { sessionID, agentName, running, finished, count, variant } = entry;
    const elapsed = finished
      ? now - (mergedTreeSidebar[sessionID]?.finishedAt ?? 0)
      : 0;
    const flashDot = finished && Math.floor(elapsed / 200) % 2 === 0;
    const indicator = running ? spinner : flashDot ? '·' : ' ';
    const desc = AGENT_SIDEBAR_DESCRIPTIONS[agentName] ?? agentName;
    const indicatorColor = theme.accent;
    const nameStr = formatAgentName(agentName);
    const descStr = truncate(desc, 10);

    agentRows.push(
      box(
        {
          width: '100%',
          flexDirection: 'row',
          justifyContent: 'space-between',
        },
        [
          box({ flexDirection: 'row' }, [
            text({ fg: indicatorColor }, [`${indicator} `]),
            text({ fg: theme.text }, [nameStr]),
            text({ fg: theme.accent }, [` x${count}`]),
          ]),
          box({ flexDirection: 'row' }, [text({ fg: theme.text }, [descStr])]),
        ],
      ),
    );

    const rawModel = mergedTreeSidebar[sessionID]?.model;
    const modelVariantLine = formatSidebarModelAndVariant(rawModel, variant);
    const statusText = getStatusText(snapshot, sessionID);

    agentRows.push(
      box(
        {
          width: '100%',
          flexDirection: 'row',
          justifyContent: 'space-between',
        },
        [
          text({ fg: theme.textMuted }, [
            modelVariantLine.length > 0 ? `  ${modelVariantLine}` : '  pending',
          ]),
          text(
            {
              fg: getStatusColor(statusText, theme),
            },
            [statusText],
          ),
        ],
      ),
    );
  }

  if (customSessions.length > 0) {
    agentRows.push(box({ width: '100%' }));

    const customGroups = new Map<string, SessionGroup>();
    for (const entry of customSessions) {
      const { sessionID, agentName, running, finished } = entry;
      const rawModel = mergedTreeSidebar[sessionID]?.model;
      const model = rawModel ? formatSidebarModelName(rawModel) : 'pending';
      const variant = mergedTreeSidebar[sessionID]?.variant;
      const key = `${agentName}\x00${model}\x00${variant ?? ''}`;

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
          variant,
        });
      }
    }

    for (const entry of customGroups.values()) {
      const { sessionID, agentName, running, finished, count, variant } = entry;
      const elapsed = finished
        ? now - (mergedTreeSidebar[sessionID]?.finishedAt ?? 0)
        : 0;
      const flashDot = finished && Math.floor(elapsed / 200) % 2 === 0;
      const indicator = running ? spinner : flashDot ? '·' : ' ';
      const nameStr = formatAgentName(agentName);
      const rawModelChild = mergedTreeSidebar[sessionID]?.model;
      const modelVariantLineCustom = formatSidebarModelAndVariant(
        rawModelChild,
        variant,
      );
      const customStatusText = getStatusText(snapshot, sessionID);

      agentRows.push(
        box(
          {
            width: '100%',
            flexDirection: 'row',
            justifyContent: 'space-between',
          },
          [
            box({ flexDirection: 'row' }, [
              text({ fg: theme.accent }, [`${indicator} `]),
              text({ fg: theme.text }, [nameStr]),
              text({ fg: theme.accent }, [` x${count}`]),
            ]),
          ],
        ),
      );

      agentRows.push(
        box(
          {
            width: '100%',
            flexDirection: 'row',
            justifyContent: 'space-between',
          },
          [
            text({ fg: theme.textMuted }, [
              modelVariantLineCustom.length > 0
                ? `  ${modelVariantLineCustom}`
                : '  pending',
            ]),
            text({ fg: getStatusColor(customStatusText, theme) }, [
              customStatusText,
            ]),
          ],
        ),
      );
    }
  }

  if (agentRows.length === 0) {
    agentRows.push(text({ fg: theme.textMuted }, ['No active agents']));
  }

  const orchestratingRows = buildOrchestratingRows(snapshot, now, theme);

  // Build usage panel rows
  const usageRows = renderSubscriptionPanel(snapshot, theme);

  return box(
    {
      width: '100%',
      flexDirection: 'column',
      border: BORDER,
      borderColor: theme.borderActive,
      paddingTop: 0,
      paddingBottom: 0,
      paddingLeft: 0,
      paddingRight: 0,
    },
    [
      box(
        {
          width: '100%',
          flexDirection: 'row',
          justifyContent: 'space-between',
        },
        [
          text({ fg: theme.accent }, ['opencode-dux']),
          (() => {
            const versionInfo = getPluginVersionInfo();
            if (!versionInfo.latest) {
              return text({ fg: theme.accent }, [`v${versionInfo.installed}`]);
            }
            if (versionInfo.isLatest) {
              return text({ fg: theme.accent }, [
                `v${versionInfo.installed} (latest)`,
              ]);
            }
            return box({ flexDirection: 'row' }, [
              text({ fg: '#E74C3C' }, [`v${versionInfo.installed}`]),
              text({ fg: '#F39C12' }, [` (→ v${versionInfo.latest})`]),
            ]);
          })(),
        ],
      ),
      box(
        {
          width: '100%',
          flexDirection: 'row',
          justifyContent: 'space-between',
        },
        [
          text({ fg: theme.text }, ['Agents']),
          text({ fg: theme.textMuted }, [`[${totalActive} active]`]),
        ],
      ),
      ...agentRows,
      ...(orchestratingRows.length > 0
        ? [
            box({ width: '100%', height: 1 }),
            box(
              {
                width: '100%',
                flexDirection: 'column',
                border: BORDER,
                borderColor: theme.borderActive,
                paddingTop: 0,
                paddingBottom: 0,
                paddingLeft: 0,
                paddingRight: 0,
              },
              [
                box(
                  {
                    width: '100%',
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                  },
                  [
                    text({ fg: theme.text }, ['Orchestrating']),
                    text({ fg: theme.textMuted }, [
                      `[${orchestratingRows[0] as string}]`,
                    ]),
                  ],
                ),
                ...(orchestratingRows.slice(1) as Child[]),
              ],
            ),
          ]
        : []),
      ...(usageRows.length > 0
        ? [
            box({ width: '100%', height: 1 }),
            box(
              {
                width: '100%',
                flexDirection: 'column',
                border: BORDER,
                borderColor: theme.borderActive,
                paddingTop: 0,
                paddingBottom: 0,
                paddingLeft: 0,
                paddingRight: 0,
              },
              [
                box(
                  {
                    width: '100%',
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                  },
                  [text({ fg: theme.text }, ['API Usage'])],
                ),
                ...(usageRows as Child[]),
              ],
            ),
          ]
        : []),
    ],
  );
}

const plugin: TuiPluginModule & { id: string } = {
  id: `${PLUGIN_NAME}:tui`,
  tui: async (api, _options, _meta) => {
    const [snapshot, setSnapshot] = createSignal(readTuiSnapshot());
    const [tick, setTick] = createSignal(0);

    const dataTimer = setInterval(async () => {
      try {
        setSnapshot(await readTuiSnapshotAsync());
      } catch {
        // Ignore render errors; this is best-effort live status.
      }
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
          try {
            return renderSidebar(snapshot(), api.theme.current);
          } catch (_e) {
            // Return a minimal fallback box so the sidebar is never blank
            return box(
              {
                width: '100%',
                flexDirection: 'column',
                border: BORDER,
                borderColor: api.theme.current.borderActive,
              },
              [
                text({ fg: api.theme.current.accent }, ['opencode-dux']),
                text({ fg: '#E74C3C' }, ['⚠️ Render error - check plugin logs']),
              ],
            );
          }
        },
      },
    });
  },
};

export default plugin;
