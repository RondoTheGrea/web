// Customer Utility Functions
// Helper functions for customer data processing

// Parse CSV string from orderItem or returnItem
function parseItemCSV(csvString) {
  if (!csvString || typeof csvString !== 'string') return [];
  
  return csvString.split('\n')
    .filter(line => line.trim())
    .map(line => {
      const parts = line.split(',');
      if (parts.length >= 4) {
        return {
          name: parts[0]?.trim() || '',
          quantity: parseInt(parts[1]) || 0,
          price: parseFloat(parts[2]) || 0,
          total: parseFloat(parts[3]) || 0
        };
      }
      return null;
    })
    .filter(item => item !== null);
}

// Calculate total from items
function calculateItemsTotal(items) {
  return items.reduce((sum, item) => sum + (item.total || 0), 0);
}

// Format currency
function formatCurrency(amount) {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP'
  }).format(amount || 0);
}

// Format date
function formatDate(dateString) {
  if (!dateString) return 'Unknown';
  
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-PH', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  } catch (e) {
    return dateString;
  }
}

// Format time
function formatTime(timeString) {
  if (!timeString) return 'Unknown';
  
  try {
    // Handle both HH:MM:SS and HH:MM formats
    const timeParts = timeString.split(':');
    if (timeParts.length >= 2) {
      const hours = parseInt(timeParts[0]);
      const minutes = parseInt(timeParts[1]);
      const ampm = hours >= 12 ? 'PM' : 'AM';
      const displayHours = hours % 12 || 12;
      return `${displayHours}:${minutes.toString().padStart(2, '0')} ${ampm}`;
    }
    return timeString;
  } catch (e) {
    return timeString;
  }
}

// Generate customer summary statistics
function generateCustomerStats(receipts) {
  if (!receipts || receipts.length === 0) {
    return {
      totalReceipts: 0,
      totalSpent: 0,
      averageOrder: 0,
      firstOrder: null,
      lastOrder: null,
      favoriteItems: [],
      paymentMethods: {},
      totalReturns: 0
    };
  }

  const stats = {
    totalReceipts: receipts.length,
    totalSpent: 0,
    averageOrder: 0,
    firstOrder: null,
    lastOrder: null,
    favoriteItems: new Map(),
    paymentMethods: {},
    totalReturns: 0
  };

  const allItems = new Map();
  const allReturnItems = new Map();

  receipts.forEach(receipt => {
    // Total spent
    stats.totalSpent += receipt.total || 0;

    // Dates
    const receiptDate = new Date(receipt.date);
    if (!stats.firstOrder || receiptDate < new Date(stats.firstOrder)) {
      stats.firstOrder = receipt.date;
    }
    if (!stats.lastOrder || receiptDate > new Date(stats.lastOrder)) {
      stats.lastOrder = receipt.date;
    }

    // Payment methods
    if (receipt.paymentMethod) {
      stats.paymentMethods[receipt.paymentMethod] = (stats.paymentMethods[receipt.paymentMethod] || 0) + 1;
    }

    // Order items
    if (receipt.orderItem) {
      const items = parseItemCSV(receipt.orderItem);
      items.forEach(item => {
        const key = item.name;
        if (allItems.has(key)) {
          allItems.get(key).quantity += item.quantity;
          allItems.get(key).total += item.total;
        } else {
          allItems.set(key, { ...item });
        }
      });
    }

    // Return items
    if (receipt.returnItem) {
      const returnItems = parseItemCSV(receipt.returnItem);
      returnItems.forEach(item => {
        stats.totalReturns += item.total;
        const key = item.name;
        if (allReturnItems.has(key)) {
          allReturnItems.get(key).quantity += item.quantity;
          allReturnItems.get(key).total += item.total;
        } else {
          allReturnItems.set(key, { ...item });
        }
      });
    }
  });

  // Calculate average order
  stats.averageOrder = stats.totalSpent / stats.totalReceipts;

  // Get favorite items (top 5 by quantity)
  stats.favoriteItems = Array.from(allItems.values())
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 5);

  // Convert payment methods to array format
  stats.paymentMethods = Object.entries(stats.paymentMethods)
    .map(([method, count]) => ({ method, count }))
    .sort((a, b) => b.count - a.count);

  return stats;
}

// Create customer card HTML
function createCustomerCard(customer, stats) {
  const card = document.createElement('div');
  card.className = 'customer-card';
  card.setAttribute('data-common-id', customer.commonId);
  
  card.innerHTML = `
    <div class="customer-header">
      <h2 class="store-name">${customer.primaryStore || 'Unknown Store'}</h2>
      <h3 class="customer-name">${customer.primaryName || 'Unknown Customer'}</h3>
    </div>
    
    <div class="customer-stats">
      <div class="stat-item">
        <span class="stat-icon">🧾</span>
        <span class="stat-value">${stats.totalReceipts}</span>
        <span class="stat-label">Receipts</span>
      </div>
      <div class="stat-item">
        <span class="stat-icon">💰</span>
        <span class="stat-value">${formatCurrency(stats.totalSpent)}</span>
        <span class="stat-label">Total Spent</span>
      </div>
      <div class="stat-item">
        <span class="stat-icon">📊</span>
        <span class="stat-value">${formatCurrency(stats.averageOrder)}</span>
        <span class="stat-label">Avg Order</span>
      </div>
    </div>
    
    <div class="customer-dates">
      <div class="date-item">
        <span class="date-label">First Order:</span>
        <span class="date-value">${formatDate(stats.firstOrder)}</span>
      </div>
      <div class="date-item">
        <span class="date-label">Last Order:</span>
        <span class="date-value">${formatDate(stats.lastOrder)}</span>
      </div>
    </div>
    
    <div class="customer-actions">
      <button class="btn-view-history" onclick="viewCustomerHistory('${customer.commonId}')">
        📋 View History
      </button>
      <button class="btn-view-details" onclick="viewCustomerDetails('${customer.commonId}')">
        👤 View Details
      </button>
    </div>
  `;
  
  return card;
}

// Create receipt item HTML for customer history
function createReceiptItem(receipt) {
  const orderItems = parseItemCSV(receipt.orderItem);
  const returnItems = parseItemCSV(receipt.returnItem);
  const orderTotal = calculateItemsTotal(orderItems);
  const returnTotal = calculateItemsTotal(returnItems);
  const netTotal = orderTotal - returnTotal;

  const item = document.createElement('div');
  item.className = 'receipt-item';
  
  item.innerHTML = `
    <div class="receipt-header">
      <div class="receipt-date-time">
        <span class="receipt-date">${formatDate(receipt.date)}</span>
        <span class="receipt-time">${formatTime(receipt.time)}</span>
      </div>
      <div class="receipt-total">
        <span class="total-label">Total:</span>
        <span class="total-amount">${formatCurrency(netTotal)}</span>
      </div>
    </div>
    
    <div class="receipt-details">
      <div class="receipt-items">
        <h4>Order Items:</h4>
        ${orderItems.map(item => `
          <div class="item-row">
            <span class="item-name">${item.name}</span>
            <span class="item-quantity">${item.quantity}x</span>
            <span class="item-price">${formatCurrency(item.price)}</span>
            <span class="item-total">${formatCurrency(item.total)}</span>
          </div>
        `).join('')}
      </div>
      
      ${returnItems.length > 0 ? `
        <div class="receipt-returns">
          <h4>Returns:</h4>
          ${returnItems.map(item => `
            <div class="item-row return-item">
              <span class="item-name">${item.name}</span>
              <span class="item-quantity">${item.quantity}x</span>
              <span class="item-price">${formatCurrency(item.price)}</span>
              <span class="item-total">-${formatCurrency(item.total)}</span>
            </div>
          `).join('')}
        </div>
      ` : ''}
      
      <div class="receipt-summary">
        <div class="summary-row">
          <span>Order Total:</span>
          <span>${formatCurrency(orderTotal)}</span>
        </div>
        ${returnItems.length > 0 ? `
          <div class="summary-row">
            <span>Returns:</span>
            <span>-${formatCurrency(returnTotal)}</span>
          </div>
        ` : ''}
        <div class="summary-row final-total">
          <span>Net Total:</span>
          <span>${formatCurrency(netTotal)}</span>
        </div>
      </div>
    </div>
  `;
  
  return item;
}

// Export functions for use in other files
if (typeof window !== 'undefined') {
  window.customerUtils = {
    parseItemCSV,
    calculateItemsTotal,
    formatCurrency,
    formatDate,
    formatTime,
    generateCustomerStats,
    createCustomerCard,
    createReceiptItem
  };
}
