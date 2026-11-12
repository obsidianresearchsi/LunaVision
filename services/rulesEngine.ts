import { dispatchOperationalAlert } from './liveAlertBus';
import { WEAPON_CLASSES } from './videoIntelligence';

export interface AgencyRuleRecord {
  id: string;
  workspace_id?: string;
  name: string;
  object_label: string;
  minimum_confidence: number;
  severity: 'low' | 'medium' | 'high';
  enabled: boolean;
  cooldown_seconds: number;
  revision?: number;
  created_at?: string;
}

export interface RuleUseCaseInfo {
  title: string;
  useCase: string;
  response: string;
}

export const AI_RULE_USE_CASES: Record<string, RuleUseCaseInfo> = {
  car: {
    title: 'Vehicle / Sedan Gate & Perimeter Watch',
    useCase: 'Monitors gates, checkpoints, and restricted lanes for incoming cars/sedans to trigger traffic logging and ANPR watchlist checks.',
    response: 'Logs vehicle event, triggers popup + high/medium alert if confidence exceeds threshold.',
  },
  truck: {
    title: 'Heavy Truck / Freight & Convoy Alert',
    useCase: 'Detects heavy trucks or utility vans approaching loading bays, bridges, or restricted perimeter checkpoints.',
    response: 'Alerts security desk and snapshots approaching freight vehicle.',
  },
  bus: {
    title: 'Transit Bus / Mass Arrival Alert',
    useCase: 'Flags buses arriving at terminals or protected compounds to prepare crowd and screening units.',
    response: 'Logs transit vehicle telemetry and raises configured alert.',
  },
  motorcycle: {
    title: 'Motorcycle / Rapid Approach Watch',
    useCase: 'Detects motorcycles/okada entering pedestrian zones, high-security lanes, or after-hours patrol corridors.',
    response: 'Fires rapid perimeter alert popup for checkpoint officers.',
  },
  bicycle: {
    title: 'Bicycle / Yard Access Monitor',
    useCase: 'Tracks non-motorized entry across perimeter boundaries or restricted warehouse corridors.',
    response: 'Records entry observation and notifies shift staff.',
  },
  backpack: {
    title: 'Suspicious / Unattended Backpack Rule',
    useCase: 'Critical counter-IED / package screening: flags backpacks detected near lobbies, concourses, and VIP zones.',
    response: 'Triggers popup alert with frame snapshot for security inspection.',
  },
  suitcase: {
    title: 'Unattended Suitcase / Luggage Rule',
    useCase: 'Airport, rail, and facility lobby protection against abandoned or suspicious suitcases.',
    response: 'Fires alert notification and tags frame for EOD / security sweep.',
  },
  knife: {
    title: 'Weapon / Blade Threat Detection',
    useCase: 'Detects exposed knives or bladed threats on live feeds or uploaded footage.',
    response: 'Immediate CRITICAL popup alert and persistent high-priority alert log.',
  },
  'fire hydrant': {
    title: 'Safety Access / Fire Lane Obstruction Check',
    useCase: 'Identifies fire equipment zones to correlate nearby parked vehicles or blocked emergency access.',
    response: 'Logs safety zone status for facility compliance review.',
  },
};

export interface RuleTemplatePreset {
  id: string;
  name: string;
  objectLabel: string;
  confidencePct: number;
  severity: 'low' | 'medium' | 'high';
  cooldownSeconds: number;
  useCase: string;
}

export const AI_RULE_TEMPLATES: RuleTemplatePreset[] = [
  {
    id: 'tpl-car-checkpoint',
    name: 'Checkpoint Vehicle Entry Monitor',
    objectLabel: 'car',
    confidencePct: 72,
    severity: 'medium',
    cooldownSeconds: 45,
    useCase: 'Alerts security whenever a passenger car passes a guarded checkpoint so ANPR & gate logs verify authorization.',
  },
  {
    id: 'tpl-truck-afterhours',
    name: 'Heavy Truck Restricted Access Alert',
    objectLabel: 'truck',
    confidencePct: 75,
    severity: 'high',
    cooldownSeconds: 60,
    useCase: 'Immediately notifies command whenever heavy trucks enter restricted yards or perimeter roads.',
  },
  {
    id: 'tpl-moto-patrol',
    name: 'Motorcycle Rapid Approach Alert',
    objectLabel: 'motorcycle',
    confidencePct: 70,
    severity: 'high',
    cooldownSeconds: 45,
    useCase: 'Flags motorcycles entering pedestrianized zones, bank perimeters, or sensitive checkpoints.',
  },
  {
    id: 'tpl-backpack-threat',
    name: 'Suspicious Backpack / Package Alert',
    objectLabel: 'backpack',
    confidencePct: 70,
    severity: 'high',
    cooldownSeconds: 60,
    useCase: 'Triggers security alert when backpacks appear near checkpoints, lobbies, or restricted gates.',
  },
  {
    id: 'tpl-suitcase-terminal',
    name: 'Luggage / Suitcase Terminal Screening',
    objectLabel: 'suitcase',
    confidencePct: 70,
    severity: 'high',
    cooldownSeconds: 60,
    useCase: 'Flags suitcases in protected terminal corridors for unattended-baggage triage.',
  },
];

export function describeRuleUseCase(objectLabel: string): RuleUseCaseInfo {
  const key = objectLabel.trim().toLowerCase();
  if (AI_RULE_USE_CASES[key]) return AI_RULE_USE_CASES[key];
  return {
    title: `${objectLabel} Object Rule`,
    useCase: `Monitors live cameras and video analysis for "${objectLabel}" detections above the confidence threshold.`,
    response: 'Creates a persistent workspace alert and displays a live operator popup.',
  };
}

const ruleCooldownMap = new Map<string, number>();

export async function evaluateRulesAgainstDetections(opts: {
  workspaceId: string;
  rules: AgencyRuleRecord[];
  detections: { class: string; score: number }[];
  cameraId?: string | null;
  cameraName?: string;
  snapshotUrl?: string;
}): Promise<AgencyRuleRecord[]> {
  const { workspaceId, rules, detections, cameraId, cameraName, snapshotUrl } = opts;
  if (!rules.length || !detections.length) return [];

  const now = Date.now();
  const fired: AgencyRuleRecord[] = [];

  for (const rule of rules) {
    if (!rule.enabled) continue;
    const target = rule.object_label.trim().toLowerCase();
    const match = detections.find((d) => {
      const cls = d.class.trim().toLowerCase();
      const labelMatches = cls === target || (target === 'knife' && WEAPON_CLASSES.has(cls));
      return labelMatches && d.score >= rule.minimum_confidence;
    });
    if (!match) continue;

    const cooldownKey = `${workspaceId}:${rule.id}:${cameraId || 'file'}`;
    const lastFired = ruleCooldownMap.get(cooldownKey) ?? 0;
    const cooldownMs = Math.max(15, rule.cooldown_seconds || 60) * 1000;
    if (now - lastFired < cooldownMs) continue;

    ruleCooldownMap.set(cooldownKey, now);
    fired.push(rule);

    const pct = Math.round(match.score * 100);
    const info = describeRuleUseCase(rule.object_label);
    await dispatchOperationalAlert({
      workspaceId,
      kind: WEAPON_CLASSES.has(match.class.toLowerCase()) ? 'weapon' : 'rule_trigger',
      title: `AI Rule: ${rule.name} (${match.class} ${pct}%)`,
      details: `${info.useCase} Detected ${match.class} at ${pct}% confidence (threshold ${Math.round(rule.minimum_confidence * 100)}%).`,
      severity: rule.severity,
      cameraId: cameraId ?? null,
      cameraName: cameraName || 'Video intelligence stream',
      confidence: pct,
      recommendedAction: info.response,
      snapshotUrl,
      dedupeKey: `rule:${workspaceId}:${rule.id}`,
    });
  }

  return fired;
}

