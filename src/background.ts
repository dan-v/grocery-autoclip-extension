
import {
  ClippingState,
  ClippingStats,
  StorageData,
  ClippingSession,
  CouponOffer,
  ClippedCoupon,
  SkippedCoupon,
  MessageRequest,
  MessageResponse,
  SkipReason
} from './types.js';

interface Config {
  BATCH_SIZE: number;
  BATCH_DELAY_MS: number;
  BATCH_DELAY_VARIANCE_MS: number;
  MAX_SESSIONS: number;
  DATA_RETENTION_DAYS: number;
  MAX_SESSION_HISTORY: number;
}

const CONFIG: Config = {
  BATCH_SIZE: 5,
  BATCH_DELAY_MS: 800,
  BATCH_DELAY_VARIANCE_MS: 400,
  MAX_SESSIONS: 50,
  DATA_RETENTION_DAYS: 90,
  MAX_SESSION_HISTORY: 100
};

const clippingState: ClippingState = {
  isActive: false,
  currentStats: {
    total: 0,
    processed: 0
  },
  startTime: null,
  lastActivity: null
};

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    await initializeExtension();
  }
});

async function initializeExtension(): Promise<void> {
  const defaultData: Partial<StorageData> = {
    userPreferences: {
      clippingDelay: 1000,
      maxConcurrentClips: 3
    },
    clippedCoupons: [],
    clippingStats: clippingState.currentStats
  };

  try {
    const existingData = await chrome.storage.local.get(Object.keys(defaultData));
    const dataToSet: Partial<StorageData> = {};

    // only set defaults for missing keys
    for (const [key, value] of Object.entries(defaultData)) {
      if (!(key in existingData)) {
        (dataToSet as Record<string, unknown>)[key] = value;
      }
    }

    if (Object.keys(dataToSet).length > 0) {
      await chrome.storage.local.set(dataToSet);
    }
  } catch (error) {
    console.warn('Extension initialization failed:', error);
  }
}

chrome.action.onClicked.addListener(async (tab) => {
  if (tab.url && tab.url.includes('safeway.com') && tab.id) {
    try {
      await chrome.tabs.sendMessage(tab.id, { action: 'ping' });
    } catch {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['dist/content.js']
        });
      } catch (injectError) {
        console.warn('Script injection failed:', injectError);
        return;
      }
    }
  }
});

chrome.runtime.onMessage.addListener((message: MessageRequest, sender, sendResponse: (response: MessageResponse) => void) => {
  switch (message.action) {
    case 'startClipping':
      handleStartClipping(message, sender, sendResponse);
      break;

    case 'stopClipping':
      handleStopClipping(message, sender, sendResponse);
      break;

    case 'updateClippingStats':
      handleUpdateStats(message, sender, sendResponse);
      break;

    case 'getClippingState':
      sendResponse({ success: true, state: clippingState });
      break;

    case 'showNotification':
      handleShowNotification(message, sender, sendResponse);
      break;

    case 'syncData':
      handleSyncData(message, sender, sendResponse);
      break;

    case 'updateBadge':
      updateBadgeProgress();
      sendResponse({ success: true });
      break;

    case 'startBackgroundClipping':
      handleStartBackgroundClipping(message, sender, sendResponse);
      break;
      
    default:
      sendResponse({ success: false, error: 'Unknown action' });
  }

  // keep message channel open for async responses
  return true;
});

async function handleStartClipping(message: MessageRequest, _sender: chrome.runtime.MessageSender, sendResponse: (response: MessageResponse) => void): Promise<void> {
  try {
    clippingState.isActive = true;
    clippingState.startTime = Date.now();
    clippingState.currentStats = message.stats || clippingState.currentStats;
    
    // show initial badge
    await updateBadgeProgress();
    
    // save state
    await chrome.storage.local.set({ 
      clippingState: clippingState,
      lastClippingStart: new Date().toISOString()
    });
    
    sendResponse({ success: true, state: clippingState });
  } catch (error) {
    sendResponse({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
  }
}

async function handleStopClipping(message: MessageRequest, _sender: chrome.runtime.MessageSender, sendResponse: (response: MessageResponse) => void): Promise<void> {
  try {
    const wasActive = clippingState.isActive;
    clippingState.isActive = false;
    clippingState.lastActivity = Date.now();
    
    // update badge to show unclipped count
    await updateBadgeProgress();
    
    if (wasActive && message.finalStats) {
      // save final statistics
      await saveClippingSession(message.finalStats);
    }
    
    // save state
    await chrome.storage.local.set({ clippingState: clippingState });
    
    sendResponse({ success: true, state: clippingState });
  } catch (error) {
    sendResponse({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
  }
}

async function handleUpdateStats(message: MessageRequest, _sender: chrome.runtime.MessageSender, sendResponse: (response: MessageResponse) => void): Promise<void> {
  try {
    clippingState.currentStats = { ...clippingState.currentStats, ...message.stats };
    clippingState.lastActivity = Date.now();
    
    // update badge with progress
    await updateBadgeProgress();
    
    // save updated stats
    await chrome.storage.local.set({ 
      clippingStats: clippingState.currentStats,
      clippingState: clippingState
    });
    
    sendResponse({ success: true, stats: clippingState.currentStats });
  } catch (error) {
    sendResponse({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
  }
}

async function handleShowNotification(_message: MessageRequest, _sender: chrome.runtime.MessageSender, sendResponse: (response: MessageResponse) => void): Promise<void> {
  // notifications disabled for minimal permissions and privacy
  sendResponse({ success: true });
}

async function handleSyncData(_message: MessageRequest, _sender: chrome.runtime.MessageSender, sendResponse: (response: MessageResponse) => void): Promise<void> {
  try {
    const data = await chrome.storage.local.get();
    sendResponse({ success: true, data: data });
  } catch (error) {
    sendResponse({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
  }
}

async function updateBadgeProgress(): Promise<void> {
  try {
    if (clippingState.isActive) {
      // show percentage when actively clipping
      const { processed, total } = clippingState.currentStats;
      
      if (total > 0) {
        const percentage = Math.round((processed / total) * 100);
        const badgeText = `${percentage}%`;
        await chrome.action.setBadgeText({ text: badgeText });
        
        // set badge color for active clipping
        await chrome.action.setBadgeBackgroundColor({ color: '#2563eb' });
        
      }
    } else {
      // show unclipped count when idle, excluding skipped coupons
      const data = await chrome.storage.local.get(['availableCoupons', 'clippedCoupons', 'skippedCoupons']);
      if (data.availableCoupons && data.clippedCoupons) {
        const skippedCount = (data.skippedCoupons || []).length;
        const unclippedCount = data.availableCoupons - data.clippedCoupons.length - skippedCount;
        
        if (unclippedCount > 0) {
          await chrome.action.setBadgeText({ text: unclippedCount.toString() });
          await chrome.action.setBadgeBackgroundColor({ color: '#16a34a' });
        } else {
          await chrome.action.setBadgeText({ text: '' });
        }
      } else {
        await chrome.action.setBadgeText({ text: '' });
      }
    }
  } catch (error) {
    console.warn('Badge update failed:', error);
  }
}

async function saveClippingSession(stats: ClippingStats): Promise<void> {
  try {
    const session: ClippingSession = {
      id: Date.now().toString(),
      date: new Date().toISOString(),
      stats: stats,
      duration: clippingState.startTime ? Date.now() - clippingState.startTime : 0
    };
    
    // get existing sessions
    const data = await chrome.storage.local.get(['clippingSessions']);
    const sessions: ClippingSession[] = data.clippingSessions || [];
    
    // add new session
    sessions.push(session);
    
    // keep only recent sessions
    if (sessions.length > CONFIG.MAX_SESSIONS) {
      sessions.splice(0, sessions.length - CONFIG.MAX_SESSIONS);
    }
    
    await chrome.storage.local.set({ 
      clippingSessions: sessions,
      lastClippingSession: session
    });
    
  } catch (error) {
    console.warn('Session save failed:', error);
  }
}

async function handleStartBackgroundClipping(message: MessageRequest, _sender: chrome.runtime.MessageSender, sendResponse: (response: MessageResponse) => void): Promise<void> {
  try {
    if (clippingState.isActive) {
      clippingState.isActive = false;
    }

    const offers = message.offers as CouponOffer[];
    const tabId = message.tabId as number;
    
    // initialize clipping state
    clippingState.isActive = true;
    clippingState.startTime = Date.now();
    clippingState.currentStats = {
      total: offers.length,
      processed: 0,
      clipped: 0,
      alreadyClipped: 0,
      skipped: 0,
      failed: 0
    };
    
    // save state
    await chrome.storage.local.set({ 
      clippingState: clippingState,
      lastClippingStart: new Date().toISOString()
    });
    
    // start clipping process
    processOffersInBackground(offers, tabId);
    
    sendResponse({ success: true, state: clippingState });
  } catch (error) {
    sendResponse({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
  }
}

interface OfferResult {
  offer: CouponOffer;
  success: boolean;
  wasAlreadyClipped?: boolean;
  wasSkipped?: boolean;
  reason?: string;
  errorMsg?: string;
  error?: string;
}

async function processOffersInBackground(offers: CouponOffer[], tabId: number): Promise<void> {
  const batchSize = CONFIG.BATCH_SIZE;
  
  try {
    for (let i = 0; i < offers.length && clippingState.isActive; i += batchSize) {
      const batch = offers.slice(i, Math.min(i + batchSize, offers.length));
      
      const batchPromises = batch.map(async (offer): Promise<OfferResult> => {
        try {
          const response = await chrome.tabs.sendMessage(tabId, { 
            action: 'clipOffer', 
            offer: offer 
          });

          // detect skipped/expired coupons
          let finalReason = response.reason;
          let wasSkipped = response.wasSkipped;
          let success = response.success;
          
          // if reason is unknown but was skipped, assume expired
          if (wasSkipped && (!finalReason || finalReason === 'unknown')) {
            finalReason = SkipReason.EXPIRED_OR_INACTIVE;
          }
          
          // handle missed expired/inactive detections
          if (!wasSkipped && !success && response.error?.match(/(not yet active|past expiry|shutoff date)/)) {
            success = true;
            wasSkipped = true;
            finalReason = SkipReason.EXPIRED_OR_INACTIVE;
          }

          return {
            offer,
            success: success,
            wasAlreadyClipped: response.wasAlreadyClipped,
            wasSkipped: wasSkipped,
            reason: finalReason,
            errorMsg: response.errorMsg,
            error: response.error
          };
        } catch (error) {
          return {
            offer,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          };
        }
      });
      
      // wait for all coupons in batch to complete
      const batchResults = await Promise.all(batchPromises);
      
      // process results and update storage
      const newClippedCoupons: CouponOffer[] = [];
      const newSkippedCoupons: SkippedCoupon[] = [];
      for (const result of batchResults) {
        if (result.success) {
          if (result.wasAlreadyClipped || !result.wasSkipped) {
            newClippedCoupons.push(result.offer);
          } else if (result.wasSkipped) {
            const reasonText = result.reason || SkipReason.UNKNOWN;
            
            // track permanently unclippable coupons with full details
            if (reasonText === SkipReason.EXPIRED_OR_INACTIVE || 
                reasonText === SkipReason.NOT_AVAILABLE_IN_STORE || 
                reasonText === SkipReason.NOT_ELIGIBLE || 
                reasonText === SkipReason.DISPLAY_PERIOD_ENDED || 
                reasonText === SkipReason.LIMIT_EXCEEDED) {
              newSkippedCoupons.push({
                ...result.offer,
                skippedDate: new Date().toISOString(),
                skipReason: reasonText,
                skipMessage: result.errorMsg || 'No specific message',
                status: 'skipped'
              });
            }
          }
        }

        clippingState.currentStats.processed++;
      }
      
      // update stored clipped coupons and skipped coupons
      if (newClippedCoupons.length > 0 || newSkippedCoupons.length > 0) {
        const data = await chrome.storage.local.get(['clippedCoupons', 'skippedCoupons']);
        const existingCoupons: ClippedCoupon[] = data.clippedCoupons || [];
        const existingSkipped: SkippedCoupon[] = data.skippedCoupons || [];
        
        // add new clipped coupons
        for (const offer of newClippedCoupons) {
          if (!existingCoupons.find(c => c.id === offer.id)) {
            existingCoupons.push({
              ...offer,
              clippedDate: new Date().toISOString(),
              status: 'clipped'
            });
          }
        }
        
        // add new permanently skipped coupons with full details
        for (const skippedCoupon of newSkippedCoupons) {
          if (!existingSkipped.find(c => c.id === skippedCoupon.id)) {
            existingSkipped.push(skippedCoupon);
          }
        }
        
        await chrome.storage.local.set({ 
          clippedCoupons: existingCoupons,
          skippedCoupons: existingSkipped
        });
      }
      
      // update badge and save state
      await updateBadgeProgress();
      await chrome.storage.local.set({ 
        clippingStats: clippingState.currentStats,
        clippingState: clippingState
      });
      
      // add delay between batches
      if (i + batchSize < offers.length) {
        await sleep(CONFIG.BATCH_DELAY_MS + Math.random() * CONFIG.BATCH_DELAY_VARIANCE_MS);
      }
    }
    
    // clipping completed
    if (clippingState.isActive) {
      clippingState.isActive = false;
        
      await saveClippingSession(clippingState.currentStats);
      await updateBadgeProgress();
      await chrome.storage.local.set({ clippingState: clippingState });
    }
    
  } catch {
    clippingState.isActive = false;
    await chrome.storage.local.set({ clippingState: clippingState });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

chrome.runtime.onStartup.addListener(async () => {
  try {
    const data = await chrome.storage.local.get(['clippedCoupons', 'clippingSessions']);
    
    // remove expired coupons older than configured retention period
    if (data.clippedCoupons) {
      const retentionCutoff = new Date(Date.now() - CONFIG.DATA_RETENTION_DAYS * 24 * 60 * 60 * 1000);
      const activeCoupons = data.clippedCoupons.filter((coupon: ClippedCoupon) => {
        if (!coupon.clippedDate) return true;
        return new Date(coupon.clippedDate) > retentionCutoff;
      });
      
      if (activeCoupons.length !== data.clippedCoupons.length) {
        await chrome.storage.local.set({ clippedCoupons: activeCoupons });
      }
    }
    
    // keep only recent sessions
    if (data.clippingSessions && data.clippingSessions.length > CONFIG.MAX_SESSION_HISTORY) {
      const recentSessions = data.clippingSessions.slice(-CONFIG.MAX_SESSIONS);
      await chrome.storage.local.set({ clippingSessions: recentSessions });
    }
  } catch (error) {
    console.warn('Startup cleanup failed:', error);
  }
});