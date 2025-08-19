// Ultra-Conservative Batch Processor for Appwrite Free Tier
// Designed specifically for 60 requests/hour limit (1 request per minute)
// Optimizes for minimal API calls and maximum data processing per request

class FreeTierOptimizedProcessor {
  constructor(appwriteClient, databaseId, collectionId) {
    this.databases = appwriteClient;
    this.databaseId = databaseId;
    this.collectionId = collectionId;
    
    // Free tier specific constraints
    this.constraints = {
      maxRequestsPerHour: 60,         // 60 requests per hour
      requestIntervalMs: 60000,       // 1 minute between requests
      maxDocsPerRequest: 100,         // Maximum documents per API call
      maxBandwidthMB: 5000,          // 5GB monthly bandwidth limit
      safeBandwidthMB: 4000          // Stay under 4GB to be safe
    };
    
    // Request tracking
    this.requestHistory = [];
    this.totalBandwidthUsed = 0;
    this.isRateLimited = false;
    this.lastRequestTime = 0;
    
    // Load request history from localStorage
    this.loadRequestHistory();
  }

  // Load request history to track hourly usage
  loadRequestHistory() {
    try {
      const history = localStorage.getItem('appwriteRequestHistory');
      if (history) {
        this.requestHistory = JSON.parse(history);
        // Clean old requests (older than 1 hour)
        const oneHourAgo = Date.now() - (60 * 60 * 1000);
        this.requestHistory = this.requestHistory.filter(req => req.timestamp > oneHourAgo);
      }
    } catch (e) {
      console.warn('Could not load request history:', e);
      this.requestHistory = [];
    }
  }

  // Save request history
  saveRequestHistory() {
    try {
      localStorage.setItem('appwriteRequestHistory', JSON.stringify(this.requestHistory));
    } catch (e) {
      console.warn('Could not save request history:', e);
    }
  }

  // Check if we can make a request without hitting rate limits
  canMakeRequest() {
    const now = Date.now();
    const oneHourAgo = now - (60 * 60 * 1000);
    
    // Clean old requests
    this.requestHistory = this.requestHistory.filter(req => req.timestamp > oneHourAgo);
    
    // Check hourly limit
    if (this.requestHistory.length >= this.constraints.maxRequestsPerHour) {
      return false;
    }
    
    // Check minimum interval between requests
    if (now - this.lastRequestTime < this.constraints.requestIntervalMs) {
      return false;
    }
    
    return true;
  }

  // Calculate time until next request is allowed
  getTimeUntilNextRequest() {
    const now = Date.now();
    const oneHourAgo = now - (60 * 60 * 1000);
    
    // Clean old requests
    this.requestHistory = this.requestHistory.filter(req => req.timestamp > oneHourAgo);
    
    // If we've hit hourly limit, wait until oldest request expires
    if (this.requestHistory.length >= this.constraints.maxRequestsPerHour) {
      const oldestRequest = Math.min(...this.requestHistory.map(r => r.timestamp));
      return (oldestRequest + (60 * 60 * 1000)) - now;
    }
    
    // Check minimum interval
    const timeSinceLastRequest = now - this.lastRequestTime;
    if (timeSinceLastRequest < this.constraints.requestIntervalMs) {
      return this.constraints.requestIntervalMs - timeSinceLastRequest;
    }
    
    return 0;
  }

  // Make a request with rate limit tracking
  async makeTrackedRequest(requestFn, description) {
    if (!this.canMakeRequest()) {
      const waitTime = this.getTimeUntilNextRequest();
      throw new Error(`Rate limit reached. Next request available in ${Math.ceil(waitTime / 1000)} seconds`);
    }
    
    const startTime = Date.now();
    
    try {
      this.showStatus(`🔄 ${description} (Rate limit: ${this.requestHistory.length}/60 requests this hour)`, 'processing');
      
      const result = await requestFn();
      
      // Track the request
      this.requestHistory.push({
        timestamp: startTime,
        description,
        success: true
      });
      this.lastRequestTime = startTime;
      this.saveRequestHistory();
      
      // Check for rate limit headers
      if (result.headers) {
        const remaining = result.headers['X-RateLimit-Remaining'];
        const reset = result.headers['X-RateLimit-Reset'];
        
        if (remaining !== undefined) {
          this.showStatus(`📊 Rate limit status: ${remaining} requests remaining`, 'info');
        }
      }
      
      return result;
      
    } catch (error) {
      // Track failed request
      this.requestHistory.push({
        timestamp: startTime,
        description,
        success: false,
        error: error.message
      });
      this.saveRequestHistory();
      
      // Check if it's a rate limit error
      if (error.code === 429 || error.message?.includes('rate') || error.message?.includes('limit')) {
        this.isRateLimited = true;
        this.showStatus('🚫 Rate limit exceeded - implementing emergency slowdown', 'error');
        
        // Emergency backoff - wait 5 minutes
        const waitTime = 5 * 60 * 1000;
        this.showStatus(`⏳ Emergency wait: ${waitTime / 60000} minutes before retry`, 'warning');
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
      
      throw error;
    }
  }

  // Ultra-efficient fetch that maximizes data per request
  async fetchAllReceiptsUltraEfficient(onProgress = null) {
    const receipts = [];
    let offset = 0;
    const limit = this.constraints.maxDocsPerRequest; // Get maximum docs per request
    let totalFetched = 0;
    
    this.showStatus('🐌 Ultra-efficient fetch for FREE TIER (60 requests/hour limit)', 'info');
    
    try {
      while (true) {
        // Check if we can make the request
        if (!this.canMakeRequest()) {
          const waitTime = this.getTimeUntilNextRequest();
          this.showStatus(`⏳ Rate limit protection: waiting ${Math.ceil(waitTime / 1000)}s before next request...`, 'warning');
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
        
        const response = await this.makeTrackedRequest(async () => {
          return await this.databases.listDocuments(
            this.databaseId,
            this.collectionId,
            [
              Appwrite.Query.limit(limit),
              Appwrite.Query.offset(offset),
              Appwrite.Query.orderDesc('$createdAt')
            ]
          );
        }, `Fetching receipts ${offset}-${offset + limit}`);
        
        receipts.push(...response.documents);
        totalFetched += response.documents.length;
        
        if (onProgress) {
          onProgress({ 
            fetched: totalFetched, 
            phase: 'fetch',
            requestsUsed: this.requestHistory.length,
            requestsRemaining: this.constraints.maxRequestsPerHour - this.requestHistory.length
          });
        }
        
        // Break if we got fewer documents than requested (last page)
        if (response.documents.length < limit) {
          break;
        }
        
        offset += limit;
        
        // Progress update
        this.showStatus(`📥 Fetched ${totalFetched} receipts (${this.requestHistory.length}/60 API calls used)`, 'processing');
        
        // Mandatory wait between requests (free tier protection)
        this.showStatus('⏳ Free tier protection: 60-second wait between requests...', 'info');
        await new Promise(resolve => setTimeout(resolve, this.constraints.requestIntervalMs));
      }
      
      this.showStatus(`✅ Fetch complete: ${receipts.length} receipts (${this.requestHistory.length}/60 API calls used)`, 'success');
      return receipts;
      
    } catch (error) {
      this.showStatus(`❌ Fetch failed: ${error.message}`, 'error');
      throw error;
    }
  }

  // Ultra-conservative update strategy for free tier
  async updateReceiptsUltraConservative(receipts, onProgress = null) {
    // Filter receipts that actually need updates
    const receiptsToUpdate = receipts.filter(receipt => 
      receipt.resolvedCommonId && 
      (!receipt.commonId || receipt.commonId !== receipt.resolvedCommonId)
    );
    
    if (receiptsToUpdate.length === 0) {
      this.showStatus('✅ No receipts need updating', 'success');
      return 0;
    }
    
    this.showStatus(`📝 Ultra-conservative update for FREE TIER: ${receiptsToUpdate.length} receipts need updating`, 'info');
    
    // For free tier, we need to be extremely conservative
    // Update one receipt per minute to stay within limits
    let updatedCount = 0;
    let errorCount = 0;
    
    for (let i = 0; i < receiptsToUpdate.length; i++) {
      const receipt = receiptsToUpdate[i];
      
      try {
        // Check rate limits before each update
        if (!this.canMakeRequest()) {
          const waitTime = this.getTimeUntilNextRequest();
          this.showStatus(`⏳ Rate limit reached: waiting ${Math.ceil(waitTime / 60000)} minutes...`, 'warning');
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
        
        await this.makeTrackedRequest(async () => {
          return await this.databases.updateDocument(
            this.databaseId,
            this.collectionId,
            receipt.$id,
            { commonId: receipt.resolvedCommonId }
          );
        }, `Updating receipt ${i + 1}/${receiptsToUpdate.length}`);
        
        receipt.commonId = receipt.resolvedCommonId;
        updatedCount++;
        
        // Progress reporting
        if (onProgress) {
          onProgress({
            updated: updatedCount,
            total: receiptsToUpdate.length,
            errors: errorCount,
            phase: 'update',
            requestsUsed: this.requestHistory.length,
            requestsRemaining: this.constraints.maxRequestsPerHour - this.requestHistory.length
          });
        }
        
        // Show progress every 10 updates
        if (updatedCount % 10 === 0 || updatedCount === receiptsToUpdate.length) {
          this.showStatus(
            `📝 Updated ${updatedCount}/${receiptsToUpdate.length} receipts (${this.requestHistory.length}/60 API calls used)`,
            'processing'
          );
        }
        
        // Mandatory wait between updates (free tier requirement)
        if (i < receiptsToUpdate.length - 1) { // Don't wait after the last update
          this.showStatus('⏳ Free tier protection: 60-second wait between updates...', 'info');
          await new Promise(resolve => setTimeout(resolve, this.constraints.requestIntervalMs));
        }
        
      } catch (error) {
        console.warn(`Update failed for receipt ${receipt.$id}:`, error);
        errorCount++;
        
        // If we hit rate limits, implement emergency backoff
        if (error.code === 429) {
          this.showStatus('🚫 Rate limit hit - implementing 5-minute emergency backoff', 'error');
          await new Promise(resolve => setTimeout(resolve, 5 * 60 * 1000));
        }
      }
    }
    
    const requestsUsed = this.requestHistory.length;
    const requestsRemaining = this.constraints.maxRequestsPerHour - requestsUsed;
    
    this.showStatus(
      `✅ Ultra-conservative update complete: ${updatedCount}/${receiptsToUpdate.length} updated, ${errorCount} errors. API usage: ${requestsUsed}/60`,
      updatedCount > 0 ? 'success' : 'warning'
    );
    
    if (requestsRemaining < 10) {
      this.showStatus(
        `⚠️ WARNING: Only ${requestsRemaining} API requests remaining this hour. Consider waiting before next operation.`,
        'warning'
      );
    }
    
    return updatedCount;
  }

  // Estimate processing time for free tier
  estimateFreeTierProcessingTime(receiptCount) {
    const requestsForFetch = Math.ceil(receiptCount / this.constraints.maxDocsPerRequest);
    const requestsForUpdate = receiptCount; // Worst case: every receipt needs update
    const totalRequests = requestsForFetch + requestsForUpdate;
    
    // At 1 request per minute
    const estimatedMinutes = totalRequests;
    const estimatedHours = Math.ceil(estimatedMinutes / 60);
    
    return {
      fetchRequests: requestsForFetch,
      updateRequests: requestsForUpdate,
      totalRequests,
      estimatedMinutes,
      estimatedHours,
      exceedsHourlyLimit: totalRequests > this.constraints.maxRequestsPerHour,
      recommendedApproach: totalRequests > this.constraints.maxRequestsPerHour ? 
        'Process in multiple sessions spread across several hours' : 
        'Can complete in one session'
    };
  }

  // Show current rate limit status
  getRateLimitStatus() {
    const now = Date.now();
    const oneHourAgo = now - (60 * 60 * 1000);
    
    // Clean old requests
    this.requestHistory = this.requestHistory.filter(req => req.timestamp > oneHourAgo);
    
    const requestsUsed = this.requestHistory.length;
    const requestsRemaining = this.constraints.maxRequestsPerHour - requestsUsed;
    const timeUntilReset = this.getTimeUntilNextRequest();
    
    return {
      requestsUsed,
      requestsRemaining,
      hourlyLimit: this.constraints.maxRequestsPerHour,
      timeUntilNextRequest: timeUntilReset,
      canMakeRequest: this.canMakeRequest(),
      formattedWait: this.formatTime(timeUntilReset / 1000)
    };
  }

  // Format time in a readable way
  formatTime(seconds) {
    if (seconds < 60) {
      return `${Math.ceil(seconds)}s`;
    } else if (seconds < 3600) {
      return `${Math.ceil(seconds / 60)}m`;
    } else {
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.ceil((seconds % 3600) / 60);
      return `${hours}h ${minutes}m`;
    }
  }

  // Status display helper
  showStatus(message, type) {
    if (window.showProcessingStatus) {
      window.showProcessingStatus(message, type);
    } else {
      console.log(`[${type.toUpperCase()}] ${message}`);
    }
  }

  // Emergency: Check if we should abort due to rate limits
  shouldAbortDueToRateLimits() {
    const status = this.getRateLimitStatus();
    
    // If we have very few requests remaining, suggest aborting
    if (status.requestsRemaining < 5) {
      return {
        shouldAbort: true,
        reason: `Only ${status.requestsRemaining} API requests remaining this hour`,
        suggestion: 'Wait until rate limits reset or upgrade to Pro plan'
      };
    }
    
    return { shouldAbort: false };
  }
}

// Export for use in other files
if (typeof window !== 'undefined') {
  window.FreeTierOptimizedProcessor = FreeTierOptimizedProcessor;
}
