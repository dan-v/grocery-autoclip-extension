console.log('Safeway Coupon Clipper background script loaded');

chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension installed/updated');
});

chrome.action.onClicked.addListener((tab) => {
  console.log('Extension icon clicked for tab:', tab.url);
  
  if (tab.url && tab.url.includes('safeway.com')) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icon48.png',
      title: 'Safeway Coupon Clipper',
      message: 'Click the floating button on the page to start clipping coupons, or use the browser action menu for options.'
    });
  } else {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icon48.png',
      title: 'Safeway Coupon Clipper',
      message: 'Please navigate to Safeway.com to use this extension'
    });
  }
}); 