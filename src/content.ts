// ABOUTME: Content script that runs on Safeway pages to fetch and clip coupons
// ABOUTME: Handles authentication, API requests, and communicates with background script

import {
  CouponOffer,
  ClipOfferResponse,
  MessageRequest,
  MessageResponse,
  AuthHeaders,
  SkipReason,
  CouponStatus,
  OfferProgram
} from './types.js';
import { getDisplayImageUrl, isOfferExpiringSoon, isOfferExpired, isDisplayPeriodEnded } from './utils.js';

interface Config {
  RATE_LIMIT_MS: number;
  API_BASE: string;
  MAX_RETRIES: number;
  RETRY_DELAY: number;
}

const CONFIG: Config = {
  RATE_LIMIT_MS: 1000,
  API_BASE: 'https://www.safeway.com/abs/pub',
  MAX_RETRIES: 3,
  RETRY_DELAY: 2000
};

let lastApiCall = 0;

async function rateLimit(): Promise<void> {
  const now = Date.now();
  const timeSinceLastCall = now - lastApiCall;
  if (timeSinceLastCall < CONFIG.RATE_LIMIT_MS) {
    const waitTime = CONFIG.RATE_LIMIT_MS - timeSinceLastCall;
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }
  lastApiCall = Date.now();
}

function getAuthHeaders(): AuthHeaders | null {
  const cookies: Record<string, string> = {};
  document.cookie.split(';').forEach(cookie => {
    const [name, value] = cookie.trim().split('=');
    if (name && value) {
      cookies[name] = decodeURIComponent(value);
    }
  });

  let accessToken: string | null = null;
  let storeId: string | null = null;

  if (cookies.SWY_SHARED_PII_SESSION_INFO) {
    try {
      const piiData = JSON.parse(cookies.SWY_SHARED_PII_SESSION_INFO);
      accessToken = piiData.jti;
    } catch (e) {
      console.warn('PII cookie parsing error:', e);
    }
  }

  if (cookies.SWY_SHARED_SESSION_INFO) {
    try {
      const sessionInfo = JSON.parse(cookies.SWY_SHARED_SESSION_INFO);
      if (sessionInfo.info?.COMMON?.storeId) {
        storeId = sessionInfo.info.COMMON.storeId;
      } else if (sessionInfo.info?.J4U?.storeId) {
        storeId = sessionInfo.info.J4U.storeId;
      } else if (sessionInfo.info?.SHOP?.storeId) {
        storeId = sessionInfo.info.SHOP.storeId;
      }
    } catch (e) {
      console.warn('Session cookie parsing error:', e);
    }
  }

  if (!accessToken || !storeId) {
    return null;
  }

  const headers: Record<string, string> = {
    'swy_sso_token': accessToken,
    'x-swyconsumerdirectorypro': accessToken,
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/plain, */*',
    'x-swy_api_key': 'emjou',
    'x-swy_banner': 'safeway',
    'x-swy_version': '1.1',
    'Origin': 'https://www.safeway.com',
    'Referer': window.location.href
  };

  return { headers, storeId };
}


async function fetchAllOffers(): Promise<CouponOffer[]> {
  const authInfo = getAuthHeaders();
  if (!authInfo) {
    throw new Error('No authentication available');
  }

  await rateLimit();
  
  const url = `${CONFIG.API_BASE}/xapi/offers/companiongalleryoffer?storeId=${authInfo.storeId}&rand=${Math.floor(Math.random() * 1000000)}`;
  
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: authInfo.headers,
      credentials: 'include'
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const data = await response.json();

    let offers: any[] = [];
    if (data.companionGalleryOffer) {
      if (Array.isArray(data.companionGalleryOffer)) {
        offers = data.companionGalleryOffer;
      } else if (typeof data.companionGalleryOffer === 'object') {
        offers = Object.values(data.companionGalleryOffer);
      }
    }
    
    const clippableOffers = offers.filter(offer => {
      return [OfferProgram.J4U, OfferProgram.PD, OfferProgram.MF, OfferProgram.SC].includes(offer.offerPgm);
    });
    
    const processedOffers: CouponOffer[] = clippableOffers.map(offer => {
      return {
        id: offer.offerId,
        title: offer.name || offer.description || 'Unknown offer',
        program: offer.offerPgm,
        type: offer.offerSubType,
        brand: offer.brand || '',
        categories: offer.category ? [offer.category] : [],
        categoryType: offer.categoryType || '',
        primaryCategoryNM: offer.primaryCategoryNM || '',
        offerPrice: offer.offerPrice || '',
        savingsAmount: offer.savingsAmount || '',
        discountAmount: offer.discountAmount || '',
        minimumPurchaseAmount: offer.minimumPurchaseAmount || '',
        imageId: offer.imageId || '',
        imageUrl: offer.imageUrl || '',
        largeImageUrl: offer.largeImageUrl || '',
        smallImageUrl: offer.smallImageUrl || '',
        displayImageUrl: getDisplayImageUrl(offer) || '',
        validTo: offer.validTo || offer.offerEndDate || '',
        offerEndDate: offer.offerEndDate || '',
        displayStartDate: offer.displayStartDate || '',
        displayEndDate: offer.displayEndDate || '',
        offerStartDate: offer.offerStartDate || '',
        clipStartDate: offer.clipStartDate || '',
        shutoffDate: offer.shutoffDate || '',
        status: offer.status || '',
        usageType: offer.usageType || '',
        deleted: offer.deleted || false,
        isClippable: offer.isClippable !== false,
        isDisplayable: offer.isDisplayable !== false,
        description: offer.description || '',
        forUDescription: offer.forUDescription || '',
        ecomDescription: offer.ecomDescription || '',
        details: offer.details || '',
        purchaseRequirements: offer.purchaseRequirements || '',
        qualifyingItems: offer.qualifyingItems || [],
        excludedItems: offer.excludedItems || [],
        limitPerHousehold: offer.limitPerHousehold || '',
        maxRedemptions: offer.maxRedemptions || '',
        clipId: offer.clipId || '',
        clipTs: offer.clipTs || '',
        offerProtoType: offer.offerProtoType || '',
        offerProgramType: offer.offerProgramType || '',
        rewardType: offer.rewardType || '',
        upcList: offer.upcList || [],
        storeIds: offer.storeIds || [],
        banners: offer.banners || [],
        regions: offer.regions || [],
        hierarchies: offer.hierarchies || {},
        extendedAttributes: offer.extendedAttributes || {},
        retrievedAt: new Date().toISOString(),
        originalOffer: offer
      };
    });

    return processedOffers;

  } catch (error) {
    let errorMsg = 'Failed to load coupons';
    if (error instanceof Error) {
      if (error.message.includes('Failed to fetch')) {
        errorMsg += ' (network error)';
      } else if (error.message.includes('401') || error.message.includes('403')) {
        errorMsg += ' (please refresh page)';
      }
    }
    throw new Error(errorMsg);
  }
}

function isOfferAlreadyClipped(offer: CouponOffer): boolean {
  const originalOffer = offer.originalOffer || offer;
  return originalOffer.status === CouponStatus.CLIPPED && originalOffer.clipId && originalOffer.clipTs;
}

async function clipOffer(offer: CouponOffer): Promise<ClipOfferResponse> {
  // check if coupon is already clipped before making API call
  if (isOfferAlreadyClipped(offer)) {
    return { 
      success: true, 
      wasAlreadyClipped: true,
      clipId: offer.originalOffer?.clipId || offer.clipId,
      clipTs: offer.originalOffer?.clipTs || offer.clipTs
    };
  }

  const authInfo = getAuthHeaders();
  if (!authInfo) {
    return { success: false, error: 'No authentication' };
  }

  // only rate limit when we're actually making an API call
  await rateLimit();
  
  let itemType = offer.program || OfferProgram.PD;
  if (offer.program === OfferProgram.J4U) itemType = OfferProgram.PD;

  const url = `${CONFIG.API_BASE}/web/j4u/api/offers/clip?storeId=${authInfo.storeId}`;
  const payload = {
    items: [
      { clipType: "C", itemId: offer.id, itemType: itemType },
      { clipType: "L", itemId: offer.id, itemType: itemType }
    ]
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: authInfo.headers,
      body: JSON.stringify(payload),
      credentials: 'include'
    });
    
    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }
    
    const result = await response.json();

    if (result.items && result.items.length > 0) {
      const item = result.items[0];
      
      if (item.status === 1 && item.clipId) {
        return { success: true, wasAlreadyClipped: false };
      } else if (item.status === 0 && item.clipId && item.errorMsg?.includes('already clipped')) {
        return { success: true, wasAlreadyClipped: true };
      } else if (item.errorMsg?.includes('not yet active') || item.errorMsg?.includes('past expiry') || item.errorMsg?.includes('shutoff date')) {
        return { success: true, wasSkipped: true, reason: SkipReason.EXPIRED_OR_INACTIVE, errorMsg: item.errorMsg };
      } else if (item.status === 0 && !item.clipId) {
        // status 0 without clipId usually means it can't be clipped for some reason
        let reason = SkipReason.CANNOT_CLIP;
        if (item.errorMsg?.includes('region') || item.errorMsg?.includes('store')) {
          reason = SkipReason.NOT_AVAILABLE_IN_STORE;
        } else if (item.errorMsg?.includes('limit') || item.errorMsg?.includes('maximum')) {
          reason = SkipReason.LIMIT_EXCEEDED;
        } else if (item.errorMsg?.includes('qualify') || item.errorMsg?.includes('eligible')) {
          reason = SkipReason.NOT_ELIGIBLE;
        } else if (item.errorMsg?.includes('display') || item.errorMsg?.includes('promotional period')) {
          reason = SkipReason.DISPLAY_PERIOD_ENDED;
        }
        return { success: true, wasSkipped: true, reason: reason, errorMsg: item.errorMsg };
      } else if (item.status === 0 && item.clipId) {
        // status 0 but has clipId - might be already clipped or display period ended
        if (item.errorMsg?.includes('already clipped')) {
          return { success: true, wasAlreadyClipped: true };
        } else {
          // simple fallback logic without additional API calls
          return { success: true, wasSkipped: true, reason: SkipReason.UNKNOWN_WITH_CLIPID, errorMsg: item.errorMsg || 'Has clipId but status 0' };
        }
      } else {
        return { success: true, wasSkipped: true, reason: SkipReason.UNEXPECTED_RESPONSE, errorMsg: item.errorMsg || 'No error message' };
      }
    } else {
      return { success: false, error: 'No items in response' };
    }

  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// message handling for popup interface
chrome.runtime.onMessage.addListener((request: MessageRequest, _sender, sendResponse: (response: MessageResponse) => void) => {

  switch (request.action) {
    case 'ping':
      sendResponse({ success: true, ready: true });
      break;

    case 'getOffers':
      handleGetOffers(sendResponse);
      break;

    case 'clipOffer':
      handleClipOffer(request.offer, sendResponse);
      break;

    case 'getAuthState':
      sendResponse({ 
        success: true, 
        authenticated: !!getAuthHeaders()
      });
      break;

    default:
      sendResponse({ success: false, error: 'Unknown action' });
  }

  return true; // keep message channel open for async responses
});

// handle getting all available offers
async function handleGetOffers(sendResponse: (response: MessageResponse) => void): Promise<void> {
  try {
    const offers = await fetchAllOffers();

    // add category information and metadata
    const processedOffers = offers.map(offer => ({
      ...offer,
      primaryCategory: offer.categories[0] || offer.categoryType || (offer.hierarchies?.categories?.[0]) || 'Other',
      displayImageUrl: getDisplayImageUrl(offer),
      isExpiringSoon: isOfferExpiringSoon(offer),
      isExpired: isOfferExpired(offer),
      isDisplayPeriodEnded: isDisplayPeriodEnded(offer)
    }));

    sendResponse({ success: true, offers: processedOffers });
  } catch (error) {
    sendResponse({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
  }
}

// handle clipping individual offer
async function handleClipOffer(offer: CouponOffer, sendResponse: (response: MessageResponse) => void): Promise<void> {
  try {
    const result = await clipOffer(offer);

    sendResponse({
      success: result.success,
      wasAlreadyClipped: result.wasAlreadyClipped,
      wasSkipped: result.wasSkipped,
      reason: result.reason,
      errorMsg: result.errorMsg,
      error: result.error,
      detailedOffer: result.detailedOffer
    });
  } catch (error) {
    sendResponse({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
  }
}