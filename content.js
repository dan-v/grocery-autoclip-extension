const DEBUG_MODE = localStorage.getItem('safewayClipperDebug') === 'true';

function debugLog(...args) {
  if (DEBUG_MODE) {
    console.log(...args);
  }
}

const CONFIG = {
  RATE_LIMIT_MS: 1000,
  API_BASE: 'https://www.safeway.com/abs/pub'
};

let lastApiCall = 0;
let isClipping = false;

async function rateLimit() {
  const now = Date.now();
  const timeSinceLastCall = now - lastApiCall;
  if (timeSinceLastCall < CONFIG.RATE_LIMIT_MS) {
    const waitTime = CONFIG.RATE_LIMIT_MS - timeSinceLastCall;
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }
  lastApiCall = Date.now();
}

function getAuthHeaders() {
  const cookies = {};
  document.cookie.split(';').forEach(cookie => {
    const [name, value] = cookie.trim().split('=');
    if (name && value) {
      cookies[name] = decodeURIComponent(value);
    }
  });
  
  let accessToken = null;
  let storeId = null;
  
  if (cookies.SWY_SHARED_PII_SESSION_INFO) {
    try {
      const piiData = JSON.parse(cookies.SWY_SHARED_PII_SESSION_INFO);
      accessToken = piiData.jti;
    } catch (e) {
      console.error('Failed to parse PII session:', e);
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
      console.error('Failed to parse session info:', e);
    }
  }
  
  if (!accessToken || !storeId) {
    console.log('🔍 Auth Debug:', {
      accessToken: accessToken ? 'Found' : 'Missing',
      storeId: storeId ? 'Found' : 'Missing',
      availableCookies: Object.keys(cookies),
      piiCookie: cookies.SWY_SHARED_PII_SESSION_INFO ? 'Present' : 'Missing',
      sessionCookie: cookies.SWY_SHARED_SESSION_INFO ? 'Present' : 'Missing'
    });
    return null;
  }
  
  const headers = {
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

async function fetchAllOffers() {
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
    
    let offers = [];
    if (data.companionGalleryOffer) {
      if (Array.isArray(data.companionGalleryOffer)) {
        offers = data.companionGalleryOffer;
      } else if (typeof data.companionGalleryOffer === 'object') {
        offers = Object.values(data.companionGalleryOffer);
      }
    }
    
    const clippableOffers = offers.filter(offer => {
      return ['J4U', 'PD', 'MF', 'SC'].includes(offer.offerPgm);
    });
    
    return clippableOffers.map(offer => ({
      id: offer.offerId,
      title: offer.offerTitle || offer.description || 'Unknown offer',
      program: offer.offerPgm,
      type: offer.offerSubType,
      brand: offer.brand || '',
      categories: offer.categories || [],
      offerPrice: offer.offerPrice || '',
      savingsAmount: offer.savingsAmount || '',
      originalOffer: offer
    }));
    
  } catch (error) {
    let errorMsg = 'Failed to load coupons';
    if (error.message.includes('Failed to fetch')) {
      errorMsg += ' (network error)';
    } else if (error.message.includes('401') || error.message.includes('403')) {
      errorMsg += ' (please refresh page)';
    }
    throw new Error(errorMsg);
  }
}

async function clipOffer(offer) {
  const authInfo = getAuthHeaders();
  if (!authInfo) {
    return { success: false, error: 'No authentication' };
  }
  
  await rateLimit();
  
  let itemType = offer.program || 'PD';
  if (offer.program === 'J4U') itemType = 'PD';
  
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
      } else if (item.errorMsg?.includes('not yet active') || item.errorMsg?.includes('past expiry')) {
        return { success: true, wasSkipped: true, reason: 'expired_or_inactive' };
      } else {
        return { success: false, error: item.errorMsg || 'Unknown error' };
      }
    } else {
      return { success: false, error: 'No items in response' };
    }
    
  } catch (error) {
    return { success: false, error: error.message };
  }
}



function createProgressOverlay() {
  const overlay = document.createElement('div');
  overlay.id = 'safeway-clipper-overlay';
  overlay.style.cssText = `
    position: fixed; top: 20px; right: 20px; z-index: 10000;
    background: linear-gradient(135deg, #2c3e50 0%, #34495e 100%);
    color: white; padding: 20px; border-radius: 12px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px; width: 350px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.3);
    backdrop-filter: blur(10px);
    border: 1px solid rgba(255,255,255,0.1);
  `;
  
  overlay.innerHTML = `
    <div style="display: flex; align-items: center; margin-bottom: 15px;">
      <div style="font-size: 20px; margin-right: 10px;">🛒</div>
      <div>
        <div style="font-weight: bold; font-size: 16px;">Safeway Coupon Clipper</div>
      </div>
    </div>
    <div id="progress-content" style="min-height: 80px; width: 100%; box-sizing: border-box;">
      <div>Initializing...</div>
    </div>
    <div style="margin-top: 15px;">
      <button onclick="this.parentElement.parentElement.remove()" 
              style="background: rgba(255,255,255,0.2); color: white; border: 1px solid rgba(255,255,255,0.3); 
                     padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 12px;">
        Close
      </button>
    </div>
  `;
  
  document.body.appendChild(overlay);
  return overlay;
}

function getOfferDisplayInfo(offer) {
  let displayName = '';
  let subtitle = '';
  
  if (offer.savingsAmount) {
    displayName = offer.savingsAmount;
  } else if (offer.offerPrice) {
    displayName = offer.offerPrice;
  } else if (offer.title.match(/\$[\d.]+/)) {
    displayName = offer.title.match(/\$[\d.]+/)[0];
  }
  
  if (offer.brand && offer.categories && offer.categories.length > 0) {
    subtitle = `${offer.brand} ${offer.categories[0]}`;
  } else if (offer.categories && offer.categories.length > 0) {
    subtitle = offer.categories[0];
  } else if (offer.brand) {
    subtitle = offer.brand;
  } else {
    const titleWords = offer.title.split(/\s+(?:when|on|for|OFF)/i)[0];
    const cleanTitle = titleWords.replace(/^\$[\d.]+ OFF (?:when you buy )?(?:ONE\(\d+\) )?/i, '');
    subtitle = cleanTitle.length > 35 ? cleanTitle.substring(0, 32) + '...' : cleanTitle;
  }
  
  return { displayName, subtitle };
}

function updateProgress(overlay, stats, message, offer = null) {
  const content = overlay.querySelector('#progress-content');
  if (content) {
    let displayContent = '';
    
    if (offer) {
      const { displayName, subtitle } = getOfferDisplayInfo(offer);
      displayContent = `
        <div style="margin-bottom: 10px; height: 38px; overflow: hidden; width: 100%;">
          <div style="font-weight: bold; font-size: 14px; white-space: nowrap; overflow: hidden; line-height: 1.2;">${displayName || 'Clipping offer'}</div>
          <div style="font-size: 11px; opacity: 0.8; white-space: nowrap; overflow: hidden; line-height: 1.3; margin-top: 2px;">${subtitle}</div>
        </div>
      `;
    } else {
      const truncatedMessage = message.length > 40 ? message.substring(0, 37) + '...' : message;
      displayContent = `
        <div style="margin-bottom: 10px; height: 20px; overflow: hidden; white-space: nowrap; width: 100%;">${truncatedMessage}</div>
      `;
    }
    
    content.innerHTML = `
      ${displayContent}
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 12px; width: 100%;">
        <div style="white-space: nowrap; overflow: hidden;">✅ Clipped: ${stats.clipped}</div>
        <div style="white-space: nowrap; overflow: hidden;">ℹ️ Already: ${stats.alreadyClipped}</div>
        <div style="white-space: nowrap; overflow: hidden;">⏭️ Skipped: ${stats.skipped}</div>
        <div style="white-space: nowrap; overflow: hidden;">❌ Failed: ${stats.failed}</div>
      </div>
      <div style="margin-top: 8px; font-size: 12px; text-align: center; width: 100%; color: rgba(255,255,255,0.8);">
        ${stats.processed}/${stats.total}
      </div>
      <div style="background: rgba(255,255,255,0.2); height: 4px; border-radius: 2px; margin-top: 6px; overflow: hidden; width: 100%;">
        <div style="background: white; height: 100%; width: ${stats.total > 0 ? (stats.processed / stats.total * 100) : 0}%; transition: width 0.3s;"></div>
      </div>
    `;
  }
}

async function clipAllCoupons() {
  if (isClipping) {
    debugLog('⚠️ Already clipping, ignoring request');
    
    const notification = document.createElement('div');
    notification.textContent = 'Clipping already in progress...';
    notification.style.cssText = `
      position: fixed; top: 20px; right: 20px; z-index: 10001;
      background: rgba(255, 193, 7, 0.9); color: #333; padding: 12px 20px; border-radius: 8px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px; font-weight: 500;
      box-shadow: 0 4px 12px rgba(0,0,0,0.2);
      opacity: 0; transition: opacity 0.3s;
    `;
    document.body.appendChild(notification);
    setTimeout(() => notification.style.opacity = '1', 10);
    setTimeout(() => {
      notification.style.opacity = '0';
      setTimeout(() => notification.remove(), 300);
    }, 2000);
    return;
  }
  
  isClipping = true;
  console.log('🚀 Starting coupon clipping process...');
  
  const overlay = createProgressOverlay();
  const stats = {
    total: 0,
    processed: 0,
    clipped: 0,
    alreadyClipped: 0,
    skipped: 0,
    failed: 0
  };
  
  try {
    updateProgress(overlay, stats, 'Fetching available offers...');
    const offers = await fetchAllOffers();
    
    stats.total = offers.length;
    console.log(`📊 Found ${stats.total} offers to process`);
    
    if (stats.total === 0) {
      updateProgress(overlay, stats, 'No offers found to clip');
      return stats;
    }
    
    for (let i = 0; i < offers.length; i++) {
      const offer = offers[i];
      
      updateProgress(overlay, stats, null, offer);
      
      const result = await clipOffer(offer);
      
      if (result.success) {
        if (result.wasAlreadyClipped) {
          stats.alreadyClipped++;
        } else if (result.wasSkipped) {
          stats.skipped++;
        } else {
          stats.clipped++;
        }
      } else {
        stats.failed++;
      }
      
      stats.processed++;
      
      if (i < offers.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    let summary = '';
    if (stats.clipped > 0) {
      summary = `🎉 Success! Clipped ${stats.clipped} new coupons`;
      if (stats.alreadyClipped > 0) summary += `, ${stats.alreadyClipped} already had`;
    } else if (stats.alreadyClipped > 0) {
      summary = `✅ All ${stats.alreadyClipped} coupons already clipped!`;
    } else {
      summary = `ℹ️ No new coupons found to clip`;
    }
    
    if (stats.failed > 0) {
      summary += ` (${stats.failed} failed)`;
    }
    
    updateProgress(overlay, stats, summary);
    console.log('🎉 Clipping complete!', stats);
    
    return stats;
    
  } catch (error) {
    console.error('💥 Fatal error during clipping:', error);
    updateProgress(overlay, stats, `Error: ${error.message}`);
    return { ...stats, error: error.message };
  } finally {
    isClipping = false;
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  debugLog('📨 Received message:', request);
});

if (window.location.href.includes('coupons') || window.location.href.includes('deals')) {
  
  setTimeout(() => {
    const button = document.createElement('button');
    button.textContent = '🛒 Clip All Coupons';
    button.style.cssText = `
      position: fixed; bottom: 20px; right: 20px; z-index: 10000;
      background: linear-gradient(135deg, #27ae60 0%, #2ecc71 100%);
      color: white; border: none; padding: 15px 25px; border-radius: 30px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 16px; font-weight: bold; cursor: pointer;
      box-shadow: 0 6px 25px rgba(0,0,0,0.4);
      transition: all 0.3s ease;
      animation: pulse 2s infinite;
      border: 1px solid rgba(255,255,255,0.2);
    `;
    
    const style = document.createElement('style');
         style.textContent = `
       @keyframes pulse {
         0% { box-shadow: 0 6px 25px rgba(0,0,0,0.4); }
         50% { box-shadow: 0 6px 25px rgba(39, 174, 96, 0.6); }
         100% { box-shadow: 0 6px 25px rgba(0,0,0,0.4); }
       }
     `;
    document.head.appendChild(style);
    
         button.onmouseover = () => {
       button.style.transform = 'scale(1.1)';
       button.style.animation = 'none';
     };
     button.onmouseout = () => {
       button.style.transform = 'scale(1)';
       button.style.animation = 'pulse 2s infinite';
     };
     
     button.onclick = () => clipAllCoupons();
    
    document.body.appendChild(button);
    
    const debugToggle = document.createElement('button');
    debugToggle.textContent = DEBUG_MODE ? '🐛' : '🔧';
    debugToggle.title = DEBUG_MODE ? 'Debug mode ON (click to disable)' : 'Debug mode OFF (click to enable)';
    debugToggle.style.cssText = `
      position: fixed; bottom: 85px; right: 20px; z-index: 9999;
      background: rgba(0,0,0,0.7); color: white; border: none;
      width: 32px; height: 32px; border-radius: 50%;
      font-size: 14px; cursor: pointer; transition: all 0.3s;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex; align-items: center; justify-content: center;
      opacity: 0.6;
    `;
    
    debugToggle.onmouseover = () => {
      debugToggle.style.opacity = '1';
      debugToggle.style.transform = 'scale(1.1)';
    };
    debugToggle.onmouseout = () => {
      debugToggle.style.opacity = '0.6';
      debugToggle.style.transform = 'scale(1)';
    };
    
    debugToggle.onclick = () => {
      const currentDebug = localStorage.getItem('safewayClipperDebug') === 'true';
      if (currentDebug) {
        localStorage.removeItem('safewayClipperDebug');
        debugToggle.textContent = '🔧';
        debugToggle.title = 'Debug mode OFF (click to enable)';
        console.log('🐛 Debug mode disabled. Reload page to take effect.');
      } else {
        localStorage.setItem('safewayClipperDebug', 'true');
        debugToggle.textContent = '🐛';
        debugToggle.title = 'Debug mode ON (click to disable)';
        console.log('🐛 Debug mode enabled. Reload page to take effect.');
      }
    };
    
    document.body.appendChild(debugToggle);
    
    if (!localStorage.getItem('safewayClipperSeen')) {
      const tooltip = document.createElement('div');
      tooltip.innerHTML = `
        <div style="font-weight: bold; margin-bottom: 4px;">🎉 Safeway Coupon Clipper Ready!</div>
        <div>Click the green button to automatically clip all available coupons</div>
      `;
      tooltip.style.cssText = `
        position: fixed; bottom: 85px; right: 70px; z-index: 9998;
        background: rgba(0,0,0,0.95); color: white; padding: 12px 16px; border-radius: 8px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 13px; max-width: 250px; text-align: center;
        opacity: 0; transition: opacity 0.3s;
        box-shadow: 0 6px 20px rgba(0,0,0,0.4);
        border: 1px solid rgba(255,255,255,0.1);
      `;
      document.body.appendChild(tooltip);
      
      setTimeout(() => {
        tooltip.style.opacity = '1';
        setTimeout(() => {
          tooltip.style.opacity = '0';
          setTimeout(() => {
            tooltip.remove();
            localStorage.setItem('safewayClipperSeen', 'true');
          }, 300);
        }, 5000);
      }, 1500);
    }
    
  }, 2000);
}

console.log('✅ Safeway Coupon Clipper ready!');
if (!DEBUG_MODE) {
  console.log('💡 Enable debug mode: localStorage.setItem("safewayClipperDebug", "true"); then reload');
} 