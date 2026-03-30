export type InterventionArm =
  | "add_vendor_rtbhouse"
  | "add_vendor_seedtag"
  | "add_vendor_medianet"
  | "add_missing_ad_units"
  | "remap_config"
  | "remove_weak_vendor"
  | "do_nothing";

export type BanditContext = {
  segment: string;
};

export type SiteBanditFeatures = {
  riskScore: number;
  opportunityScore: number;
  coverageScore: number;
  vendorCount: number;
  inventoryGap: number;
  hasConfig: boolean;
  configHealthErrors: number;
  configHealthWarnings: number;
};

export type BanditRewardMap = Partial<Record<InterventionArm, number>>;

type Posterior = {
  alpha: number;
  beta: number;
  pulls: number;
};

type BanditState = {
  arms: InterventionArm[];
  discount: number;
  learnRate: number;
  posteriors: Record<string, Posterior>;
};

export type ThompsonRecommendation = {
  arm: InterventionArm;
  score: number;
  posteriorMean: number;
  confidence: number;
  segment: string;
  reason: string;
};

function clamp01(value: number): number {
  return Math.max(0.001, Math.min(0.999, value));
}

function keyFor(arm: InterventionArm, segment: string): string {
  return `${arm}__${segment}`;
}

function defaultPosterior(alpha = 2, beta = 2): Posterior {
  return { alpha, beta, pulls: 0 };
}

function getDefaultState(): BanditState {
  return {
    arms: [
      "add_vendor_rtbhouse",
      "add_vendor_seedtag",
      "add_vendor_medianet",
      "add_missing_ad_units",
      "remap_config",
      "remove_weak_vendor",
      "do_nothing",
    ],
    discount: 0.985,
    learnRate: 0.65,
    posteriors: {},
  };
}

export function loadBanditState(storageKey = "reviq_bandit_ts_v3"): BanditState {
  if (typeof window === "undefined") {
    return getDefaultState();
  }

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return getDefaultState();

    const parsed = JSON.parse(raw) as Partial<BanditState>;

    return {
      ...getDefaultState(),
      ...parsed,
      posteriors: parsed.posteriors ?? {},
    };
  } catch {
    return getDefaultState();
  }
}

export function saveBanditState(
  state: BanditState,
  storageKey = "reviq_bandit_ts_v3"
): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    // ignore
  }
}

export function getInterventionLabel(arm: InterventionArm): string {
  switch (arm) {
    case "add_vendor_rtbhouse":
      return "Add vendor: RTBHouse";
    case "add_vendor_seedtag":
      return "Add vendor: Seedtag";
    case "add_vendor_medianet":
      return "Add vendor: Medianet";
    case "add_missing_ad_units":
      return "Add missing ad units";
    case "remap_config":
      return "Remap config";
    case "remove_weak_vendor":
      return "Remove weakest vendor";
    case "do_nothing":
      return "Do nothing";
    default:
      return arm;
  }
}

export function getActionFamily(arm: InterventionArm): string {
  if (arm.startsWith("add_vendor")) return "vendor_expansion";
  if (arm === "add_missing_ad_units") return "inventory_repair";
  if (arm === "remap_config") return "config_alignment";
  if (arm === "remove_weak_vendor") return "stack_simplification";
  return "hold";
}

export function makeSiteBanditSegment(params: {
  riskScore: number;
  opportunityScore: number;
  coverageScore: number;
  vendorCount: number;
  inventoryGap: number;
}): string {
  const riskBucket = Math.min(4, Math.floor(params.riskScore / 20));
  const oppBucket = Math.min(4, Math.floor(params.opportunityScore / 20));
  const covBucket = Math.min(4, Math.floor(params.coverageScore / 20));
  const vendorBucket = Math.min(4, Math.floor(params.vendorCount / 2));
  const gapBucket =
    params.inventoryGap < 0
      ? `m${Math.min(4, Math.abs(params.inventoryGap))}`
      : params.inventoryGap > 0
        ? `p${Math.min(4, params.inventoryGap)}`
        : "z0";

  return `r${riskBucket}_o${oppBucket}_c${covBucket}_v${vendorBucket}_g${gapBucket}`;
}

function ensurePosterior(
  state: BanditState,
  arm: InterventionArm,
  segment: string
): Posterior {
  const key = keyFor(arm, segment);

  if (!state.posteriors[key]) {
    state.posteriors[key] = defaultPosterior();
  }

  return state.posteriors[key];
}

function decayPosterior(p: Posterior, discount: number): void {
  p.alpha = Math.max(0.25, p.alpha * discount);
  p.beta = Math.max(0.25, p.beta * discount);
  p.pulls = Math.max(0, p.pulls * discount);
}

function posteriorMean(p: Posterior): number {
  return p.alpha / (p.alpha + p.beta);
}

function posteriorConfidence(p: Posterior): number {
  const total = p.alpha + p.beta;
  return Math.max(0, Math.min(1, total / 18));
}

function sampleNormal(): number {
  let u = 0;
  let v = 0;

  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();

  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function sampleGamma(shape: number): number {
  if (shape < 1) {
    const u = Math.random();
    return sampleGamma(1 + shape) * Math.pow(u, 1 / shape);
  }

  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);

  while (true) {
    const x = sampleNormal();
    const v = Math.pow(1 + c * x, 3);

    if (v <= 0) continue;

    const u = Math.random();

    if (u < 1 - 0.0331 * Math.pow(x, 4)) {
      return d * v;
    }

    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) {
      return d * v;
    }
  }
}

function sampleBeta(alpha: number, beta: number): number {
  const x = sampleGamma(alpha);
  const y = sampleGamma(beta);
  return x / (x + y);
}

export function syncBanditWithSimulator(
  state: BanditState,
  ctx: BanditContext,
  rewardMap: BanditRewardMap
): void {
  for (const arm of state.arms) {
    const posterior = ensurePosterior(state, arm, ctx.segment);
    decayPosterior(posterior, state.discount);

    const reward = clamp01(rewardMap[arm] ?? 0.5);

    posterior.alpha += reward * state.learnRate;
    posterior.beta += (1 - reward) * state.learnRate;
    posterior.pulls += state.learnRate;
  }
}

export function recommendThompsonArm(
  state: BanditState,
  ctx: BanditContext,
  rewardMap: BanditRewardMap
): ThompsonRecommendation {
  let bestArm: InterventionArm = "do_nothing";
  let bestScore = -Infinity;
  let bestMean = 0;
  let bestConfidence = 0;

  for (const arm of state.arms) {
    const posterior = ensurePosterior(state, arm, ctx.segment);
    const sampled = sampleBeta(posterior.alpha, posterior.beta);
    const mean = posteriorMean(posterior);
    const simulatorReward = clamp01(rewardMap[arm] ?? 0.5);

    const score = sampled * 0.72 + simulatorReward * 0.28;
    const confidence = posteriorConfidence(posterior);

    if (score > bestScore) {
      bestScore = score;
      bestArm = arm;
      bestMean = mean;
      bestConfidence = confidence;
    }
  }

  return {
    arm: bestArm,
    score: bestScore,
    posteriorMean: bestMean,
    confidence: bestConfidence,
    segment: ctx.segment,
    reason: "Thompson sampling synchronized to simulator-based rewards",
  };
}