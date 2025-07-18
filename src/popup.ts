
import {
  ClippingStats,
  ClippingState,
  CouponOffer,
  ClippedCoupon,
  MessageResponse
} from './types.js';
import {
  isCouponExpiringSoon,
  isCouponExpired,
  getPlaceholderImage,
  truncateText,
  getFirstSentence,
  formatDescription
} from './utils.js';

interface AppConfig {
  REFRESH_INTERVAL: number;
  ITEMS_PER_PAGE: number;
  BACKGROUND_MONITOR_INTERVAL: number;
  MAX_VISIBLE_PAGES: number;
}

const APP_CONFIG: AppConfig = {
    REFRESH_INTERVAL: 60 * 60 * 1000, // 1 hour in milliseconds
    ITEMS_PER_PAGE: 8,
    BACKGROUND_MONITOR_INTERVAL: 2000, // 2 seconds
    MAX_VISIBLE_PAGES: 5
};

class GroceryAutoClipApp {
    private isClipping: boolean;
    private clippingStats: ClippingStats;
    private allOffers: CouponOffer[];
    private myClippedCoupons: ClippedCoupon[];
    private searchQuery: string;
    private categoryFilter: string;
    private statusFilter: string;
    private sortFilter: string;
    private lastRefreshTime: number;
    private isInitialLoad: boolean;
    private currentPage: number;
    private backgroundMonitor: number | null;
    private availableCoupons: CouponOffer[] | null;

    constructor() {
        this.isClipping = false;
        this.clippingStats = { total: 0, processed: 0 };
        this.allOffers = [];
        this.myClippedCoupons = [];
        this.searchQuery = '';
        this.categoryFilter = '';
        this.statusFilter = '';
        this.sortFilter = 'expiry';
        this.lastRefreshTime = 0;
        this.isInitialLoad = true;
        this.currentPage = 1;
        this.backgroundMonitor = null;
        this.availableCoupons = null;
        
        this.init();
    }

    async init(): Promise<void> {
        await this.loadStoredData();
        this.setupEventListeners();
        
        this.loadMyCouponsData();
        
        await this.loadDashboardData();
        await this.checkBackgroundClippingState();
    }

    async loadStoredData(): Promise<void> {
        try {
            const data = await chrome.storage.local.get(['clippedCoupons', 'lastRefreshTime']);
            this.myClippedCoupons = data.clippedCoupons || [];
            this.lastRefreshTime = data.lastRefreshTime || 0;
        } catch (error) {
            console.warn('Error loading stored data:', error);
        }
    }

    async checkBackgroundClippingState(): Promise<void> {
        try {
            const response = await chrome.runtime.sendMessage({ action: 'getClippingState' }) as MessageResponse & { state: ClippingState };
            
            if (response.success && response.state.isActive) {
                this.isClipping = response.state.isActive;
                this.clippingStats = response.state.currentStats;
                this.showClippingSection(true);
                this.updateSmartActionButton();
                this.updateClippingDisplay();
                this.startBackgroundProgressMonitoring();
            }
        } catch (error) {
            console.warn('Background clipping state check failed:', error);
        }
    }

    startBackgroundProgressMonitoring(): void {
        this.backgroundMonitor = window.setInterval(async () => {
            try {
                const response = await chrome.runtime.sendMessage({ action: 'getClippingState' }) as MessageResponse & { state: ClippingState };
                
                if (response.success && response.state.isActive) {
                    this.clippingStats = response.state.currentStats;
                    await this.loadStoredData();
                    this.updateClippingDisplay();
                    this.updateSmartActionButton();
                    await this.updateDashboardStats();
                    
                    // real-time table updates during clipping
                    this.loadMyCouponsData();
                } else {
                    this.stopBackgroundProgressMonitoring();
                    await this.finishClipping();
                }
            } catch {
                this.stopBackgroundProgressMonitoring();
            }
        }, APP_CONFIG.BACKGROUND_MONITOR_INTERVAL);
    }

    stopBackgroundProgressMonitoring(): void {
        if (this.backgroundMonitor) {
            clearInterval(this.backgroundMonitor);
            this.backgroundMonitor = null;
        }
    }

    async checkSafewayStatus(): Promise<boolean> {
        try {
            const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
            
            if (!activeTab.url?.includes('safeway.com')) {
                this.showGuidance('navigate', 'Please navigate to Safeway.com to use this extension');
                return false;
            }

            try {
                const authResponse = await chrome.tabs.sendMessage(activeTab.id!, { action: 'getAuthState' });
                if (!authResponse?.authenticated) {
                    this.showGuidance('login', 'Please sign in to your Safeway account to clip coupons');
                    return false;
                }
                return true;
            } catch {
                // try to inject the content script if connection failed
                try {
                    await chrome.scripting.executeScript({
                        target: { tabId: activeTab.id! },
                        files: ['dist/content.js']
                    });
                    // retry auth check after injection
                    const retryAuthResponse = await chrome.tabs.sendMessage(activeTab.id!, { action: 'getAuthState' });
                    if (!retryAuthResponse.authenticated) {
                        this.showGuidance('login', 'Please sign in to your Safeway account to clip coupons');
                        return false;
                    }
                    return true;
                } catch {
                    this.showGuidance('refresh', 'Please refresh the Safeway page to enable coupon clipping');
                    return false;
                }
            }
        } catch {
            return false;
        }
    }

    setupEventListeners(): void {
        document.getElementById('smartActionBtn')?.addEventListener('click', () => this.handleSmartAction());

        document.getElementById('searchInput')?.addEventListener('input', (e) => {
            this.searchQuery = (e.target as HTMLInputElement).value;
            this.filterAndDisplayMyCoupons();
        });

        document.getElementById('categoryFilter')?.addEventListener('change', (e) => {
            this.categoryFilter = (e.target as HTMLSelectElement).value;
            this.filterAndDisplayMyCoupons();
        });

        document.getElementById('sortFilter')?.addEventListener('change', (e) => {
            this.sortFilter = (e.target as HTMLSelectElement).value;
            this.filterAndDisplayMyCoupons();
        });

        document.getElementById('clearDataBtn')?.addEventListener('click', () => this.clearData());
        
        const prevPageBtn = document.getElementById('prevPageBtn');
        const nextPageBtn = document.getElementById('nextPageBtn');
        
        prevPageBtn?.addEventListener('click', () => this.previousPage());
        nextPageBtn?.addEventListener('click', () => this.nextPage());
        
        // add click handler for table rows
        document.addEventListener('click', (e) => {
            const couponRow = (e.target as HTMLElement).closest('.coupon-row') as HTMLElement;
            if (couponRow?.dataset.couponId) {
                this.showCouponDetail(couponRow.dataset.couponId);
            }
        });
    }

    async loadDashboardData(forceRefresh = true): Promise<void> {
        try {
            const safewayReady = await this.checkSafewayStatus();
            if (!safewayReady) {
                this.allOffers = [];
                await this.updateDashboardStats();
                this.updateSmartActionButton();
                return;
            }

            // check if we need to refresh based on time and force flag
            const now = Date.now();
            const shouldRefresh = forceRefresh || 
                                 !this.allOffers.length || 
                                 (now - this.lastRefreshTime) > APP_CONFIG.REFRESH_INTERVAL;

            if (!shouldRefresh) {
                // use cached data
                await this.updateDashboardStats();
                this.updateSmartActionButton();
                return;
            }

            this.setRefreshButtonLoading(true);
            
            const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
            const response = await chrome.tabs.sendMessage(activeTab.id!, { action: 'getOffers' }) as MessageResponse & { offers: CouponOffer[] };
            
            if (response.success) {
                this.allOffers = response.offers;
                this.lastRefreshTime = now;
                
                await this.storeAlreadyClippedCoupons();
                await this.updateDashboardStats();
                this.updateSmartActionButton();
                
                // save refresh time and update storage
                await chrome.storage.local.set({ 
                    availableCoupons: this.allOffers.length,
                    lastRefreshTime: this.lastRefreshTime
                });
                chrome.runtime.sendMessage({ action: 'updateBadge' });
            } else {
                if (response.error?.includes('authentication')) {
                    this.showGuidance('login', 'Please sign in to your Safeway account to clip coupons');
                } else {
                    throw new Error(response.error || 'Failed to load offers');
                }
            }
            
            this.setRefreshButtonLoading(false);
        } catch (error) {
            this.setRefreshButtonLoading(false);
            
            if (error instanceof Error && (error.message.includes('authentication') || error.message.includes('No authentication'))) {
                this.showGuidance('login', 'Please sign in to your Safeway account to clip coupons');
            }
        }
    }

    async refreshCoupons(): Promise<void> {
        try {
            await this.loadDashboardData(true);
            
            // after refreshing, check if there are coupons to clip and start clipping
            const availableCount = this.availableCoupons ? this.availableCoupons.filter(offer => {
                const originalOffer = offer.originalOffer || offer;
                return originalOffer.status !== 'C';
            }).length : 0;
            
            if (availableCount > 0 && !this.isClipping) {
                await this.startClipping();
            }
        } catch {
            // Error handled in loadDashboardData
        }
    }

    async storeAlreadyClippedCoupons(): Promise<void> {
        const alreadyClippedOffers = this.allOffers.filter(offer => {
            const originalOffer = offer.originalOffer || offer;
            const alreadyInMyClipped = this.myClippedCoupons.some(clipped => clipped.id === offer.id);
            return !alreadyInMyClipped && originalOffer.status === 'C';
        });
        
        if (alreadyClippedOffers.length > 0) {
            for (const offer of alreadyClippedOffers) {
                const originalOffer = offer.originalOffer || offer;
                this.myClippedCoupons.push({
                    ...offer,
                    status: 'clipped',
                    clipId: originalOffer.clipId,
                    clipTs: originalOffer.clipTs,
                    clippedDate: originalOffer.clipTs ? new Date(parseInt(originalOffer.clipTs)).toISOString() : new Date().toISOString()
                });
            }
            await chrome.storage.local.set({ clippedCoupons: this.myClippedCoupons });
        }
    }

    async updateDashboardStats(): Promise<void> {
        
        // store available coupons for smart button
        this.availableCoupons = this.allOffers;
        
        // update refresh info display
        this.updateRefreshInfo();
    }

    updateRefreshInfo(): void {
        const lastUpdatedEl = document.getElementById('lastUpdated');
        
        if (lastUpdatedEl) {
            if (this.lastRefreshTime > 0) {
                const refreshDate = new Date(this.lastRefreshTime);
                const now = new Date();
                const diffMinutes = Math.floor((now.getTime() - refreshDate.getTime()) / (1000 * 60));
                
                let timeText: string;
                if (diffMinutes < 1) {
                    timeText = 'now';
                } else if (diffMinutes < 60) {
                    timeText = `${diffMinutes}m`;
                } else if (diffMinutes < 1440) {
                    const hours = Math.floor(diffMinutes / 60);
                    timeText = `${hours}h`;
                } else {
                    const days = Math.floor(diffMinutes / 1440);
                    timeText = `${days}d`;
                }
                
                lastUpdatedEl.textContent = timeText;
            } else {
                lastUpdatedEl.textContent = 'never';
            }
        }
    }

    updateSmartActionButton(): void {
        const btn = document.getElementById('smartActionBtn') as HTMLButtonElement;
        const icon = document.getElementById('smartIcon');
        const text = document.getElementById('smartText');
        
        if (!btn || !icon || !text) return;
        
        const statusMessages = document.getElementById('statusMessages');
        if (statusMessages?.innerHTML.includes('sign in')) {
            icon.textContent = '🔑';
            text.textContent = 'Sign In';
            btn.className = 'smart-btn';
            btn.disabled = true;
            return;
        }
        
        if (this.isClipping) {
            icon.textContent = '⏳';
            text.textContent = 'Clipping...';
            btn.className = 'smart-btn';
            btn.disabled = true;
        } else {
            // get available count from stored data
            const availableCount = this.availableCoupons ? this.availableCoupons.filter(offer => {
                const originalOffer = offer.originalOffer || offer;
                return originalOffer.status !== 'C';
            }).length : 0;
            
            if (availableCount === 0) {
                // just refresh mode
                icon.textContent = '🔄';
                text.textContent = 'Refresh';
                btn.className = 'smart-btn';
                btn.disabled = false;
            } else {
                // clip mode
                icon.textContent = '✂️';
                if (availableCount === 1) {
                    text.textContent = 'Clip 1';
                } else {
                    text.textContent = `Clip ${availableCount}`;
                }
                btn.className = 'smart-btn clip-mode';
                btn.disabled = false;
            }
        }
    }

    setRefreshButtonLoading(loading: boolean): void {
        const btn = document.getElementById('smartActionBtn') as HTMLButtonElement;
        const icon = document.getElementById('smartIcon');
        const text = document.getElementById('smartText');
        
        if (!btn || !icon || !text) return;
        
        if (loading) {
            icon.textContent = '⏳';
            text.textContent = 'Loading...';
            btn.disabled = true;
            btn.className = 'smart-btn';
        } else {
            // reset to normal state
            this.updateSmartActionButton();
        }
    }

    async handleSmartAction(): Promise<void> {
        // get available count to determine action
        const availableCount = this.availableCoupons ? this.availableCoupons.filter(offer => {
            const originalOffer = offer.originalOffer || offer;
            return originalOffer.status !== 'C';
        }).length : 0;
        
        if (availableCount > 0 && !this.isClipping) {
            // start clipping
            await this.startClipping();
        } else if (!this.isClipping) {
            // just refresh
            await this.refreshCoupons();
        }
    }

    async startClipping(): Promise<void> {
        try {
            const unclippedOffers = this.allOffers.filter(offer => {
                const originalOffer = offer.originalOffer || offer;
                return originalOffer.status !== 'C';
            });
            
            // store any already-clipped coupons we find
            const alreadyClippedOffers = this.allOffers.filter(offer => {
                const originalOffer = offer.originalOffer || offer;
                const alreadyInMyClipped = this.myClippedCoupons.some(clipped => clipped.id === offer.id);
                return !alreadyInMyClipped && originalOffer.status === 'C';
            });
            
            if (alreadyClippedOffers.length > 0) {
                for (const offer of alreadyClippedOffers) {
                    const originalOffer = offer.originalOffer || offer;
                    this.myClippedCoupons.push({
                        ...offer,
                        status: 'clipped',
                        clipId: originalOffer.clipId,
                        clipTs: originalOffer.clipTs,
                        clippedDate: new Date().toISOString()
                    });
                }
                await chrome.storage.local.set({ clippedCoupons: this.myClippedCoupons });
                await this.updateDashboardStats();
            }
            
            if (unclippedOffers.length === 0) {
                return;
            }

            // start background clipping
            const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
            const response = await chrome.runtime.sendMessage({
                action: 'startBackgroundClipping',
                offers: unclippedOffers,
                tabId: activeTab.id
            }) as MessageResponse & { state: ClippingState };
            
            if (response?.success) {
                this.isClipping = true;
                this.clippingStats = response.state.currentStats;
                
                this.showClippingSection(true);
                
                this.updateSmartActionButton();
                
                this.updateClippingDisplay();
                
                this.startBackgroundProgressMonitoring();
                
                await this.updateDashboardStats();
            } else {
                throw new Error(response ? response.error : 'No response from background script');
            }

        } catch {
            this.showError('Failed to start clipping');
            await this.stopClipping();
        }
    }

    async stopClipping(): Promise<void> {
        this.isClipping = false;
        this.showClippingSection(false);
        this.stopBackgroundProgressMonitoring();
        
        await this.loadStoredData();
        await this.updateDashboardStats();
        this.updateSmartActionButton();
        
        this.loadMyCouponsData();
        
        chrome.runtime.sendMessage({
            action: 'stopClipping',
            finalStats: this.clippingStats
        });
    }

    async finishClipping(): Promise<void> {
        this.isClipping = false;
        
        chrome.runtime.sendMessage({
            action: 'stopClipping',
            finalStats: this.clippingStats
        });
        
        // immediately refresh offers data to get updated coupon statuses
        await this.loadDashboardData(true);
        
        // wait a bit for final storage updates, then do comprehensive refresh
        setTimeout(async () => {
            await this.loadStoredData();
            this.showClippingSection(false);
            this.updateSmartActionButton();
            await this.updateDashboardStats();
            
            this.loadMyCouponsData();
        }, 1000);
    }

    showClippingSection(show: boolean): void {
        const inlineProgress = document.getElementById('inlineProgress');
        if (inlineProgress) {
            inlineProgress.style.display = show ? 'flex' : 'none';
        }
    }

    updateClippingDisplay(): void {
        const { total, processed } = this.clippingStats;
        
        const counterEl = document.getElementById('clippingCounter');
        if (counterEl) {
            counterEl.textContent = `${processed} / ${total}`;
        }
        
        const progressFill = document.getElementById('progressFill');
        if (progressFill) {
            const percentage = total > 0 ? (processed / total) * 100 : 0;
            (progressFill as HTMLElement).style.width = `${percentage}%`;
        }
    }

    populateMyCouponsFilters(): void {
        const categoryFilter = document.getElementById('categoryFilter') as HTMLSelectElement;
        if (!categoryFilter) return;
        
        const categories = [...new Set(this.myClippedCoupons.map(coupon => coupon.primaryCategory))].sort();
        
        categoryFilter.replaceChildren();
        
        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = 'All Categories';
        categoryFilter.appendChild(defaultOption);
        
        categories.forEach(cat => {
            if (cat) {
                const option = document.createElement('option');
                option.value = cat;
                option.textContent = cat;
                categoryFilter.appendChild(option);
            }
        });
    }

    filterAndDisplayMyCoupons(resetPage = true): void {
        // reset to first page when filters change (but not when navigating pages)
        if (resetPage) {
            this.currentPage = 1;
        }
        
        // start by filtering out expired coupons by default
        let filtered = this.myClippedCoupons.filter(coupon => !isCouponExpired(coupon));

        if (this.searchQuery) {
            const query = this.searchQuery.toLowerCase();
            filtered = filtered.filter(coupon => 
                coupon.title.toLowerCase().includes(query) ||
                coupon.brand?.toLowerCase().includes(query) ||
                coupon.savingsAmount?.toLowerCase().includes(query)
            );
        }

        if (this.categoryFilter) {
            filtered = filtered.filter(coupon => coupon.primaryCategory === this.categoryFilter);
        }

        if (this.statusFilter) {
            filtered = filtered.filter(coupon => {
                const isExpiring = isCouponExpiringSoon(coupon);
                
                switch (this.statusFilter) {
                    case 'active':
                        return !isExpiring;
                    case 'expiring':
                        return isExpiring;
                    case 'expired':
                        return isCouponExpired(coupon);
                    default:
                        return true;
                }
            });
        }

        switch (this.sortFilter) {
            case 'recent':
                filtered.sort((a, b) => new Date(b.clippedDate || 0).getTime() - new Date(a.clippedDate || 0).getTime());
                break;
            case 'alphabetical':
                filtered.sort((a, b) => a.title.localeCompare(b.title));
                break;
            case 'expiry':
                filtered.sort((a, b) => {
                    const aDate = a.originalOffer?.endDate || a.validTo || '9999999999999';
                    const bDate = b.originalOffer?.endDate || b.validTo || '9999999999999';
                    return new Date(parseInt(aDate)).getTime() - new Date(parseInt(bDate)).getTime();
                });
                break;
        }
        
        this.displayMyCouponsWithSearch(filtered);
    }

    displayMyCouponsWithSearch(coupons: ClippedCoupon[]): void {
        const myCouponsList = document.getElementById('myCouponsList');
        if (!myCouponsList) return;
        
        // show loading state during initial load if no coupons yet
        if (this.isInitialLoad && this.myClippedCoupons.length === 0) {
            myCouponsList.replaceChildren();
            const loadingState = this.createEmptyState('⏳', 'Loading coupons...', 'Please wait while we load your clipped coupons');
            myCouponsList.appendChild(loadingState);
            this.hidePagination();
            return;
        }
        
        if (coupons.length === 0) {
            let emptyTitle: string, emptyText: string;
            if (this.myClippedCoupons.length === 0) {
                emptyTitle = 'No coupons yet';
                emptyText = 'Start clipping coupons to see them here';
            } else {
                emptyTitle = 'No matching coupons';
                emptyText = 'Try adjusting your search or filters';
            }
            
            myCouponsList.replaceChildren();
            const emptyState = this.createEmptyState('🎫', emptyTitle, emptyText);
            myCouponsList.appendChild(emptyState);
            this.hidePagination();
            return;
        }

        // calculate pagination
        const totalPages = Math.ceil(coupons.length / APP_CONFIG.ITEMS_PER_PAGE);
        const startIndex = (this.currentPage - 1) * APP_CONFIG.ITEMS_PER_PAGE;
        const endIndex = startIndex + APP_CONFIG.ITEMS_PER_PAGE;
        const paginatedCoupons = coupons.slice(startIndex, endIndex);

        this.displayTableView(paginatedCoupons, myCouponsList);
        this.updatePagination(coupons.length, totalPages);
    }

    displayTableView(coupons: ClippedCoupon[], container: HTMLElement): void {
        container.replaceChildren();
        const table = this.createCouponTable(coupons);
        container.appendChild(table);
    }

    createCouponTable(coupons: ClippedCoupon[]): HTMLTableElement {
        const table = document.createElement('table');
        table.className = 'coupon-table-element';
        
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        const headers = ['', 'Coupon', 'Amount', 'Details', 'Expires'];
        
        headers.forEach(headerText => {
            const th = document.createElement('th');
            th.textContent = headerText;
            headerRow.appendChild(th);
        });
        
        thead.appendChild(headerRow);
        table.appendChild(thead);
        
        const tbody = document.createElement('tbody');
        
        coupons.forEach(coupon => {
            const row = document.createElement('tr');
            row.className = 'coupon-row';
            row.dataset.couponId = coupon.id;
            
            const isExpiring = isCouponExpiringSoon(coupon);
            const isExpired = isCouponExpired(coupon);
            const offer = coupon.originalOffer || {};
            
            // image cell
            const imageCell = document.createElement('td');
            imageCell.className = 'coupon-image-cell';
            const img = document.createElement('img');
            img.className = 'coupon-table-image';
            img.src = coupon.displayImageUrl || getPlaceholderImage();
            img.alt = 'Coupon';
            img.onerror = function() { (this as HTMLImageElement).style.display = 'none'; };
            imageCell.appendChild(img);
            
            // title cell
            const titleCell = document.createElement('td');
            titleCell.className = 'coupon-title-cell';
            const titleDiv = document.createElement('div');
            titleDiv.className = 'coupon-table-title';
            titleDiv.textContent = truncateText(coupon.title, 50);
            titleCell.appendChild(titleDiv);
            
            // savings cell
            const savingsCell = document.createElement('td');
            savingsCell.className = 'coupon-savings-cell';
            const savingsDiv = document.createElement('div');
            savingsDiv.className = 'coupon-table-savings';
            let savingsDisplay = coupon.offerPrice || coupon.savingsAmount || 'Save';
            if (coupon.offerPrice && coupon.savingsAmount && 
                coupon.offerPrice.toLowerCase() === coupon.savingsAmount.toLowerCase()) {
                savingsDisplay = coupon.offerPrice;
            }
            savingsDiv.textContent = savingsDisplay;
            savingsCell.appendChild(savingsDiv);
            
            // details cell
            const detailsCell = document.createElement('td');
            detailsCell.className = 'coupon-details-cell';
            const detailsDiv = document.createElement('div');
            detailsDiv.className = 'coupon-table-details';
            const descriptionText = offer.description || offer.ecomDescription || '';
            const firstSentence = getFirstSentence(descriptionText);
            detailsDiv.textContent = firstSentence;
            detailsCell.appendChild(detailsDiv);
            
            // expiry cell
            const expiryCell = document.createElement('td');
            expiryCell.className = 'coupon-expiry-cell';
            const expiryDiv = document.createElement('div');
            expiryDiv.className = `coupon-table-expiry ${isExpiring ? 'expiring-soon' : (isExpired ? 'expired' : '')}`;
            expiryDiv.textContent = offer.endDate ? new Date(parseInt(offer.endDate)).toLocaleDateString() : 'No expiry';
            expiryCell.appendChild(expiryDiv);
            
            row.appendChild(imageCell);
            row.appendChild(titleCell);
            row.appendChild(savingsCell);
            row.appendChild(detailsCell);
            row.appendChild(expiryCell);
            
            tbody.appendChild(row);
        });
        
        table.appendChild(tbody);
        return table;
    }

    loadMyCouponsData(): void {
        this.populateMyCouponsFilters();
        this.filterAndDisplayMyCoupons();
        
        // mark initial load as complete
        if (this.isInitialLoad) {
            this.isInitialLoad = false;
        }
    }

    async clearData(): Promise<void> {
        if (!confirm('Are you sure you want to clear all data? This cannot be undone.')) {
            return;
        }

        try {
            await chrome.storage.local.clear();
            
            this.myClippedCoupons = [];
            this.clippingStats = { total: 0, processed: 0 };
            
            await this.loadDashboardData();
        } catch {
            this.showError('Failed to clear data');
        }
    }

    showCouponDetail(couponId: string): void {
        const coupon = this.myClippedCoupons.find(c => c.id === couponId);
        
        if (!coupon) return;
        
        const offer = coupon.originalOffer || {};
        
        // determine coupon status
        const isExpired = isCouponExpired(coupon);
        const isExpiring = isCouponExpiringSoon(coupon);
        
        const modal = document.createElement('div');
        modal.className = 'coupon-modal-overlay';
        const modalContent = this.createCouponModalContent(coupon, offer, isExpired, isExpiring);
        modal.appendChild(modalContent);
        
        modal.addEventListener('click', (e) => {
            if (e.target === modal || (e.target as HTMLElement).classList.contains('close-btn')) {
                modal.remove();
            }
        });
        
        document.body.appendChild(modal);
    }

    createEmptyState(icon: string, title: string, text: string): HTMLElement {
        const container = document.createElement('div');
        container.className = 'empty-state';
        
        const iconEl = document.createElement('div');
        iconEl.className = 'empty-state-icon';
        iconEl.textContent = icon;
        
        const titleEl = document.createElement('div');
        titleEl.className = 'empty-state-title';
        titleEl.textContent = title;
        
        const textEl = document.createElement('div');
        textEl.className = 'empty-state-text';
        textEl.textContent = text;
        
        container.appendChild(iconEl);
        container.appendChild(titleEl);
        container.appendChild(textEl);
        
        return container;
    }

    createCouponModalContent(coupon: ClippedCoupon, offer: any, isExpired: boolean, isExpiring: boolean): HTMLElement {
        const modalDiv = document.createElement('div');
        modalDiv.className = 'coupon-modal';
        
        const closeBtn = document.createElement('button');
        closeBtn.className = 'close-btn';
        closeBtn.textContent = '×';
        modalDiv.appendChild(closeBtn);
        
        const heroDiv = document.createElement('div');
        heroDiv.className = 'hero-compact';
        
        const heroLeft = document.createElement('div');
        heroLeft.className = 'hero-left';
        
        const img = document.createElement('img');
        img.src = coupon.displayImageUrl || getPlaceholderImage();
        img.alt = 'Coupon';
        img.className = 'coupon-img';
        heroLeft.appendChild(img);
        
        const savingsAmount = document.createElement('div');
        savingsAmount.className = 'savings-amount';
        savingsAmount.textContent = coupon.offerPrice || coupon.savingsAmount || 'Save';
        heroLeft.appendChild(savingsAmount);
        
        const heroCenter = document.createElement('div');
        heroCenter.className = 'hero-center';
        
        const title = document.createElement('div');
        title.className = 'coupon-title';
        title.textContent = truncateText(coupon.title, 35);
        heroCenter.appendChild(title);
        
        if (coupon.brand && coupon.brand.toLowerCase() !== coupon.title.toLowerCase()) {
            const brand = document.createElement('div');
            brand.className = 'brand';
            brand.textContent = coupon.brand;
            heroCenter.appendChild(brand);
        }
        
        const status = document.createElement('div');
        status.className = `status ${isExpired ? 'expired' : (isExpiring ? 'expiring' : 'active')}`;
        status.textContent = isExpired ? 'Expired' : (isExpiring ? 'Expiring Soon' : 'Active');
        heroCenter.appendChild(status);
        
        if (coupon.primaryCategory) {
            const category = document.createElement('div');
            category.className = 'category';
            category.textContent = coupon.primaryCategory;
            heroCenter.appendChild(category);
        }
        
        const heroRight = document.createElement('div');
        heroRight.className = 'hero-right-info';
        
        if (offer.offerEndDate || offer.endDate) {
            const infoItem = document.createElement('div');
            infoItem.className = `info-item ${isExpiring ? 'warn' : (isExpired ? 'error' : '')}`;
            
            const label = document.createElement('span');
            label.className = 'info-label';
            label.textContent = 'Expires';
            
            const value = document.createElement('span');
            value.className = 'info-value';
            value.textContent = new Date(parseInt(offer.offerEndDate || offer.endDate)).toLocaleDateString();
            
            infoItem.appendChild(label);
            infoItem.appendChild(value);
            heroRight.appendChild(infoItem);
        }
        
        heroDiv.appendChild(heroLeft);
        heroDiv.appendChild(heroCenter);
        heroDiv.appendChild(heroRight);
        modalDiv.appendChild(heroDiv);
        
        // description
        if (offer.description || offer.ecomDescription) {
            const description = document.createElement('div');
            description.className = 'description';
            const formattedHTML = formatDescription(offer.description || offer.ecomDescription);
            const parser = new DOMParser();
            const doc = parser.parseFromString(formattedHTML, 'text/html');
            description.replaceChildren(...Array.from(doc.body.childNodes));
            modalDiv.appendChild(description);
        }
        
        return modalDiv;
    }

    previousPage(): void {
        if (this.currentPage > 1) {
            this.currentPage--;
            this.filterAndDisplayMyCoupons(false);
        }
    }

    nextPage(): void {
        const totalCoupons = this.getFilteredCoupons().length;
        const totalPages = Math.ceil(totalCoupons / APP_CONFIG.ITEMS_PER_PAGE);
        
        if (this.currentPage < totalPages) {
            this.currentPage++;
            this.filterAndDisplayMyCoupons(false);
        }
    }

    goToPage(page: number): void {
        const totalCoupons = this.getFilteredCoupons().length;
        const totalPages = Math.ceil(totalCoupons / APP_CONFIG.ITEMS_PER_PAGE);
        
        if (page >= 1 && page <= totalPages) {
            this.currentPage = page;
            this.filterAndDisplayMyCoupons(false);
        }
    }

    getFilteredCoupons(): ClippedCoupon[] {
        let filtered = this.myClippedCoupons.filter(coupon => !isCouponExpired(coupon));

        if (this.searchQuery) {
            const query = this.searchQuery.toLowerCase();
            filtered = filtered.filter(coupon => 
                coupon.title.toLowerCase().includes(query) ||
                coupon.brand?.toLowerCase().includes(query) ||
                coupon.savingsAmount?.toLowerCase().includes(query)
            );
        }

        if (this.categoryFilter) {
            filtered = filtered.filter(coupon => coupon.primaryCategory === this.categoryFilter);
        }

        if (this.statusFilter) {
            const statusFilterMap: Record<string, (coupon: ClippedCoupon) => boolean> = {
                'active': (coupon) => !isCouponExpiringSoon(coupon),
                'expiring': (coupon) => isCouponExpiringSoon(coupon),
                'expired': (coupon) => isCouponExpired(coupon)
            };
            
            const filterFn = statusFilterMap[this.statusFilter];
            if (filterFn) {
                filtered = filtered.filter(filterFn);
            }
        }

        return filtered;
    }

    updatePagination(totalItems: number, totalPages: number): void {
        const paginationContainer = document.getElementById('paginationContainer');
        const paginationInfo = document.getElementById('paginationInfo');
        const prevBtn = document.getElementById('prevPageBtn') as HTMLButtonElement;
        const nextBtn = document.getElementById('nextPageBtn') as HTMLButtonElement;
        const pageNumbers = document.getElementById('pageNumbers');

        if (!paginationContainer || !paginationInfo || !prevBtn || !nextBtn || !pageNumbers) return;

        // show pagination if there are items
        if (totalItems === 0) {
            paginationContainer.style.display = 'none';
            return;
        }

        paginationContainer.style.display = 'flex';

        // update info
        const startItem = (this.currentPage - 1) * APP_CONFIG.ITEMS_PER_PAGE + 1;
        const endItem = Math.min(this.currentPage * APP_CONFIG.ITEMS_PER_PAGE, totalItems);
        paginationInfo.textContent = `${startItem}-${endItem} of ${totalItems}`;

        // update buttons
        prevBtn.disabled = this.currentPage === 1;
        nextBtn.disabled = this.currentPage === totalPages;

        // update page numbers (show up to 5 pages)
        pageNumbers.replaceChildren();
        
        if (totalPages > 1) {
            const maxPagesToShow = APP_CONFIG.MAX_VISIBLE_PAGES;
            let startPage = Math.max(1, this.currentPage - Math.floor(maxPagesToShow / 2));
            const endPage = Math.min(totalPages, startPage + maxPagesToShow - 1);
            
            if (endPage - startPage + 1 < maxPagesToShow) {
                startPage = Math.max(1, endPage - maxPagesToShow + 1);
            }

            for (let i = startPage; i <= endPage; i++) {
                const pageBtn = document.createElement('button');
                pageBtn.className = `page-number-btn ${i === this.currentPage ? 'active' : ''}`;
                pageBtn.textContent = i.toString();
                pageBtn.addEventListener('click', () => this.goToPage(i));
                pageNumbers.appendChild(pageBtn);
            }
        } else {
            // show page 1 button even for single page
            const pageBtn = document.createElement('button');
            pageBtn.className = 'page-number-btn active';
            pageBtn.textContent = '1';
            pageBtn.disabled = true;
            pageNumbers.appendChild(pageBtn);
        }
    }

    hidePagination(): void {
        const paginationContainer = document.getElementById('paginationContainer');
        if (paginationContainer) {
            paginationContainer.style.display = 'none';
        }
    }

    showLoading(show: boolean, text = 'Loading...'): void {
        const overlay = document.getElementById('loadingOverlay');
        const loadingText = document.getElementById('loadingText');
        
        if (!overlay || !loadingText) return;
        
        if (show) {
            loadingText.textContent = text;
            overlay.classList.add('active');
        } else {
            overlay.classList.remove('active');
        }
    }

    showGuidance(type: string, message: string): void {
        const messagesDiv = document.getElementById('statusMessages');
        if (!messagesDiv) return;
        
        let alertClass = 'info';
        
        if (type === 'navigate' || type === 'refresh' || type === 'login') {
            alertClass = 'warning';
        }
        
        messagesDiv.replaceChildren();
        const alert = document.createElement('div');
        alert.className = `alert ${alertClass}`;
        const span = document.createElement('span');
        span.textContent = message;
        alert.appendChild(span);
        messagesDiv.appendChild(alert);
    }

    showError(message: string): void {
        const messagesDiv = document.getElementById('statusMessages');
        if (!messagesDiv) return;
        
        const alert = document.createElement('div');
        alert.className = 'alert danger';
        const span = document.createElement('span');
        span.textContent = message;
        alert.appendChild(span);
        
        messagesDiv.appendChild(alert);
        
        setTimeout(() => {
            if (alert.parentNode) {
                alert.parentNode.removeChild(alert);
            }
        }, 5000);
    }
}

let app: GroceryAutoClipApp | undefined;
document.addEventListener('DOMContentLoaded', async () => {
    app = new GroceryAutoClipApp();
});

window.addEventListener('beforeunload', () => {
    if (app && (app as any)['backgroundMonitor']) {
        clearInterval((app as any)['backgroundMonitor']);
        (app as any)['backgroundMonitor'] = null;
    }
});

(window as any).app = app;