// ABOUTME: Utility functions for coupon processing, validation, and formatting
// ABOUTME: Handles images, dates, expiry checking, text formatting, and display helpers

import { CouponOffer, OfferProgram } from './types.js';

/**
 * get display image URL with better fallbacks
 */
export function getDisplayImageUrl(offer: CouponOffer): string | null {
  if (offer.imageId?.trim()) {
    return `https://images.albertsons-media.com/is/image/ABS/${offer.imageId}?$ecom-product-card-desktop-jpg$&defaultImage=Not_Available`;
  }

  if (offer.imageUrl?.includes('images.albertsons-media.com')) {
    return offer.imageUrl;
  }
  
  if (offer.largeImageUrl) return offer.largeImageUrl;
  if (offer.smallImageUrl) return offer.smallImageUrl;
  if (offer.imageUrl) return offer.imageUrl;

  return null;
}

/**
 * internal helper to normalize date for expiry checking
 */
function normalizeExpiryDate(dateStr: string | undefined, isTimestamp = false): Date | null {
  if (!dateStr) return null;
  return isTimestamp ? new Date(parseInt(dateStr)) : new Date(dateStr);
}

/**
 * check if item is expiring soon (within 3 days)
 */
function isExpiringSoon(item: CouponOffer, useTimestamp = false): boolean {
  const offer = item.originalOffer || item;
  const expiryDateStr = offer.endDate || offer.offerEndDate || item.validTo;
  if (!expiryDateStr) return false;

  const expiryDate = normalizeExpiryDate(expiryDateStr, useTimestamp);
  if (!expiryDate) return false;

  const today = new Date();
  const threeDaysFromNow = new Date();
  
  // reset to midnight for fair date-only comparison
  expiryDate.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  threeDaysFromNow.setHours(0, 0, 0, 0);
  threeDaysFromNow.setDate(today.getDate() + 3);
  
  return expiryDate >= today && expiryDate <= threeDaysFromNow;
}

/**
 * check if item is expired
 */
function isExpired(item: CouponOffer, useTimestamp = false): boolean {
  const offer = item.originalOffer || item;
  const expiryDateStr = offer.endDate || offer.offerEndDate || item.validTo;
  if (!expiryDateStr) return false;

  const expiryDate = normalizeExpiryDate(expiryDateStr, useTimestamp);
  if (!expiryDate) return false;

  const today = new Date();
  
  // reset times to midnight for fair comparison
  expiryDate.setHours(23, 59, 59, 999);
  today.setHours(0, 0, 0, 0);
  
  return expiryDate < today;
}

// legacy function names for backward compatibility
export function isOfferExpiringSoon(offer: CouponOffer): boolean {
  return isExpiringSoon(offer, false);
}

export function isOfferExpired(offer: CouponOffer): boolean {
  return isExpired(offer, false);
}

export function isCouponExpiringSoon(coupon: CouponOffer): boolean {
  return isExpiringSoon(coupon, true);
}

export function isCouponExpired(coupon: CouponOffer): boolean {
  return isExpired(coupon, true);
}

/**
 * check if offer display period has ended but offer is still valid
 */
export function isDisplayPeriodEnded(offer: CouponOffer): boolean {
  const displayEndDateStr = offer.displayEndDate;
  const offerEndDateStr = offer.offerEndDate || offer.validTo;

  if (!displayEndDateStr) return false;
  
  const displayEndDate = new Date(displayEndDateStr);
  const now = new Date();

  // display period ended
  if (now <= displayEndDate) return false;

  // if no offer end date, assume display period ending means offer ended
  if (!offerEndDateStr) return true;
  
  const offerEndDate = new Date(offerEndDateStr);
  // display ended but offer is still valid
  return now <= offerEndDate;
}

/**
 * get placeholder image for coupons without images
 */
export function getPlaceholderImage(): string {
  return 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDgiIGhlaWdodD0iNDgiIHZpZXdCb3g9IjAgMCA0OCA0OCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjQ4IiBoZWlnaHQ9IjQ4IiBmaWxsPSIjRjNGNEY2Ii8+CjxwYXRoIGQ9Ik0yNCAzNkMzMC42Mjc0IDM2IDM2IDMwLjYyNzQgMzYgMjRDMzYgMTcuMzcyNiAzMC42Mjc0IDEyIDI0IDEyQzE3LjM3MjYgMTIgMTIgMTcuMzcyNiAxMiAyNEMxMiAzMC42Mjc0IDE3LjM3MjYgMzYgMjQgMzYiIGZpbGw9IiNEMUQ1REIiLz4KPC9zdmc+';
}

/**
 * truncate text to specified length
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

/**
 * get first sentence from text for display
 */
export function getFirstSentence(text: string): string {
  if (!text?.trim()) return '';

  // split by period, but be careful of abbreviations like "5.0 oz"
  const sentences = text.split(/\.\s+/);
  let firstSentence = sentences[0];

  // if the first "sentence" is very short (like "5"), it might be part of a measurement
  // so include the next part too
  if (firstSentence.length < 20 && sentences.length > 1) {
    firstSentence = firstSentence + '. ' + sentences[1];
  }

  // truncate if still too long
  if (firstSentence.length > 120) {
    firstSentence = firstSentence.substring(0, 117) + '...';
  }

  return firstSentence;
}

/**
 * format limit text for display
 */
export function formatLimit(limit: string | undefined): string {
  if (!limit) return 'Not specified';

  if (limit === 'O') return 'Once per person';
  if (limit === 'U') return 'Unlimited';
  if (limit === '1') return 'Once per person';

  return limit;
}

/**
 * format description text with reliable highlights
 */
export function formatDescription(description: string): string {
    if (!description) return '';

    let formatted = description;
    
    // highlight ONLY dollar amounts with OFF at start of sentence
    formatted = formatted.replace(/^(\$\d+(?:\.\d+)?\s+OFF)/gi, '<span class="money-highlight">$1</span>');

    // highlight product list BEFORE highlighting quantity (so pattern still matches)
    const buyMatch = formatted.match(/buy\s+((?:ONE|TWO|THREE|FOUR|FIVE)\(\d+\))\s+(.+?)\./i);
    if (buyMatch) {
        const quantity = buyMatch[1];
        const productText = buyMatch[2];
        formatted = formatted.replace(buyMatch[0], 
            `buy <span class="quantity-highlight">${quantity}</span> <span class="product-highlight">${productText}</span>.`);
    }

    // highlight "Valid on" specifications (until common sentence breaks)
    formatted = formatted.replace(/(Valid on .*?)(?=\.\s*(?:Excludes|Items|$))/gi, '<span class="valid-highlight">$1</span>');

    // highlight "Any variety" statements
    formatted = formatted.replace(/\b(Any variety)\b/gi, '<span class="variety-highlight">$1</span>');

    // highlight "Limit" statements
    formatted = formatted.replace(/\b(Limit \d+)\b/gi, '<span class="limit-highlight">$1</span>');

    // highlight complete "Excludes" sentences only - handle decimal numbers properly
    formatted = formatted.replace(/(Excludes(?:[^.]|\.\d)+\.)/gi, '<span class="exclude-highlight">$1</span>');

    return formatted;
}

/**
 * format program name for display
 */
export function formatProgramName(program: string): string {
  const programNames: Record<string, string> = {
    [OfferProgram.J4U]: 'Just for U',
    [OfferProgram.PD]: 'Personal Deal',
    [OfferProgram.MF]: 'Manufacturer',
    [OfferProgram.SC]: 'Store Coupon',
    [OfferProgram.DG]: 'Digital',
    [OfferProgram.PC]: 'Price Cut'
  };

  return programNames[program] || program;
}