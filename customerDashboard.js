// Customer Dashboard
// Main functionality for customer management and display

let customerResolutionService;
let allReceipts = [];
let customerReceiptsMap = new Map(); // commonId -> array of receipts

// Initialize customer dashboard
function initCustomerDashboard() {
  customerResolutionService = new CustomerResolutionService();
  
  // Add event listeners
  document.getElementById('processCustomersBtn').addEventListener('click', processCustomerResolution);
  document.getElementById('viewCustomersBtn').addEventListener('click', displayResolvedCustomers);
  document.getElementById('refreshCustomersBtn').addEventListener('click', refreshCustomerData);
  document.getElementById('clearCustomersBtn').addEventListener('click', clearCustomerData);
  
  // Check if customers have been processed
  checkCustomerStatus();
}

// Check if customers have been processed
async function checkCustomerStatus() {
  const stats = customerResolutionService.getStats();
  
  if (stats.totalCustomers > 0) {
    // Customers already processed, show view button
    document.getElementById('viewCustomersBtn').style.display = 'inline-block';
    document.getElementById('refreshCustomersBtn').style.display = 'inline-block';
    
    // Show status
    const statusDiv = document.getElementById('customerProcessingStatus');
    statusDiv.innerHTML = `
      <div class="status-success">
        ✅ Customer resolution completed! 
        <span class="status-details">${stats.totalCustomers} customers, ${stats.totalMappings} mappings</span>
      </div>
    `;
  }
}

// Process customer resolution
async function processCustomerResolution() {
  const statusDiv = document.getElementById('customerProcessingStatus');
  const processBtn = document.getElementById('processCustomersBtn');
  
  try {
    // Disable button and show processing status
    processBtn.disabled = true;
    processBtn.textContent = '🔄 Processing...';
    
    statusDiv.innerHTML = '<div class="processing-status">🔄 Starting customer resolution process...</div>';
    
    // Step 1: Fetch all receipts from Appwrite
    statusDiv.innerHTML += '<div class="step-status">📥 Step 1: Fetching all receipts from Appwrite...</div>';
    
    allReceipts = await fetchAllReceipts();
    
    if (allReceipts.length === 0) {
      statusDiv.innerHTML += '<div class="error">❌ No receipts found in Appwrite</div>';
      return;
    }
    
    statusDiv.innerHTML += `<div class="step-success">✅ Step 1 Complete: Fetched ${allReceipts.length} receipts</div>`;
    
    // Step 2: Process customer resolution
    statusDiv.innerHTML += '<div class="step-status">🔄 Step 2: Processing customer resolution...</div>';
    
    const resolutionResults = await processCustomerResolutionStep(allReceipts);
    
    statusDiv.innerHTML += `<div class="step-success">✅ Step 2 Complete: Resolved ${resolutionResults.totalCustomers} customers</div>`;
    
    // Step 3: Update Appwrite documents with commonId
    statusDiv.innerHTML += '<div class="step-status">📝 Step 3: Updating Appwrite documents...</div>';
    
    const updateResults = await updateAppwriteDocuments(allReceipts);
    
    statusDiv.innerHTML += `<div class="step-success">✅ Step 3 Complete: Updated ${updateResults.updatedCount} documents</div>`;
    
    // Step 4: Build customer receipt map
    statusDiv.innerHTML += '<div class="step-status">🗂️ Step 4: Building customer receipt map...</div>';
    
    buildCustomerReceiptMap(allReceipts);
    
    statusDiv.innerHTML += `<div class="step-success">✅ Step 4 Complete: Mapped receipts to customers</div>`;
    
    // Final status
    const finalStats = customerResolutionService.getStats();
    statusDiv.innerHTML += `
      <div class="final-status">
        🎉 Customer resolution completed successfully!
        <div class="final-stats">
          <span>📊 Total Receipts: ${allReceipts.length}</span>
          <span>👥 Unique Customers: ${finalStats.totalCustomers}</span>
          <span>🔗 Total Mappings: ${finalStats.totalMappings}</span>
          <span>📝 Updated Documents: ${updateResults.updatedCount}</span>
        </div>
      </div>
    `;
    
    // Show action buttons
    document.getElementById('viewCustomersBtn').style.display = 'inline-block';
    document.getElementById('refreshCustomersBtn').style.display = 'inline-block';
    
  } catch (error) {
    console.error('Error processing customers:', error);
    statusDiv.innerHTML += `<div class="error">❌ Error: ${error.message}</div>`;
  } finally {
    // Re-enable button
    processBtn.disabled = false;
    processBtn.textContent = '🔄 Process Customer Resolution';
  }
}

// Fetch all receipts from Appwrite
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
    } catch (error) {
      console.error('Error fetching receipts:', error);
      throw new Error(`Failed to fetch receipts: ${error.message}`);
    }
  }
  
  return receipts;
}

// Process customer resolution step
async function processCustomerResolutionStep(receipts) {
  let processedCount = 0;
  const totalReceipts = receipts.length;
  
  for (const receipt of receipts) {
    // Resolve customer and get commonId
    const commonId = customerResolutionService.resolveCustomer(
      receipt.customerName, 
      receipt.storeName
    );
    
    // Store commonId in receipt object for later use
    receipt.resolvedCommonId = commonId;
    
    processedCount++;
    
    // Update status every 50 receipts
    if (processedCount % 50 === 0) {
      const statusDiv = document.getElementById('customerProcessingStatus');
      statusDiv.innerHTML += `<div class="progress-status">🔄 Processed ${processedCount}/${totalReceipts} receipts...</div>`;
    }
  }
  
  return {
    totalCustomers: customerResolutionService.getStats().totalCustomers,
    processedReceipts: processedCount
  };
}

// Update Appwrite documents with commonId
async function updateAppwriteDocuments(receipts) {
  let updatedCount = 0;
  let errorCount = 0;
  const totalReceipts = receipts.length;
  
  for (const receipt of receipts) {
    try {
      // Only update if receipt doesn't have commonId or if it's different
      if (!receipt.commonId || receipt.commonId !== receipt.resolvedCommonId) {
        await databases.updateDocument(
          databaseId,
          '689d4a4b000b62bd70ca', // allreceipt collection ID
          receipt.$id,
          { commonId: receipt.resolvedCommonId }
        );
        updatedCount++;
        
        // Also update the receipt object
        receipt.commonId = receipt.resolvedCommonId;
      }
    } catch (error) {
      console.warn(`Could not update receipt ${receipt.$id}:`, error);
      errorCount++;
    }
    
    // Update status every 25 receipts
    if ((updatedCount + errorCount) % 25 === 0) {
      const statusDiv = document.getElementById('customerProcessingStatus');
      statusDiv.innerHTML += `<div class="progress-status">📝 Updated ${updatedCount}/${totalReceipts} documents...</div>`;
    }
  }
  
  return {
    updatedCount,
    errorCount,
    totalReceipts
  };
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
        <h2>${customer.primaryName || 'Unknown Customer'}</h2>
        <p class="customer-store">${customer.primaryStore || 'No Store'}</p>
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
              <span class="info-label">Primary Name:</span>
              <span class="info-value">${customer.primaryName || 'Unknown'}</span>
            </div>
            <div class="info-row">
              <span class="info-label">Primary Store:</span>
              <span class="info-value">${customer.primaryStore || 'No Store'}</span>
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
    // Clear existing data
    allReceipts = [];
    customerReceiptsMap.clear();
    
    // Re-fetch and reprocess
    await processCustomerResolution();
    
    // Refresh display
    await displayResolvedCustomers();
    
  } catch (error) {
    console.error('Error refreshing customer data:', error);
    alert(`Error refreshing data: ${error.message}`);
  }
}

// Clear customer data
function clearCustomerData() {
  if (confirm('Are you sure you want to clear all customer data? This will remove all customer mappings and require reprocessing.')) {
    customerResolutionService.clearData();
    allReceipts = [];
    customerReceiptsMap.clear();
    
    // Reset UI
    document.getElementById('customerProcessingStatus').innerHTML = '';
    document.getElementById('customersList').innerHTML = '';
    document.getElementById('viewCustomersBtn').style.display = 'none';
    document.getElementById('refreshCustomersBtn').style.display = 'none';
    
    alert('Customer data cleared successfully.');
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
}
