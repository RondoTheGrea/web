// Optimized Batch Processing System for Large Receipt Processing
// Implements multiple optimization strategies to handle 5000+ receipts efficiently

class OptimizedBatchProcessor {
  constructor(appwriteClient, databaseId, collectionId) {
    this.databases = appwriteClient;
    this.databaseId = databaseId;
    this.collectionId = collectionId;
    
    // FREE TIER OPTIMIZED Rate limiting configuration
    this.rateLimits = {
      maxConcurrent: 1,           // FREE TIER: Only 1 request at a time
      requestsPerHour: 50,        // FREE TIER: 60/hour limit, use 50 for safety
      requestsPerMinute: 1,       // FREE TIER: Spread requests over time
      retryDelays: [5000, 10000, 30000, 60000], // Longer delays for free tier
      maxRetries: 3,              // Fewer retries to save quota
      batchProcessingDelay: 2000  // 2 second delay between batches
    };
    
    // Free tier optimized batch configuration
    this.batchConfig = {
      processingBatchSize: 200,   // Large batches for local processing
      updateBatchSize: 1,         // FREE TIER: 1 update at a time
      fetchBatchSize: 100,        // Large fetch batches to minimize requests
      progressUpdateInterval: 50, // Less frequent UI updates
      saveProgressInterval: 100   // Save progress frequently for resumption
    };
    
    // Performance tracking
    this.metrics = {
      totalProcessed: 0,
      totalUpdated: 0,
      totalErrors: 0,
      startTime: null,
      updateStartTime: null,
      retryCount: 0,
      requestsThisHour: 0,
      lastHourReset: Date.now()
    };
    
    // Request queue for free tier management
    this.requestQueue = [];
    this.isProcessingQueue = false;
    this.lastRequestTime = 0;
    
    // Load previous session data for resumption
    this.loadSessionProgress();
  }

  // Load session progress for resumption capability
  loadSessionProgress() {
    try {
      const progressData = localStorage.getItem('freeTierProcessingProgress');
      if (progressData) {
        const progress = JSON.parse(progressData);
        this.metrics.totalUpdated = progress.totalUpdated || 0;
        this.metrics.requestsThisHour = progress.requestsThisHour || 0;
        this.lastHourReset = progress.lastHourReset || Date.now();
        
        // Reset hourly counter if more than an hour has passed
        if (Date.now() - this.lastHourReset > 3600000) {
          this.metrics.requestsThisHour = 0;
          this.lastHourReset = Date.now();
        }
      }
    } catch (error) {
      console.warn('Could not load session progress:', error);
    }
  }

  // Save session progress for resumption
  saveSessionProgress() {
    try {
      const progressData = {
        totalUpdated: this.metrics.totalUpdated,
        requestsThisHour: this.metrics.requestsThisHour,
        lastHourReset: this.lastHourReset,
        timestamp: Date.now()
      };
      localStorage.setItem('freeTierProcessingProgress', JSON.stringify(progressData));
    } catch (error) {
      console.warn('Could not save session progress:', error);
    }
  }

  // Check if we're approaching rate limits
  isNearRateLimit() {
    // Reset hourly counter if needed
    if (Date.now() - this.lastHourReset > 3600000) {
      this.metrics.requestsThisHour = 0;
      this.lastHourReset = Date.now();
    }
    
    return this.metrics.requestsThisHour >= this.rateLimits.requestsPerHour;
  }

  // Calculate wait time until next request is allowed
  getWaitTimeUntilNextRequest() {
    const timeSinceLastRequest = Date.now() - this.lastRequestTime;
    const minTimeBetweenRequests = 60000 / this.rateLimits.requestsPerMinute; // 60 seconds for free tier
    
    if (timeSinceLastRequest < minTimeBetweenRequests) {
      return minTimeBetweenRequests - timeSinceLastRequest;
    }
    
    return 0;
  }

  // FREE TIER: Sequential update system with strict rate limiting
  async updateReceiptsFreeTierOptimized(receipts, onProgress = null) {
    this.metrics.updateStartTime = Date.now();
    
    // Filter receipts that need updates
    const receiptsToUpdate = receipts.filter(receipt => 
      receipt.resolvedCommonId && 
      (!receipt.commonId || receipt.commonId !== receipt.resolvedCommonId)
    );

    if (receiptsToUpdate.length === 0) {
      this.showStatus('✅ No receipts need updating', 'success');
      return 0;
    }

    this.showStatus(`📝 FREE TIER: Processing ${receiptsToUpdate.length} receipts with strict rate limiting...`, 'processing');

    // Check if we can start processing
    if (this.isNearRateLimit()) {
      const timeUntilReset = 3600000 - (Date.now() - this.lastHourReset);
      const minutesLeft = Math.ceil(timeUntilReset / 60000);
      
      this.showStatus(`⏰ FREE TIER: Rate limit reached (${this.metrics.requestsThisHour}/50). Wait ${minutesLeft} minutes or continue tomorrow.`, 'warning');
      
      if (confirm(`You've reached the free tier rate limit. Wait ${minutesLeft} minutes to continue, or click OK to save progress and resume later.`)) {
        this.saveSessionProgress();
        return this.metrics.totalUpdated;
      }
    }

    // Process updates one by one with delays
    let processedInThisSession = 0;
    const maxRequestsThisSession = this.rateLimits.requestsPerHour - this.metrics.requestsThisHour;

    for (let i = 0; i < receiptsToUpdate.length && processedInThisSession < maxRequestsThisSession; i++) {
      const receipt = receiptsToUpdate[i];
      
      // Wait if needed to respect rate limits
      const waitTime = this.getWaitTimeUntilNextRequest();
      if (waitTime > 0) {
        this.showStatus(`⏱️ FREE TIER: Waiting ${Math.ceil(waitTime/1000)}s to respect rate limits...`, 'processing');
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }

      try {
        // Update single document
        await this.executeWithFreeTierRetry(async () => {
          return await this.databases.updateDocument(
            this.databaseId,
            this.collectionId,
            receipt.$id,
            { commonId: receipt.resolvedCommonId }
          );
        });

        // Update tracking
        receipt.commonId = receipt.resolvedCommonId;
        this.metrics.totalUpdated++;
        processedInThisSession++;
        this.metrics.requestsThisHour++;
        this.lastRequestTime = Date.now();

        // Progress reporting
        if (this.metrics.totalUpdated % this.batchConfig.progressUpdateInterval === 0) {
          const progressPercent = Math.round((this.metrics.totalUpdated / receiptsToUpdate.length) * 100);
          const remaining = receiptsToUpdate.length - this.metrics.totalUpdated;
          const requestsLeft = this.rateLimits.requestsPerHour - this.metrics.requestsThisHour;
          
          this.showStatus(
            `📝 FREE TIER: ${this.metrics.totalUpdated}/${receiptsToUpdate.length} updated (${progressPercent}%) - ${requestsLeft} requests left this hour`,
            'processing'
          );

          if (onProgress) {
            onProgress({ 
              updated: this.metrics.totalUpdated, 
              total: receiptsToUpdate.length,
              remaining: remaining,
              requestsLeft: requestsLeft,
              phase: 'update' 
            });
          }
        }

        // Save progress periodically
        if (this.metrics.totalUpdated % this.batchConfig.saveProgressInterval === 0) {
          this.saveSessionProgress();
        }

        // Check if we're approaching rate limit
        if (this.metrics.requestsThisHour >= this.rateLimits.requestsPerHour - 5) {
          this.showStatus('⚠️ FREE TIER: Approaching rate limit. Saving progress...', 'warning');
          this.saveSessionProgress();
          break;
        }

      } catch (error) {
        this.metrics.totalErrors++;
        console.warn(`FREE TIER: Update failed for receipt ${receipt.$id}:`, error);
        
        if (error.code === 429) {
          this.showStatus('🛑 FREE TIER: Rate limit hit. Saving progress for later resumption...', 'error');
          this.saveSessionProgress();
          break;
        }
      }
    }

    // Final progress save
    this.saveSessionProgress();

    const updateTime = (Date.now() - this.metrics.updateStartTime) / 1000;
    const remaining = receiptsToUpdate.length - this.metrics.totalUpdated;

    if (remaining > 0) {
      this.showStatus(
        `⏸️ FREE TIER: Session paused. ${this.metrics.totalUpdated}/${receiptsToUpdate.length} completed. ${remaining} remaining. Resume tomorrow or upgrade to Pro.`,
        'warning'
      );
    } else {
      this.showStatus(
        `✅ FREE TIER: All updates complete! ${this.metrics.totalUpdated} receipts updated in ${updateTime.toFixed(1)}s`,
        'success'
      );
    }

    return this.metrics.totalUpdated;
  }

  // Smart fetch with pagination and progress tracking  
  async fetchAllReceiptsOptimized(onProgress = null) {
    const receipts = [];
    let offset = 0;
    const limit = this.batchConfig.fetchBatchSize;
    
    this.showStatus('📥 Optimized fetch: Starting receipt retrieval...', 'processing');
    
    try {
      while (true) {
        const response = await this.executeWithRetry(async () => {
          return await this.databases.listDocuments(
            this.databaseId,
            this.collectionId,
            [
              Appwrite.Query.limit(limit),
              Appwrite.Query.offset(offset),
              Appwrite.Query.orderDesc('$createdAt')
            ]
          );
        });
        
        receipts.push(...response.documents);
        
        if (response.documents.length < limit) {
          break;
        }
        
        offset += limit;
        
        // Smart progress reporting
        if (offset % (limit * 5) === 0) { // Every 500 receipts
          this.showStatus(`📥 Fetched ${receipts.length} receipts...`, 'processing');
          if (onProgress) onProgress({ fetched: receipts.length, phase: 'fetch' });
        }
      }
      
      this.showStatus(`✅ Fetch complete: ${receipts.length} receipts loaded`, 'success');
      return receipts;
      
    } catch (error) {
      this.showStatus(`❌ Fetch failed: ${error.message}`, 'error');
      throw error;
    }
  }

  // Optimized customer resolution processing
  async processCustomerResolutionOptimized(receipts, customerService, onProgress = null) {
    this.metrics.startTime = Date.now();
    this.metrics.totalProcessed = 0;
    
    const batchSize = this.batchConfig.processingBatchSize;
    const totalReceipts = receipts.length;
    
    this.showStatus(`🔄 Processing ${totalReceipts} receipts in optimized batches of ${batchSize}...`, 'processing');
    
    // Process in larger batches for better performance
    for (let i = 0; i < receipts.length; i += batchSize) {
      const batch = receipts.slice(i, i + batchSize);
      const batchNumber = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(receipts.length / batchSize);
      
      // Process this batch
      const batchResults = customerService.processNewReceipts(batch);
      this.metrics.totalProcessed += batchResults.processedCount;
      
      // Progress reporting with reduced frequency
      if (batchNumber % 5 === 0 || i + batchSize >= receipts.length) {
        const progressPercent = Math.round((this.metrics.totalProcessed / totalReceipts) * 100);
        this.showStatus(
          `🔄 Resolved ${this.metrics.totalProcessed}/${totalReceipts} receipts (${progressPercent}%)`, 
          'processing'
        );
        
        if (onProgress) {
          onProgress({ 
            processed: this.metrics.totalProcessed, 
            total: totalReceipts, 
            phase: 'resolution' 
          });
        }
      }
      
      // Minimal delay to prevent UI blocking
      if (batchNumber % 10 === 0) {
        await new Promise(resolve => setTimeout(resolve, 5));
      }
    }
    
    const processingTime = (Date.now() - this.metrics.startTime) / 1000;
    this.showStatus(`✅ Resolution complete: ${this.metrics.totalProcessed} receipts in ${processingTime.toFixed(1)}s`, 'success');
    
    return this.metrics.totalProcessed;
  }

  // Advanced concurrent update system with rate limiting
  async updateReceiptsOptimized(receipts, onProgress = null) {
    this.metrics.updateStartTime = Date.now();
    this.metrics.totalUpdated = 0;
    this.metrics.totalErrors = 0;
    this.metrics.retryCount = 0;
    
    // Filter receipts that need updates
    const receiptsToUpdate = receipts.filter(receipt => 
      receipt.resolvedCommonId && 
      (!receipt.commonId || receipt.commonId !== receipt.resolvedCommonId)
    );
    
    if (receiptsToUpdate.length === 0) {
      this.showStatus('✅ No receipts need updating', 'success');
      return 0;
    }
    
    this.showStatus(`📝 Optimized update: Processing ${receiptsToUpdate.length} receipts with smart batching...`, 'processing');
    
    // Process updates with advanced concurrency control
    await this.processUpdatesWithConcurrencyControl(receiptsToUpdate, onProgress);
    
    const updateTime = (Date.now() - this.metrics.updateStartTime) / 1000;
    const rate = (this.metrics.totalUpdated / updateTime).toFixed(1);
    
    this.showStatus(
      `✅ Update complete: ${this.metrics.totalUpdated}/${receiptsToUpdate.length} updated in ${updateTime.toFixed(1)}s (${rate}/sec)`, 
      'success'
    );
    
    if (this.metrics.totalErrors > 0) {
      this.showStatus(`⚠️ ${this.metrics.totalErrors} errors occurred, ${this.metrics.retryCount} retries attempted`, 'warning');
    }
    
    return this.metrics.totalUpdated;
  }

  // Advanced concurrent processing with queue management
  async processUpdatesWithConcurrencyControl(receipts, onProgress) {
    // Create update tasks
    const updateTasks = receipts.map((receipt, index) => ({
      receipt,
      index,
      retries: 0
    }));
    
    // Process tasks with controlled concurrency
    const promises = [];
    let completedCount = 0;
    let activeCount = 0;
    
    const processNextTask = async () => {
      while (updateTasks.length > 0 && activeCount < this.rateLimits.maxConcurrent) {
        const task = updateTasks.shift();
        activeCount++;
        
        const promise = this.executeUpdateTask(task)
          .then(result => {
            activeCount--;
            completedCount++;
            
            if (result.success) {
              this.metrics.totalUpdated++;
            } else {
              this.metrics.totalErrors++;
              
              // Retry logic
              if (task.retries < this.rateLimits.maxRetries) {
                task.retries++;
                this.metrics.retryCount++;
                updateTasks.push(task); // Retry later
              }
            }
            
            // Progress reporting
            if (completedCount % this.batchConfig.progressUpdateInterval === 0 || completedCount === receipts.length) {
              const progressPercent = Math.round((completedCount / receipts.length) * 100);
              this.showStatus(
                `📝 Updated ${this.metrics.totalUpdated}/${receipts.length} documents (${progressPercent}%)` +
                (this.metrics.totalErrors > 0 ? ` - ${this.metrics.totalErrors} errors` : ''),
                'processing'
              );
              
              if (onProgress) {
                onProgress({ 
                  updated: this.metrics.totalUpdated, 
                  total: receipts.length, 
                  errors: this.metrics.totalErrors,
                  phase: 'update' 
                });
              }
            }
            
            // Continue processing
            return processNextTask();
          })
          .catch(error => {
            activeCount--;
            console.error('Task processing error:', error);
          });
        
        promises.push(promise);
        
        // Rate limiting delay
        await new Promise(resolve => setTimeout(resolve, 1000 / this.rateLimits.requestsPerSecond));
      }
    };
    
    // Start initial concurrent tasks
    await processNextTask();
    
    // Wait for all tasks to complete
    await Promise.all(promises);
  }

  // Execute individual update task with error handling
  async executeUpdateTask(task) {
    try {
      const { receipt } = task;
      
      await this.executeWithRetry(async () => {
        return await this.databases.updateDocument(
          this.databaseId,
          this.collectionId,
          receipt.$id,
          { commonId: receipt.resolvedCommonId }
        );
      }, task.retries);
      
      // Update local receipt object
      receipt.commonId = receipt.resolvedCommonId;
      
      return { success: true, receiptId: receipt.$id };
      
    } catch (error) {
      console.warn(`Update failed for receipt ${task.receipt.$id}:`, error);
      return { success: false, receiptId: task.receipt.$id, error: error.message };
    }
  }

  // FREE TIER: Enhanced retry with longer delays
  async executeWithFreeTierRetry(operation, currentRetry = 0) {
    try {
      return await operation();
    } catch (error) {
      if (currentRetry >= this.rateLimits.maxRetries) {
        throw error;
      }
      
      // Check if it's a rate limit error
      const isRateLimit = error.message?.includes('rate') || 
                         error.message?.includes('limit') || 
                         error.code === 429;
      
      if (isRateLimit || error.type === 'general_rate_limit_exceeded') {
        const delay = this.rateLimits.retryDelays[currentRetry] || 60000;
        this.showStatus(`⏳ FREE TIER: Rate limit hit, waiting ${delay/1000}s before retry...`, 'warning');
        await new Promise(resolve => setTimeout(resolve, delay));
        
        // Reset hourly counter after waiting
        if (delay >= 60000) {
          this.metrics.requestsThisHour = Math.max(0, this.metrics.requestsThisHour - 1);
        }
        
        return this.executeWithFreeTierRetry(operation, currentRetry + 1);
      }
      
      throw error;
    }
  }

  // Enhanced retry mechanism with exponential backoff
  async executeWithRetry(operation, currentRetry = 0) {
    try {
      return await operation();
    } catch (error) {
      if (currentRetry >= this.rateLimits.maxRetries) {
        throw error;
      }
      
      // Check if it's a rate limit error
      const isRateLimit = error.message?.includes('rate') || 
                         error.message?.includes('limit') || 
                         error.code === 429;
      
      if (isRateLimit || error.type === 'general_rate_limit_exceeded') {
        const delay = this.rateLimits.retryDelays[currentRetry] || 10000;
        this.showStatus(`⏳ Rate limit hit, waiting ${delay/1000}s before retry...`, 'warning');
        await new Promise(resolve => setTimeout(resolve, delay));
        
        return this.executeWithRetry(operation, currentRetry + 1);
      }
      
      throw error;
    }
  }

  // Smart progress updates with rolling log integration
  showStatus(message, type) {
    if (window.showProcessingStatus) {
      window.showProcessingStatus(message, type);
    } else {
      console.log(`[${type.toUpperCase()}] ${message}`);
    }
  }

  // Performance metrics and reporting
  getPerformanceMetrics() {
    const now = Date.now();
    const totalTime = this.metrics.startTime ? (now - this.metrics.startTime) / 1000 : 0;
    const updateTime = this.metrics.updateStartTime ? (now - this.metrics.updateStartTime) / 1000 : 0;
    
    return {
      totalProcessed: this.metrics.totalProcessed,
      totalUpdated: this.metrics.totalUpdated,
      totalErrors: this.metrics.totalErrors,
      retryCount: this.metrics.retryCount,
      totalTime: totalTime.toFixed(2),
      updateTime: updateTime.toFixed(2),
      processingRate: totalTime > 0 ? (this.metrics.totalProcessed / totalTime).toFixed(2) : 0,
      updateRate: updateTime > 0 ? (this.metrics.totalUpdated / updateTime).toFixed(2) : 0,
      successRate: this.metrics.totalUpdated > 0 ? 
        ((this.metrics.totalUpdated / (this.metrics.totalUpdated + this.metrics.totalErrors)) * 100).toFixed(1) : 0
    };
  }

  // Memory-efficient batch processing for very large datasets
  async processInMemoryEfficientBatches(receipts, customerService, onProgress = null) {
    const batchSize = 200; // Larger batches for memory efficiency
    const results = {
      processed: 0,
      updated: 0,
      errors: 0
    };
    
    this.showStatus(`🧠 Memory-efficient processing: ${receipts.length} receipts in batches of ${batchSize}...`, 'processing');
    
    for (let i = 0; i < receipts.length; i += batchSize) {
      const batch = receipts.slice(i, i + batchSize);
      
      // Process resolution
      const resolutionResults = customerService.processNewReceipts(batch);
      results.processed += resolutionResults.processedCount;
      
      // Update documents in smaller sub-batches
      const updateResults = await this.updateReceiptsOptimized(batch, onProgress);
      results.updated += updateResults;
      
      // Progress update
      const progressPercent = Math.round(((i + batchSize) / receipts.length) * 100);
      this.showStatus(
        `🧠 Batch ${Math.floor(i/batchSize) + 1}: ${results.processed} processed, ${results.updated} updated (${progressPercent}%)`,
        'processing'
      );
      
      if (onProgress) {
        onProgress({
          processed: results.processed,
          updated: results.updated,
          total: receipts.length,
          phase: 'batch'
        });
      }
      
      // Garbage collection hint for large datasets
      if (i % (batchSize * 5) === 0) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
    
    return results;
  }

  // FREE TIER: Estimate processing time with rate limits
  estimateFreeTierProcessingTime(receiptCount) {
    // Free tier: 50 requests per hour (safe limit)
    const requestsPerHour = 50;
    const hoursNeeded = Math.ceil(receiptCount / requestsPerHour);
    const daysNeeded = Math.ceil(hoursNeeded / 8); // Assuming 8 hours of processing per day
    
    return {
      totalRequests: receiptCount,
      requestsPerHour: requestsPerHour,
      hoursNeeded: hoursNeeded,
      daysNeeded: daysNeeded,
      message: hoursNeeded <= 1 ? 
        `~${hoursNeeded} hour` : 
        daysNeeded === 1 ? 
          `~${hoursNeeded} hours (spread across today)` :
          `~${daysNeeded} days (${hoursNeeded} total hours)`
    };
  }

  // Utility method to estimate processing time
  estimateProcessingTime(receiptCount) {
    // Based on performance metrics
    const avgResolutionRate = 500; // receipts per second
    const avgUpdateRate = 15;      // updates per second
    
    const resolutionTime = receiptCount / avgResolutionRate;
    const updateTime = receiptCount / avgUpdateRate;
    
    return {
      resolutionTime: Math.ceil(resolutionTime),
      updateTime: Math.ceil(updateTime),
      totalTime: Math.ceil(resolutionTime + updateTime),
      formattedTotal: this.formatTime(resolutionTime + updateTime)
    };
  }

  formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    
    if (minutes > 0) {
      return `${minutes}m ${remainingSeconds}s`;
    }
    return `${remainingSeconds}s`;
  }
}

// Export for use in other files
if (typeof window !== 'undefined') {
  window.OptimizedBatchProcessor = OptimizedBatchProcessor;
}
