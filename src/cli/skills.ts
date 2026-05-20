import type { PluginInput } from '@opencode-ai/plugin';
import type { SkillOrMcpConfig } from '../config';
import { getLocalDiscovery } from '../discovery/local';

export interface NormalizedSkillConfig {
  alwaysLoad: string[];
  wildcard: boolean;
  excluded: string[];
}

export function normalizeSkillConfig(
  raw: SkillOrMcpConfig | undefined,
): NormalizedSkillConfig {
  if (!raw) {
    return { alwaysLoad: [], wildcard: false, excluded: [] };
  }

  if (Array.isArray(raw)) {
    const alwaysLoad: string[] = [];
    const excluded: string[] = [];
    let wildcard = false;

    for (const item of raw) {
      if (item === '*') {
        wildcard = true;
      } else if (item.startsWith('!')) {
        excluded.push(item.slice(1));
      } else {
        alwaysLoad.push(item);
      }
    }

    return { alwaysLoad, wildcard, excluded };
  }

  // Object syntax - read always-load first, fall back to deprecated mandatory
  return {
    alwaysLoad: raw['always-load'] ?? raw.mandatory ?? [],
    wildcard: raw.wildcard ?? false,
    excluded: [],
  };
}

/**
 * Get permission presets for a specific agent based on recommended skills.
 * @param agentName - The name of the agent
 * @param skillList - Optional explicit list of skills to allow (overrides recommendations)
 * @param ctx - Plugin input context for SDK discovery when wildcard=true
 * @returns Permission rules for the skill permission type
 */
export async function getSkillPermissionsForAgent(
  _agentName: string,
  skillList?: SkillOrMcpConfig,
  ctx?: PluginInput,
): Promise<Record<string, 'allow' | 'ask' | 'deny'>> {
  const permissions: Record<string, 'allow' | 'ask' | 'deny'> = {
    '*': 'deny', // Default: deny all
  };

  if (skillList !== undefined) {
    const normalized = normalizeSkillConfig(skillList);
    permissions['*'] = normalized.wildcard ? 'allow' : 'deny';

    // Always-load skills always allowed
    for (const name of normalized.alwaysLoad) {
      permissions[name] = 'allow';
    }
    for (const name of normalized.excluded) {
      permissions[name] = 'deny';
    }

    // Wildcard: allow all installed skills (from SDK)
    if (normalized.wildcard && ctx) {
      try {
        const local = await getLocalDiscovery(ctx);
        for (const skill of local.skills) {
          permissions[skill.name] = 'allow';
        }
      } catch {
        // wildcard with no SDK access = only always-load
      }
    }

    return permissions;
  }

  // No config provided - fallback to deny all
  return permissions;
}

/**
 * Scan installed skills from the filesystem via SDK discovery.
 * @param ctx - Plugin input context for SDK discovery
 * @returns Array of skill names that are installed
 */
export async function scanInstalledSkills(ctx: PluginInput): Promise<string[]> {
  try {
    const local = await getLocalDiscovery(ctx);
    return local.skills.map((skill) => skill.name);
  } catch {
    return [];
  }
}
