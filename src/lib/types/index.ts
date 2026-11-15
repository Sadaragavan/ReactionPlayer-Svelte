/* Shared TypeScript contracts for Reaction Player (SvelteKit + Supabase) */

/* ───────────────────────────── primitives ───────────────────────────── */

export type ID = string;
export type Tier = 'free' | 'pro';

export type LayoutType = 'split' | 'grid' | 'pip' | 'custom';
export type CanvasAspect = 'fill' | '16:9' | '9:16' | '4:3' | '1:1' | '21:9';
export type MediaKind = 'file' | 'url';
export type VideoRole = 'source' | 'reaction' | 'extra';
export type FitMode = 'contain' | 'cover';
export type AspectLock = 'auto' | 'free' | '16:9' | '4:3' | '1:1' | '9:16' | '21:9';
export type PassType = 'free' | 'pro' | 'bonus' | 'trial' | 'gift';

/* ───────────────────────────── geometry ───────────────────────────── */

export interface Crop {
  t: number;
  r: number;
  b: number;
  l: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayerTransform extends Rect {
  crop: Crop;
  opacity: number;
  fit: FitMode;
  aspect: AspectLock;
}

/* ───────────────────────────── sessions & videos ───────────────────────────── */

export interface SessionVideo {
  id: ID;
  role: VideoRole;
  title: string;
  kind: MediaKind;
  url: string;
  fileName?: string;
  fileSize?: number;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
  playbackRate: number;
  /** Shift relative to master clock: local = master + offsetMs / 1000 */
  offsetMs: number;
  audioTrack?: number;
}

export interface Alignment {
  layoutType: LayoutType;
  locked: boolean;
  coordinates: Record<ID, LayerTransform>;
  base?: LayerTransform[];
}

export interface Session {
  id: ID;
  name: string;
  createdAt: number;
  lastModified: number;
  updatedAt: number;
  videos: SessionVideo[];
  alignment: Alignment;
  canvasAspect: CanvasAspect;
  isLinked: boolean;
  isTheaterMode: boolean;
  masterId: ID;
  clock?: number;
  thumbnail?: string;
  presetId?: ID;
  syncedAt?: number;
}

/* ───────────────────────────── passes & entitlements ───────────────────────────── */

export interface SessionPass {
  id: ID;
  userId: ID;
  reactionIdentity: string;
  sourceIdentity: string;
  passType: PassType;
  issuedAt: number;
  expiresAt: number;
  consumedAt?: number;
  idempotencyKey: string;
}

export interface EntitlementGrant {
  id: ID;
  userId: ID;
  tier: Tier;
  source: 'stripe' | 'trial' | 'gift' | 'reward' | 'admin';
  referenceId?: string;
  startsAt: number;
  endsAt?: number;
  createdAt: number;
}

export interface TierLimits {
  maxVideos: number;
  maxCustomPresets: number;
  cloudSync: boolean;
  advancedSampler: boolean;
  maxResolution: number;
}

export interface AppEntitlements {
  tier: Tier;
  isPro: boolean;
  limits: TierLimits;
  trialAvailable: boolean;
  trialUsed: boolean;
}

/* ───────────────────────────── sync profiles ───────────────────────────── */

export interface SyncProfile {
  id: ID;
  reactionIdentity: string;
  sourceIdentity: string;
  sourceVersion?: string;
  offsetMs: number;
  confidence: 'manual' | 'verified' | 'crowd';
  createdBy?: ID;
  createdAt: number;
  updatedAt: number;
}

/* ───────────────────────────── consent & auth ───────────────────────────── */

export interface ConsentRecord {
  id: ID;
  userId: ID;
  consentType: string;
  version: string;
  granted: boolean;
  grantedAt: number;
  revokedAt?: number;
}

export interface StaffRole {
  id: ID;
  userId: ID;
  role: 'support' | 'moderator' | 'admin' | 'owner';
  grantedAt: number;
  revokedAt?: number;
}

/* ───────────────────────────── tier constants ───────────────────────────── */

export const TIER_LIMITS: Record<Tier, TierLimits> = {
  free: { maxVideos: 2, maxCustomPresets: 3, cloudSync: false, advancedSampler: false, maxResolution: 1080 },
  pro: { maxVideos: 4, maxCustomPresets: Number.POSITIVE_INFINITY, cloudSync: true, advancedSampler: true, maxResolution: 2160 }
};

export const OFFSET_STEPS = [-100, -10, -1, 1, 10, 100] as const;
export const FALLBACK_FPS = 30;
export const HARD_SEEK_THRESHOLD_S = 0.35;
export const MIN_LAYER_SIZE = 0.08;
export const SNAP_DISTANCE = 0.008;

export const FREE_PASSES_PER_24H = 6;
export const BONUS_PASSES_PER_24H = 2;
export const TAGS_FOR_BONUS = 4;
export const TRIAL_DAYS = 7;
export const SURPRISE_DROP_DAYS = 3;
export const SURPRISE_DROP_COOLDOWN_DAYS = 60;
