// Free Tier Processing Functions
// Replacement functions optimized for Appwrite's 60 requests/hour limit

// Replace the main processing function
async function processAllReceiptsFreeTier(forceReprocess = false) {
  if (isProcessing) {
    alert('Processing is already in progress. Please wait...');
    return;
  }

  const processBtn = document.getElementById('processCustomersBtn');
  const originalText = processBtn.textContent;

  try {
    isProcessing = true;
    processBtn.disabled = true;
    processBtn.textContent = '🔄 Processing...';

    // Show free tier warning first
    if (typeof showFreeTierWarning === 'function') {
      showFreeTierWarning();
    }

    // Check if we should use free tier processor
    if (!freeTierProcessor) {
      if (typeof databases !== 'undefined' && typeof databaseId !== 'undefined') {
        freeTierProcessor = new FreeTierOptimizedProcessor(databases, databaseId, '68a30d780012b7b77108');
      } else {
        throw new Error('Free tier processor not available - please refresh the page');
      }
    }

    // Check rate limit status before starting
    const rateLimitCheck = freeTierProcessor.shouldAbortDueToRateLimits();
    if (rateLimitCheck.shouldAbort) {
      showProcessingStatus(`🚫 ${rateLimitCheck.reason}. ${rateLimitCheck.suggestion}`, 'error');
      return;
    }

    // Get current rate limit status
    const initialStatus = freeTierProcessor.getRateLimitStatus();
    showProcessingStatus(
      `📊 Starting with ${initialStatus.requestsRemaining}/60 API requests remaining this hour`,
      'info'
    );

    // ALWAYS clear existing data for full reprocess when button is clicked
    customerResolutionService.clearData();
    localStorage.removeItem('lastProcessedReceiptId');
    localStorage.removeItem('cachedReceipts');
    localStorage.removeItem('receiptsCacheTime');

    showProcessingStatus('🐌 Starting FREE TIER processing (ultra-conservative for 60 requests/hour limit)...', 'processing');

    // Step 1: Ultra-efficient fetch designed for free tier
    allReceipts = await freeTierProcessor.fetchAllReceiptsUltraEfficient((progress) => {
      if (progress.phase === 'fetch') {
        showProcessingStatus(
          `📥 Fetching: ${progress.fetched} receipts loaded. API usage: ${progress.requestsUsed}/${progress.requestsUsed + progress.requestsRemaining}`,
          'processing'
        );
      }
    });

    if (allReceipts.length === 0) {
      showProcessingStatus('❌ No receipts found in database', 'error');
      return;
    }

    // Show realistic time estimate for free tier
    const estimate = freeTierProcessor.estimateFreeTierProcessingTime(allReceipts.length);
    if (estimate.exceedsHourlyLimit) {
      showProcessingStatus(
        `⚠️ WARNING: ${allReceipts.length} receipts require ~${estimate.totalRequests} API calls. ` +
        `This exceeds the 60/hour limit and may take ${estimate.estimatedHours}+ hours to complete.`,
        'warning'
      );
      
      // Ask user if they want to continue
      const userConfirm = confirm(
        `FREE TIER LIMITATION:\n\n` +
        `Processing ${allReceipts.length} receipts requires ~${estimate.totalRequests} API calls.\n` +
        `Appwrite free tier allows only 60 requests/hour.\n\n` +
        `This will take ${estimate.estimatedHours}+ hours with 1-minute delays between requests.\n\n` +
        `Do you want to continue with FREE TIER processing?\n\n` +
        `Recommendation: Upgrade to Pro plan ($15/month) for unlimited requests.`
      );
      
      if (!userConfirm) {
        showProcessingStatus('❌ Processing cancelled by user', 'info');
        return;
      }
    }

    // Step 2: Fast customer resolution (no API calls)
    showProcessingStatus(`🧠 Processing customer resolution for ${allReceipts.length} receipts (local processing)...`, 'processing');
    const processedCount = customerResolutionService.processNewReceipts(allReceipts).processedCount;
    
    showProcessingStatus(`✅ Customer resolution complete: ${processedCount} receipts processed`, 'success');

    // Step 3: Ultra-conservative database updates for free tier
    const updatedCount = await freeTierProcessor.updateReceiptsUltraConservative(
      allReceipts,
      (progress) => {
        if (progress.phase === 'update') {
          const percent = Math.round((progress.updated / progress.total) * 100);
          const errorMsg = progress.errors > 0 ? ` - ${progress.errors} errors` : '';
          showProcessingStatus(
            `📝 FREE TIER Update: ${progress.updated}/${progress.total} (${percent}%) ` +
            `API: ${progress.requestsUsed}/60${errorMsg}`,
            'processing'
          );
        }
      }
    );

    // Final steps
    const currentDate = new Date().toISOString().split('T')[0];
    localStorage.setItem('lastFullProcessDate', currentDate);
    localStorage.setItem('lastCustomersTabVisit', currentDate);
    localStorage.setItem('lastProcessedTime', Date.now().toString());

    // Store all receipts in memory
    await storeReceiptsInMemory(allReceipts);

    // Show final status with rate limit info
    const finalStatus = freeTierProcessor.getRateLimitStatus();
    showProcessingStatus(
      `🎉 FREE TIER processing complete! ${processedCount} resolved, ${updatedCount} updated. ` +
      `API usage: ${finalStatus.requestsUsed}/60 requests this hour.`,
      'success'
    );

    if (finalStatus.requestsRemaining < 10) {
      showProcessingStatus(
        `⚠️ Only ${finalStatus.requestsRemaining} API requests remaining this hour. Next reset: ${finalStatus.formattedWait}`,
        'warning'
      );
    }

  } catch (error) {
    console.error('Error in free tier processing:', error);
    
    if (error.message.includes('Rate limit')) {
      showProcessingStatus(`🚫 Rate limit error: ${error.message}`, 'error');
      showProcessingStatus(
        `💡 FREE TIER SOLUTION: Wait for rate limits to reset, or upgrade to Pro plan for unlimited requests.`,
        'info'
      );
    } else {
      showProcessingStatus(`❌ Processing error: ${error.message}`, 'error');
    }
  } finally {
    isProcessing = false;
    processBtn.disabled = false;
    processBtn.textContent = originalText;
  }
}

// Override the original function if it exists
if (typeof window !== 'undefined') {
  window.processAllReceipts = processAllReceiptsFreeTier;
}
