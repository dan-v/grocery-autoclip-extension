// ABOUTME: TypeScript type definitions for the coupon clipping extension
// ABOUTME: Defines interfaces, enums, and types used throughout the application

export interface CouponOffer {
  id: string;
  title: string;
  program: string;
  type?: string;
  brand?: string;
  categories: string[];
  categoryType?: string;
  primaryCategoryNM?: string;
  offerPrice?: string;
  savingsAmount?: string;
  discountAmount?: string;
  minimumPurchaseAmount?: string;
  imageId?: string;
  imageUrl?: string;
  largeImageUrl?: string;
  smallImageUrl?: string;
  displayImageUrl?: string;
  validTo?: string;
  offerEndDate?: string;
  displayStartDate?: string;
  displayEndDate?: string;
  offerStartDate?: string;
  clipStartDate?: string;
  shutoffDate?: string;
  status?: string;
  usageType?: string;
  deleted?: boolean;
  isClippable?: boolean;
  isDisplayable?: boolean;
  description?: string;
  forUDescription?: string;
  ecomDescription?: string;
  details?: string;
  purchaseRequirements?: string;
  qualifyingItems?: string[];
  excludedItems?: string[];
  limitPerHousehold?: string;
  maxRedemptions?: string;
  clipId?: string;
  clipTs?: string;
  offerProtoType?: string;
  offerProgramType?: string;
  rewardType?: string;
  upcList?: string[];
  storeIds?: string[];
  banners?: string[];
  regions?: string[];
  hierarchies?: Record<string, any>;
  extendedAttributes?: Record<string, any>;
  retrievedAt?: string;
  originalOffer?: any;
  primaryCategory?: string;
  isExpiringSoon?: boolean;
  isExpired?: boolean;
  isDisplayPeriodEnded?: boolean;
}

export interface ClippedCoupon extends CouponOffer {
  clippedDate: string;
  status: 'clipped';
}

export interface SkippedCoupon extends CouponOffer {
  skippedDate: string;
  skipReason: string;
  skipMessage: string;
  status: 'skipped';
}

export interface ClippingStats {
  total: number;
  processed: number;
  clipped?: number;
  alreadyClipped?: number;
  skipped?: number;
  failed?: number;
}

export interface ClippingState {
  isActive: boolean;
  currentStats: ClippingStats;
  startTime: number | null;
  lastActivity: number | null;
}

export interface ClippingSession {
  id: string;
  date: string;
  stats: ClippingStats;
  duration: number;
}

export interface UserPreferences {
  clippingDelay: number;
  maxConcurrentClips: number;
}

export interface StorageData {
  userPreferences?: UserPreferences;
  clippedCoupons?: ClippedCoupon[];
  skippedCoupons?: SkippedCoupon[];
  clippingStats?: ClippingStats;
  clippingState?: ClippingState;
  clippingSessions?: ClippingSession[];
  lastSync?: string;
  lastRefreshTime?: number;
  availableCoupons?: number;
  lastClippingStart?: string;
  lastClippingSession?: ClippingSession;
}

export interface ClipOfferResponse {
  success: boolean;
  wasAlreadyClipped?: boolean;
  wasSkipped?: boolean;
  reason?: string;
  errorMsg?: string;
  error?: string;
  clipId?: string;
  clipTs?: string;
  detailedOffer?: any;
}

export interface MessageRequest {
  action: string;
  [key: string]: any;
}

export interface MessageResponse {
  success: boolean;
  [key: string]: any;
}

export interface AuthHeaders {
  headers: Record<string, string>;
  storeId: string;
}

export enum SkipReason {
  EXPIRED_OR_INACTIVE = 'expired_or_inactive',
  NOT_AVAILABLE_IN_STORE = 'not_available_in_store',
  NOT_ELIGIBLE = 'not_eligible',
  DISPLAY_PERIOD_ENDED = 'display_period_ended',
  LIMIT_EXCEEDED = 'limit_exceeded',
  UNKNOWN = 'unknown',
  UNKNOWN_WITH_CLIPID = 'unknown_with_clipid',
  UNEXPECTED_RESPONSE = 'unexpected_response',
  CANNOT_CLIP = 'cannot_clip'
}

export enum CouponStatus {
  CLIPPED = 'C',
  AVAILABLE = 'A',
  EXPIRED = 'E'
}

export enum OfferProgram {
  J4U = 'J4U',
  PD = 'PD', 
  MF = 'MF',
  SC = 'SC',
  DG = 'DG',
  PC = 'PC'
}