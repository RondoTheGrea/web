// Customer Dashboard
// Main functionality for customer management and display with smart auto-processing

let customerResolutionService;
let allReceipts = [];
let customerReceiptsMap = new Map(); // commonId -> array of receipts
let isProcessing = false;
let autoProcessingEnabled = true;

// Initialize customer dashboard
function initCustomerDashboard() {
  customerResolutionService = new CustomerResolutionService();
  
  // Add event listeners
  document.getElementById('processCustomersBtn').addEventListener('click', () => processAllReceipts(true));
  document.getElementById('viewCustomersBtn').addEventListener('click', displayResolvedCustomers);
  document.getElementById('refreshCustomersBtn').addEventListener('click', refreshCustomerData);
  document.getElementById('clearCustomersBtn').addEventListener('click', clearCustomerData);
  
  // Check initial status
  checkCustomerStatus();
  
  // Set up tab change listener for auto-processing
  setupAutoProcessing();
}

// Set up automatic processing when Customers tab is accessed
function setupAutoProcessing() {
  const customersTab = document.querySelector('[data-tab="customers"]');
  if (customersTab) {
    customersTab.addEventListener('click', handleCustomersTabClick);
  }
  
  // Also check on page load if customers tab is active
  if (document.getElementById('customers').classList.contains('active')) {
    handleCustomersTabClick();
  }
}

// Handle when customers tab is clicked
async function handleCustomersTabClick() {
  if (isProcessing) {
    console.log('Processing already in progress, skipping auto-process');
    return;
  }
  
  try {
    // Check if we need to process any receipts
    const needsProcessing = await checkForUnprocessedReceipts();
    
    if (needsProcessing.hasUnprocessed) {
      console.log(`Found ${needsProcessing.count} unprocessed receipts, starting auto-processing...`);
      await processUnprocessedReceipts(needsProcessing.unprocessedReceipts);
    } else {
      console.log('All receipts are up to date');
      // Just refresh the display if everything is current
      if (customerResolutionService.getStats().totalCustomers > 0) {
        await displayResolvedCustomers();
      }
    }
  } catch (error) {
    console.error('Error in auto-processing:', error);
    showProcessingStatus(`Error in auto-processing: ${error.message}`, 'error');
  }
}

// Check for unprocessed receipts
async function checkForUnprocessedReceipts() {
  try {
    showProcessingStatus('🔍 Checking for new receipts...', 'info');
    
    // Get the last processed receipt ID from localStorage
    const lastProcessedId = localStorage.getItem('lastProcessedReceiptId');
    const lastProcessedDate = customerResolutionService.getLastProcessedDate();
    
    // Fetch recent receipts from Appwrite
    let queries = [
      Appwrite.Query.orderDesc('$createdAt'),
      Appwrite.Query.limit(100) // Start with recent 100
    ];
    
    // If we have a last processed date, only get receipts after that
    if (lastProcessedDate) {
      queries.push(Appwrite.Query.greaterThan('date', lastProcessedDate.toISOString().split('T')[0]));
    }
    
    const response = await databases.listDocuments(
      databaseId,
      '689d4a4b000b62bd70ca', // allreceipt collection ID
      queries
    );
    
    let unprocessedReceipts = [];
    
    if (lastProcessedId) {
      // Filter out receipts that have been processed
      unprocessedReceipts = response.documents.filter(receipt => {
        return !receipt.commonId || receipt.$id > lastProcessedId;
      });
    } else {
      // If no processing has been done, all receipts are unprocessed
      unprocessedReceipts = response.documents.filter(receipt => !receipt.commonId);
    }
    
    // If we found unprocessed receipts in the first 100, check if there are more
    if (unprocessedReceipts.length > 0 && response.documents.length === 100) {
      // There might be more, let's get a count
      const totalUnprocessed = await getUnprocessedReceiptCount();
      
      if (totalUnprocessed > 100) {
        // Get all unprocessed receipts in batches
        unprocessedReceipts = await getAllUnprocessedReceipts();
      }
    }
    
    showProcessingStatus(`Found ${unprocessedReceipts.length} unprocessed receipts`, 'info');
    
    return {
      hasUnprocessed: unprocessedReceipts.length > 0,
      count: unprocessedReceipts.length,
      unprocessedReceipts
    };
    
  } catch (error) {
    console.error('Error checking for unprocessed receipts:', error);
    throw error;
  }
}

// Get count of unprocessed receipts
async function getUnprocessedReceiptCount() {
  try {
    const response = await databases.listDocuments(
      databaseId,
      '689d4a4b000b62bd70ca',
      [
        Appwrite.Query.isNull('commonId'),
        Appwrite.Query.limit(1)
      ]
    );
    
    return response.total || 0;
  } catch (error) {
    console.warn('Could not get unprocessed receipt count:', error);
    return 0;
  }
}

// Get all unprocessed receipts in batches
async function getAllUnprocessedReceipts() {
  const allUnprocessed = [];
  let offset = 0;
  const limit = 100;
  
  while (true) {
    try {
      const response = await databases.listDocuments(
        databaseId,
        '689d4a4b000b62bd70ca',
        [
          Appwrite.Query.isNull('commonId'),
          Appwrite.Query.limit(limit),
          Appwrite.Query.offset(offset)
        ]
      );
      
      allUnprocessed.push(...response.documents);
      
      if (response.documents.length < limit) {
        break; // No more documents
      }
      
      offset += limit;
      
      // Update progress
      showProcessingStatus(`Fetching unprocessed receipts... ${allUnprocessed.length} found`, 'info');
      
    } catch (error) {
      console.error('Error fetching unprocessed receipts batch:', error);
      break;
    }
  }
  
  return allUnprocessed;
}

// Process unprocessed receipts in smart batches (for Customers tab - efficient mode)
async function processUnprocessedReceipts(receipts) {
  if (receipts.length === 0) return;
  
  isProcessing = true;
  
  try {
    showProcessingStatus(`🔄 Auto-processing ${receipts.length} new receipts...`, 'processing');
    
    // For smaller batches (under 100), use simpler processing
    if (receipts.length <= 100) {
      const results = customerResolutionService.processNewReceipts(receipts);
      const updateResults = await updateReceiptBatch(receipts);
      
      showProcessingStatus(`✅ Processed ${results.processedCount} receipts, updated ${updateResults.updatedCount} documents`, 'success');
    } else {
      // For larger batches, use enhanced progress tracking
      await processReceiptsWithProgress(receipts, false); // false = incremental mode
      return; // processReceiptsWithProgress handles completion
    }
    
    // Update tracking for smaller batches
    if (receipts.length > 0) {
      const lastReceipt = receipts[receipts.length - 1];
      localStorage.setItem('lastProcessedReceiptId', lastReceipt.$id);
    }
    
    // Rebuild customer receipt map
    allReceipts = await fetchAllProcessedReceipts();
    buildCustomerReceiptMap(allReceipts);
    
    // Show completion status
    const stats = customerResolutionService.getStats();
    const manualReviewCount = customerResolutionService.getManualReviewQueue().length;
    
    showProcessingStatus(`
      ✅ Auto-processing completed! 
      Total customers: ${stats.totalCustomers}
      ${manualReviewCount > 0 ? `⚠️ ${manualReviewCount} items need manual review` : ''}
    `, 'success');
    
    // Auto-display customers
    await displayResolvedCustomers();
    
    // Update UI buttons
    updateUIButtons();
    
  } catch (error) {
    console.error('Error in batch processing:', error);
    showProcessingStatus(`❌ Error processing receipts: ${error.message}`, 'error');
  } finally {
    isProcessing = false;
  }
}

// Update a batch of receipts in Appwrite
async function updateReceiptBatch(receipts) {
  let updatedCount = 0;
  let errorCount = 0;
  
  for (const receipt of receipts) {
    try {
      if (receipt.resolvedCommonId && (!receipt.commonId || receipt.commonId !== receipt.resolvedCommonId)) {
        await databases.updateDocument(
          databaseId,
          '689d4a4b000b62bd70ca',
          receipt.$id,
          { commonId: receipt.resolvedCommonId }
        );
        
        receipt.commonId = receipt.resolvedCommonId;
        updatedCount++;
      }
    } catch (error) {
      console.warn(`Could not update receipt ${receipt.$id}:`, error);
      errorCount++;
    }
  }
  
  return { updatedCount, errorCount };
}

// Fetch all processed receipts (with commonId)
async function fetchAllProcessedReceipts() {
  const receipts = [];
  let offset = 0;
  const limit = 100;
  
  while (true) {
    try {
      const response = await databases.listDocuments(
        databaseId,
        '689d4a4b000b62bd70ca',
        [
          Appwrite.Query.isNotNull('commonId'),
          Appwrite.Query.limit(limit),
          Appwrite.Query.offset(offset)
        ]
      );
      
      receipts.push(...response.documents);
      
      if (response.documents.length < limit) {
        break;
      }
      
      offset += limit;
    } catch (error) {
      console.error('Error fetching processed receipts:', error);
      break;
    }
  }
  
  return receipts;
}

// Show processing status with different types and rolling log (max 10 messages)
function showProcessingStatus(message, type = 'info') {
  const statusDiv = document.getElementById('customerProcessingStatus');
  const className = type === 'error' ? 'error' : 
                   type === 'success' ? 'step-success' :
                   type === 'processing' ? 'processing-status' : 'step-status';
  
  // Get current messages, split by div elements
  let currentHTML = statusDiv.innerHTML;
  let messages = [];
  
  if (currentHTML.trim()) {
    // Extract existing messages from divs
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = currentHTML;
    const existingDivs = tempDiv.querySelectorAll('div');
    messages = Array.from(existingDivs).map(div => ({
      content: div.innerHTML,
      className: div.className
    }));
  }
  
  // Special handling for progress messages (🔄 and 📝)
  const isProgressMessage = message.includes('🔄') || message.includes('📝');
  
  if (isProgressMessage && messages.length > 0) {
    // Check if the last message was also a progress message of the same type
    const lastMessage = messages[messages.length - 1];
    const lastWasProgressSameType = (
      (message.includes('🔄') && lastMessage.content.includes('🔄')) ||
      (message.includes('📝') && lastMessage.content.includes('📝'))
    );
    
    if (lastWasProgressSameType) {
      // Replace the last progress message instead of adding a new one
      messages[messages.length - 1] = {
        content: message,
        className: className
      };
    } else {
      // Add new message normally
      messages.push({
        content: message,
        className: className
      });
    }
  } else {
    // Add new message normally for non-progress messages
    messages.push({
      content: message,
      className: className
    });
  }
  
  // Keep only last 10 messages
  if (messages.length > 10) {
    messages = messages.slice(-10);
  }
  
  // Rebuild status div
  statusDiv.innerHTML = messages.map(msg => 
    `<div class="${msg.className}">${msg.content}</div>`
  ).join('');
  
  // Auto-scroll to bottom
  statusDiv.scrollTop = statusDiv.scrollHeight;
}

// Update UI buttons based on current state
function updateUIButtons() {
  const stats = customerResolutionService.getStats();
  
  if (stats.totalCustomers > 0) {
    document.getElementById('viewCustomersBtn').style.display = 'inline-block';
    document.getElementById('refreshCustomersBtn').style.display = 'inline-block';
    document.getElementById('clearCustomersBtn').style.display = 'inline-block';
    
    // Update process button text
    document.getElementById('processCustomersBtn').textContent = '🔄 Reprocess All Receipts';
  }
}

// Manual process all receipts (when button is clicked) - ALWAYS reprocesses everything
async function processAllReceipts(forceReprocess = false) {
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
    
    // ALWAYS clear existing data for full reprocess when button is clicked
    customerResolutionService.clearData();
    localStorage.removeItem('lastProcessedReceiptId');
    
    showProcessingStatus('🔄 Starting full receipt processing (reprocessing ALL receipts)...', 'processing');
    
    // Fetch ALL receipts (including those with commonId)
    allReceipts = await fetchAllReceiptsForReprocessing();
    
    if (allReceipts.length === 0) {
      showProcessingStatus('❌ No receipts found in database', 'error');
      return;
    }
    
    showProcessingStatus(`📥 Fetched ${allReceipts.length} receipts, processing...`, 'processing');
    
    // Process all receipts with enhanced progress tracking
    await processReceiptsWithProgress(allReceipts, true); // true = full reprocess mode
    
  } catch (error) {
    console.error('Error in processAllReceipts:', error);
    showProcessingStatus(`❌ Error: ${error.message}`, 'error');
  } finally {
    isProcessing = false;
    processBtn.disabled = false;
    processBtn.textContent = originalText;
  }
}

// Check if customers have been processed
async function checkCustomerStatus() {
  const stats = customerResolutionService.getStats();
  
  if (stats.totalCustomers > 0) {
    updateUIButtons();
    
    // Show status with enhanced stats
    const statusDiv = document.getElementById('customerProcessingStatus');
    const lastProcessed = stats.lastProcessedDate ? new Date(stats.lastProcessedDate).toLocaleDateString() : 'Never';
    
    statusDiv.innerHTML = `
      <div class="status-success">
        ✅ Customer resolution system ready! 
        <div class="status-details">
          <span>👥 ${stats.totalCustomers} customers</span>
          <span>🏷️ ${stats.totalAliases} aliases</span>
          <span>📅 Last processed: ${lastProcessed}</span>
          ${stats.manualReviewCount > 0 ? `<span style="color: #F59E0B;">⚠️ ${stats.manualReviewCount} manual reviews</span>` : ''}
        </div>
      </div>
    `;
    
    // Show manual review button if needed
    if (stats.manualReviewCount > 0) {
      addManualReviewButton();
    }
  } else {
    // No customers processed yet, show helpful message
    showProcessingStatus(`
      👋 Welcome! Click the Customers tab to automatically process new receipts, 
      or use "Process Customer Resolution" to process all receipts.
    `, 'info');
  }
}

// Add manual review button
function addManualReviewButton() {
  // Remove existing review button if present
  const existingBtn = document.querySelector('.manual-review-btn');
  if (existingBtn) existingBtn.remove();
  
  const reviewBtn = document.createElement('button');
  reviewBtn.textContent = `⚠️ Review ${customerResolutionService.getStats().manualReviewCount} Items`;
  reviewBtn.className = 'action-button manual-review-btn';
  reviewBtn.style.backgroundColor = '#F59E0B';
  reviewBtn.onclick = showManualReviewModal;
  document.querySelector('.customer-controls').appendChild(reviewBtn);
}

// Legacy function - redirects to new system
async function processCustomerResolution() {
  await processAllReceipts(true);
}

// Fetch all receipts from Appwrite (helper function)
async function fetchAllReceipts() {
  const receipts = [];
  let offset = 0;
  const limit = 100;
  
  while (true) {
    try {
      const response = await databases.listDocuments(
        databaseId,
        '689d4a4b000b62bd70ca', // allreceipt collection ID
        [
          Appwrite.Query.limit(limit),
          Appwrite.Query.offset(offset)
        ]
      );
      
      receipts.push(...response.documents);
      
      if (response.documents.length < limit) {
        break;
      }
      
      offset += limit;
      
      // Show progress for large datasets
      if (offset % 500 === 0) {
        showProcessingStatus(`Fetching receipts... ${receipts.length} loaded`, 'info');
      }
      
    } catch (error) {
      console.error('Error fetching receipts:', error);
      throw new Error(`Failed to fetch receipts: ${error.message}`);
    }
  }
  
  return receipts;
}

// Fetch ALL receipts for reprocessing (including those with commonId)
async function fetchAllReceiptsForReprocessing() {
  const receipts = [];
  let offset = 0;
  const limit = 100;
  
  showProcessingStatus('📥 Fetching ALL receipts from database...', 'processing');
  
  while (true) {
    try {
      const response = await databases.listDocuments(
        databaseId,
        '689d4a4b000b62bd70ca', // allreceipt collection ID
        [
          Appwrite.Query.limit(limit),
          Appwrite.Query.offset(offset),
          Appwrite.Query.orderDesc('$createdAt')
        ]
      );
      
      receipts.push(...response.documents);
      
      if (response.documents.length < limit) {
        break;
      }
      
      offset += limit;
      
      // Show progress for large datasets every 200 receipts
      if (offset % 200 === 0) {
        showProcessingStatus(`📥 Fetching receipts... ${receipts.length} loaded`, 'processing');
      }
      
    } catch (error) {
      console.error('Error fetching receipts:', error);
      throw new Error(`Failed to fetch receipts: ${error.message}`);
    }
  }
  
  showProcessingStatus(`📥 Successfully fetched ${receipts.length} receipts`, 'success');
  return receipts;
}

// Enhanced processing with better progress tracking and rolling updates
async function processReceiptsWithProgress(receipts, isFullReprocess = false) {
  if (receipts.length === 0) return;
  
  const batchSize = 50;
  let processedCount = 0;
  let updatedCount = 0;
  const totalReceipts = receipts.length;
  
  showProcessingStatus(`🔄 Step 1: Processing ${totalReceipts} receipts in batches of ${batchSize}...`, 'processing');
  
  // Process receipts in batches
  for (let i = 0; i < receipts.length; i += batchSize) {
    const batch = receipts.slice(i, i + batchSize);
    const batchNumber = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(receipts.length / batchSize);
    
    // Process resolution for this batch
    const batchResults = customerResolutionService.processNewReceipts(batch);
    processedCount += batchResults.processedCount;
    
    // Show progress every batch (but limited to 10 messages via rolling log)
    const progressPercent = Math.round((processedCount / totalReceipts) * 100);
    showProcessingStatus(
      `🔄 Processed ${processedCount}/${totalReceipts} receipts (${progressPercent}%) - Batch ${batchNumber}/${totalBatches}`, 
      'processing'
    );
    
    // Small delay to prevent UI blocking
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  
  showProcessingStatus(`✅ Step 1 Complete: Processed ${processedCount} receipts`, 'success');
  
  // Get resolution stats
  const stats = customerResolutionService.getStats();
  showProcessingStatus(`✅ Step 2 Complete: Resolved ${stats.totalCustomers} customers`, 'success');
  
  // Update Appwrite documents
  showProcessingStatus('📝 Step 3: Updating Appwrite documents...', 'processing');
  updatedCount = await updateAllProcessedReceipts(receipts, totalReceipts);
  
  showProcessingStatus(`✅ Step 3 Complete: Updated ${updatedCount}/${totalReceipts} documents`, 'success');
  
  // Final steps
  if (receipts.length > 0) {
    const lastReceipt = receipts[receipts.length - 1];
    localStorage.setItem('lastProcessedReceiptId', lastReceipt.$id);
  }
  
  // Rebuild customer receipt map
  allReceipts = receipts;
  buildCustomerReceiptMap(allReceipts);
  
  // Show final completion status
  const manualReviewCount = customerResolutionService.getManualReviewQueue().length;
  
  showProcessingStatus(`
    🎉 Processing Complete! 
    ${processedCount} receipts processed → ${stats.totalCustomers} unique customers
    ${manualReviewCount > 0 ? `⚠️ ${manualReviewCount} items need manual review` : ''}
  `, 'success');
  
  // Auto-display customers
  await displayResolvedCustomers();
  
  // Update UI buttons
  updateUIButtons();
}

// Update all processed receipts in Appwrite with progress tracking
async function updateAllProcessedReceipts(receipts, totalCount) {
  let updatedCount = 0;
  let errorCount = 0;
  const batchSize = 25; // Smaller batches for database updates
  
  for (let i = 0; i < receipts.length; i += batchSize) {
    const batch = receipts.slice(i, i + batchSize);
    
    for (const receipt of batch) {
      try {
        if (receipt.resolvedCommonId && (!receipt.commonId || receipt.commonId !== receipt.resolvedCommonId)) {
          await databases.updateDocument(
            databaseId,
            '689d4a4b000b62bd70ca',
            receipt.$id,
            { commonId: receipt.resolvedCommonId }
          );
          
          receipt.commonId = receipt.resolvedCommonId;
          updatedCount++;
        }
      } catch (error) {
        console.warn(`Could not update receipt ${receipt.$id}:`, error);
        errorCount++;
      }
    }
    
    // Show progress every 50 updates (via rolling log)
    if ((updatedCount + errorCount) % 50 === 0 || (i + batchSize) >= receipts.length) {
      const progressPercent = Math.round(((i + batchSize) / totalCount) * 100);
      showProcessingStatus(
        `📝 Updated ${updatedCount}/${totalCount} documents (${progressPercent}%)${errorCount > 0 ? ` - ${errorCount} errors` : ''}`,
        'processing'
      );
    }
    
    // Small delay between batches
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  
  if (errorCount > 0) {
    showProcessingStatus(`⚠️ Update completed with ${errorCount} errors`, 'info');
  }
  
  return updatedCount;
}

// Build customer receipt map
function buildCustomerReceiptMap(receipts) {
  customerReceiptsMap.clear();
  
  receipts.forEach(receipt => {
    if (receipt.commonId) {
      if (!customerReceiptsMap.has(receipt.commonId)) {
        customerReceiptsMap.set(receipt.commonId, []);
      }
      customerReceiptsMap.get(receipt.commonId).push(receipt);
    }
  });
  
  // Sort receipts by date for each customer
  for (const [commonId, customerReceipts] of customerReceiptsMap) {
    customerReceipts.sort((a, b) => new Date(b.date) - new Date(a.date));
  }
}

// Display resolved customers
async function displayResolvedCustomers() {
  const customersListDiv = document.getElementById('customersList');
  
  try {
    customersListDiv.innerHTML = '<div class="loading">🔄 Loading customer data...</div>';
    
    if (customerReceiptsMap.size === 0) {
      // Rebuild map if needed
      buildCustomerReceiptMap(allReceipts);
    }
    
    const customers = customerResolutionService.getAllCustomers();
    
    if (customers.length === 0) {
      customersListDiv.innerHTML = '<div class="no-customers">No customers found. Please process customer resolution first.</div>';
      return;
    }
    
    // Sort customers alphabetically by store name, then by customer name
    customers.sort((a, b) => {
      const storeA = (a.primaryStore || 'Unknown Store').toLowerCase();
      const storeB = (b.primaryStore || 'Unknown Store').toLowerCase();
      
      if (storeA === storeB) {
        // If stores are the same, sort by customer name
        const nameA = (a.primaryName || 'Unknown Customer').toLowerCase();
        const nameB = (b.primaryName || 'Unknown Customer').toLowerCase();
        return nameA.localeCompare(nameB);
      }
      
      return storeA.localeCompare(storeB);
    });
    
    // Display customers
    let html = '<div class="customers-header">';
    html += `<h2>Customer Overview (${customers.length} customers)</h2>`;
    html += '<div class="customers-summary">';
    html += `<span>📊 Total Receipts: ${allReceipts.length}</span>`;
    html += `<span>💰 Total Revenue: ${customerUtils.formatCurrency(calculateTotalRevenue())}</span>`;
    html += '</div>';
    html += '</div>';
    
    html += '<div class="customers-grid">';
    
    for (const customer of customers) {
      const customerReceipts = customerReceiptsMap.get(customer.commonId) || [];
      const stats = customerUtils.generateCustomerStats(customerReceipts);
      
      // Update customer info with latest stats
      customer.totalReceipts = stats.totalReceipts;
      customer.totalSpent = stats.totalSpent;
      customer.firstOrder = stats.firstOrder;
      customer.lastOrder = stats.lastOrder;
      
      const card = customerUtils.createCustomerCard(customer, stats);
      html += card.outerHTML;
    }
    
    html += '</div>';
    
    customersListDiv.innerHTML = html;
    
  } catch (error) {
    console.error('Error displaying customers:', error);
    customersListDiv.innerHTML = `<div class="error">❌ Error: ${error.message}</div>`;
  }
}

// View customer purchase history
async function viewCustomerHistory(commonId) {
  const customerReceipts = customerReceiptsMap.get(commonId) || [];
  const customer = customerResolutionService.getCustomerInfo(commonId);
  
  if (customerReceipts.length === 0) {
    alert('No receipts found for this customer.');
    return;
  }
  
  // Create modal content
  const modalContent = `
    <div class="customer-history-modal">
      <div class="modal-header">
        <div class="modal-title">
          <h2>${customer.primaryStore || 'Unknown Store'}</h2>
          <h3>${customer.primaryName || 'Unknown Customer'}</h3>
        </div>
        <button class="close-modal" onclick="closeModal()">×</button>
      </div>
      
      <div class="modal-body">
        <div class="customer-summary">
          <div class="summary-stats">
            <div class="summary-stat">
              <span class="stat-label">Total Receipts:</span>
              <span class="stat-value">${customerReceipts.length}</span>
            </div>
            <div class="summary-stat">
              <span class="stat-label">Total Spent:</span>
              <span class="stat-value">${customerUtils.formatCurrency(customer.totalSpent)}</span>
            </div>
            <div class="summary-stat">
              <span class="stat-label">Average Order:</span>
              <span class="stat-value">${customerUtils.formatCurrency(customer.totalSpent / customerReceipts.length)}</span>
            </div>
          </div>
        </div>
        
        <div class="receipts-list">
          <h3>Purchase History</h3>
          ${customerReceipts.map(receipt => customerUtils.createReceiptItem(receipt).outerHTML).join('')}
        </div>
      </div>
    </div>
  `;
  
  // Show modal
  showModal(modalContent);
}

// View customer details
async function viewCustomerDetails(commonId) {
  const customer = customerResolutionService.getCustomerInfo(commonId);
  const customerReceipts = customerReceiptsMap.get(commonId) || [];
  const stats = customerUtils.generateCustomerStats(customerReceipts);
  
  const modalContent = `
    <div class="customer-details-modal">
      <div class="modal-header">
        <h2>Customer Details</h2>
        <button class="close-modal" onclick="closeModal()">×</button>
      </div>
      
      <div class="modal-body">
        <div class="customer-info">
          <div class="info-section">
            <h3>Basic Information</h3>
            <div class="info-row">
              <span class="info-label">Primary Store:</span>
              <span class="info-value">${customer.primaryStore || 'Unknown Store'}</span>
            </div>
            <div class="info-row">
              <span class="info-label">Customer Name:</span>
              <span class="info-value">${customer.primaryName || 'Unknown'}</span>
            </div>

            <div class="info-row">
              <span class="info-label">Customer ID:</span>
              <span class="info-value">${customer.commonId}</span>
            </div>
          </div>
          
          <div class="info-section">
            <h3>Purchase Statistics</h3>
            <div class="info-row">
              <span class="info-label">Total Receipts:</span>
              <span class="info-value">${stats.totalReceipts}</span>
            </div>
            <div class="info-row">
              <span class="info-label">Total Spent:</span>
              <span class="info-value">${customerUtils.formatCurrency(stats.totalSpent)}</span>
            </div>
            <div class="info-row">
              <span class="info-label">Average Order:</span>
              <span class="info-value">${customerUtils.formatCurrency(stats.averageOrder)}</span>
            </div>
            <div class="info-row">
              <span class="info-label">Total Returns:</span>
              <span class="info-value">${customerUtils.formatCurrency(stats.totalReturns)}</span>
            </div>
          </div>
          
          <div class="info-section">
            <h3>Order Timeline</h3>
            <div class="info-row">
              <span class="info-label">First Order:</span>
              <span class="info-value">${customerUtils.formatDate(stats.firstOrder)}</span>
            </div>
            <div class="info-row">
              <span class="info-label">Last Order:</span>
              <span class="info-value">${customerUtils.formatDate(stats.lastOrder)}</span>
            </div>
          </div>
          
          ${stats.favoriteItems.length > 0 ? `
            <div class="info-section">
              <h3>Favorite Items</h3>
              ${stats.favoriteItems.map(item => `
                <div class="favorite-item">
                  <span class="item-name">${item.name}</span>
                  <span class="item-quantity">${item.quantity}x</span>
                  <span class="item-total">${customerUtils.formatCurrency(item.total)}</span>
                </div>
              `).join('')}
            </div>
          ` : ''}
          
          ${stats.paymentMethods.length > 0 ? `
            <div class="info-section">
              <h3>Payment Methods</h3>
              ${stats.paymentMethods.map(method => `
                <div class="payment-method">
                  <span class="method-name">${method.method}</span>
                  <span class="method-count">${method.count} orders</span>
                </div>
              `).join('')}
            </div>
          ` : ''}
        </div>
      </div>
    </div>
  `;
  
  showModal(modalContent);
}

// Refresh customer data
async function refreshCustomerData() {
  try {
    showProcessingStatus('🔄 Refreshing customer data...', 'processing');
    
    // Check for any new unprocessed receipts
    const needsProcessing = await checkForUnprocessedReceipts();
    
    if (needsProcessing.hasUnprocessed) {
      // Process new receipts first
      await processUnprocessedReceipts(needsProcessing.unprocessedReceipts);
    } else {
      // Just refresh the display
      allReceipts = await fetchAllProcessedReceipts();
      buildCustomerReceiptMap(allReceipts);
      await displayResolvedCustomers();
      showProcessingStatus('✅ Customer data refreshed successfully!', 'success');
    }
    
  } catch (error) {
    console.error('Error refreshing customer data:', error);
    showProcessingStatus(`❌ Error refreshing data: ${error.message}`, 'error');
  }
}

// Clear customer data
function clearCustomerData() {
  if (confirm('Are you sure you want to clear all customer data? This will remove all customer mappings and require reprocessing.')) {
    customerResolutionService.clearData();
    allReceipts = [];
    customerReceiptsMap.clear();
    localStorage.removeItem('lastProcessedReceiptId');
    
    // Reset UI
    document.getElementById('customerProcessingStatus').innerHTML = '';
    document.getElementById('customersList').innerHTML = '';
    document.getElementById('viewCustomersBtn').style.display = 'none';
    document.getElementById('refreshCustomersBtn').style.display = 'none';
    document.getElementById('clearCustomersBtn').style.display = 'none';
    document.getElementById('processCustomersBtn').textContent = '🔄 Process Customer Resolution';
    
    // Remove manual review button
    const reviewBtn = document.querySelector('.manual-review-btn');
    if (reviewBtn) reviewBtn.remove();
    
    showProcessingStatus('✅ Customer data cleared. New receipts will be auto-processed when you visit the Customers tab.', 'success');
  }
}

// Calculate total revenue across all customers
function calculateTotalRevenue() {
  return allReceipts.reduce((total, receipt) => total + (receipt.total || 0), 0);
}

// Modal functions
function showModal(content) {
  // Create modal container
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = content;
  
  // Add to page
  document.body.appendChild(modal);
  
  // Show modal
  setTimeout(() => modal.classList.add('show'), 10);
}

function closeModal() {
  const modal = document.querySelector('.modal-overlay');
  if (modal) {
    modal.classList.remove('show');
    setTimeout(() => modal.remove(), 300);
  }
}

// Close modal when clicking outside
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) {
    closeModal();
  }
});

// Export functions for global access
if (typeof window !== 'undefined') {
  window.viewCustomerHistory = viewCustomerHistory;
  window.viewCustomerDetails = viewCustomerDetails;
  window.closeModal = closeModal;
  window.showManualReviewModal = showManualReviewModal;
  window.resolveManualReviewItem = resolveManualReviewItem;
}

// Manual review functionality
function showManualReviewModal() {
  const queue = customerResolutionService.getManualReviewQueue();
  
  if (queue.length === 0) {
    alert('No items in manual review queue.');
    return;
  }
  
  let modalContent = `
    <div class="manual-review-modal">
      <div class="modal-header">
        <h2>Manual Review Queue (${queue.length} items)</h2>
        <button class="close-modal" onclick="closeModal()">×</button>
      </div>
      
      <div class="modal-body">
        <p>These customer-store combinations need manual review due to potential conflicts:</p>
        
        <div class="review-items">
  `;
  
  queue.forEach((item, index) => {
    const candidates = item.candidates || [];
    
    modalContent += `
      <div class="review-item" data-alias-key="${item.aliasKey}">
        <div class="review-header">
          <h4>Item ${index + 1}: ${item.customerName} at ${item.storeName}</h4>
          <span class="review-timestamp">${new Date(item.timestamp).toLocaleString()}</span>
        </div>
        
        <div class="review-options">
          <p><strong>Choose action:</strong></p>
          
          <div class="option-group">
            <input type="radio" id="new_${index}" name="resolution_${index}" value="new">
            <label for="new_${index}">Create new customer</label>
          </div>
          
          ${candidates.map((candidateId, candIndex) => {
            const candidate = customerResolutionService.getCustomerInfo(candidateId);
            return `
              <div class="option-group">
                <input type="radio" id="existing_${index}_${candIndex}" name="resolution_${index}" value="${candidateId}">
                <label for="existing_${index}_${candIndex}">
                  Merge with: ${candidate ? candidate.primaryName : candidateId}
                  ${candidate ? `(${candidate.aliases.length} aliases)` : ''}
                </label>
              </div>
            `;
          }).join('')}
          
          <button class="resolve-btn" onclick="resolveManualReviewItem('${item.aliasKey}', ${index})">
            Resolve This Item
          </button>
        </div>
      </div>
    `;
  });
  
  modalContent += `
        </div>
        
        <div class="review-actions">
          <button class="action-button" onclick="closeModal()">Close</button>
          <button class="action-button" onclick="refreshAfterReview()">Refresh After Changes</button>
        </div>
      </div>
    </div>
  `;
  
  showModal(modalContent);
}

function resolveManualReviewItem(aliasKey, itemIndex) {
  const selectedOption = document.querySelector(`input[name="resolution_${itemIndex}"]:checked`);
  
  if (!selectedOption) {
    alert('Please select an option before resolving.');
    return;
  }
  
  const selectedValue = selectedOption.value;
  
  try {
    if (selectedValue === 'new') {
      // User wants to create a new customer - remove from queue
      const queue = customerResolutionService.getManualReviewQueue();
      const item = queue.find(item => item.aliasKey === aliasKey);
      
      if (item) {
        // Create new customer
        const commonId = customerResolutionService.resolveCustomer(item.customerName, item.storeName);
        alert(`Created new customer with ID: ${commonId}`);
      }
    } else {
      // User wants to merge with existing customer
      customerResolutionService.resolveManualReview(aliasKey, selectedValue);
      alert('Customer merged successfully!');
    }
    
    // Remove this item from the modal
    const reviewItem = document.querySelector(`[data-alias-key="${aliasKey}"]`);
    if (reviewItem) {
      reviewItem.remove();
    }
    
    // Update queue count in modal header
    const remainingItems = document.querySelectorAll('.review-item').length;
    const modalHeader = document.querySelector('.manual-review-modal .modal-header h2');
    if (modalHeader) {
      modalHeader.textContent = `Manual Review Queue (${remainingItems} items)`;
    }
    
    // If no more items, close modal
    if (remainingItems === 0) {
      closeModal();
      alert('All manual review items resolved!');
      checkCustomerStatus(); // Refresh status
    }
    
  } catch (error) {
    console.error('Error resolving manual review item:', error);
    alert(`Error: ${error.message}`);
  }
}

function refreshAfterReview() {
  closeModal();
  checkCustomerStatus();
  displayResolvedCustomers();
}
