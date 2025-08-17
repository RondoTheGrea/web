// Customer Resolution Service
// Enhanced customer deduplication with store validation, alias caching, and incremental processing
// Uses customer name as anchor and store name as validator to prevent false merges

class CustomerResolutionService {
  constructor() {
    // Core data structures
    this.customers = new Map(); // commonId -> customer data
    this.aliasCache = new Map(); // aliasKey (normCustomer|normStore) -> commonId
    this.customersByName = new Map(); // normCustomer -> Set<commonId>
    this.manualReviewQueue = new Set(); // aliases requiring manual review
    
    // Thresholds for similarity matching
    this.thresholds = {
      NAME_STRONG: 0.93,
      NAME_BORDER: 0.86,
      STORE_STRONG: 0.90,
      STORE_BORDER: 0.84,
      LEV_SMALL: 2
    };
    
    // Store normalization dictionary
    this.storeNormalizations = new Map([
      ['7 eleven', '7-11'],
      ['seven eleven', '7-11'],
      ['inc.', ''],
      ['inc', ''],
      ['llc.', ''],
      ['llc', ''],
      ['ltd.', ''],
      ['ltd', ''],
      ['corp.', ''],
      ['corp', ''],
      ['co.', ''],
      ['company', 'co'],
      ['market', 'mkt'],
      ['grocery', 'groc'],
      ['department', 'dept'],
      ['restaurant', 'rest'],
      ['pharmacy', 'pharm']
    ]);
    
    this.loadFromLocalStorage();
  }

  // Enhanced normalization for customer names and store names
  normalizeText(text) {
    if (!text) return '';
    
    let normalized = text.toLowerCase().trim();
    
    // Remove punctuation except hyphens and apostrophes
    normalized = normalized.replace(/[^\w\s'-]/g, ' ');
    
    // Collapse multiple spaces
    normalized = normalized.replace(/\s+/g, ' ');
    
    // Normalize common abbreviations and words
    const wordReplacements = new Map([
      ['street', 'st'],
      ['avenue', 'ave'],
      ['boulevard', 'blvd'],
      ['drive', 'dr'],
      ['saint', 'st'],
      ['mount', 'mt'],
      ['north', 'n'],
      ['south', 's'],
      ['east', 'e'],
      ['west', 'w'],
      ['&', 'and']
    ]);
    
    for (const [full, abbrev] of wordReplacements) {
      const regex = new RegExp(`\\b${full}\\b`, 'g');
      normalized = normalized.replace(regex, abbrev);
    }
    
    return normalized.trim();
  }

  // Normalize store names with additional business-specific rules
  normalizeStore(storeName) {
    if (!storeName) return '';
    
    let normalized = this.normalizeText(storeName);
    
    // Apply store-specific normalizations
    for (const [original, replacement] of this.storeNormalizations) {
      const regex = new RegExp(`\\b${original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
      normalized = normalized.replace(regex, replacement);
    }
    
    // Remove trailing/leading business suffixes
    normalized = normalized.replace(/\b(inc|llc|corp|ltd|co)\b\.?$/g, '');
    normalized = normalized.trim();
    
    return normalized;
  }

  // Generate alias key for caching
  generateAliasKey(customerName, storeName) {
    const normCustomer = this.normalizeText(customerName);
    const normStore = this.normalizeStore(storeName);
    return `${normCustomer}|${normStore}`;
  }

  // Calculate Jaro-Winkler Distance between two strings
  calculateJaroWinkler(str1, str2) {
    if (!str1 || !str2) return 0;
    if (str1 === str2) return 1.0;

    const len1 = str1.length;
    const len2 = str2.length;
    
    if (len1 === 0 || len2 === 0) return 0.0;

    // Calculate Jaro Distance
    const matchDistance = Math.floor(Math.max(len1, len2) / 2) - 1;
    if (matchDistance < 0) return 0.0;

    const str1Matches = new Array(len1).fill(false);
    const str2Matches = new Array(len2).fill(false);

    let matches = 0;
    let transpositions = 0;

    // Find matches
    for (let i = 0; i < len1; i++) {
      const start = Math.max(0, i - matchDistance);
      const end = Math.min(i + matchDistance + 1, len2);

      for (let j = start; j < end; j++) {
        if (str2Matches[j] || str1[i] !== str2[j]) continue;
        str1Matches[i] = true;
        str2Matches[j] = true;
        matches++;
        break;
      }
    }

    if (matches === 0) return 0.0;

    // Count transpositions
    let k = 0;
    for (let i = 0; i < len1; i++) {
      if (!str1Matches[i]) continue;
      while (!str2Matches[k]) k++;
      if (str1[i] !== str2[k]) transpositions++;
      k++;
    }

    const jaroDistance = (matches / len1 + matches / len2 + (matches - transpositions / 2) / matches) / 3;

    // Calculate Winkler modification
    let prefix = 0;
    for (let i = 0; i < Math.min(4, Math.min(len1, len2)); i++) {
      if (str1[i] === str2[i]) {
        prefix++;
      } else {
        break;
      }
    }

    const winklerModifier = 0.1 * prefix * (1 - jaroDistance);
    return jaroDistance + winklerModifier;
  }

  // Calculate Levenshtein Distance between two strings
  calculateLevenshtein(str1, str2) {
    if (!str1 || !str2) return Math.max(str1?.length || 0, str2?.length || 0);
    if (str1 === str2) return 0;

    const len1 = str1.length;
    const len2 = str2.length;

    // Create matrix
    const matrix = Array(len1 + 1).fill(null).map(() => Array(len2 + 1).fill(null));

    // Initialize first row and column
    for (let i = 0; i <= len1; i++) matrix[i][0] = i;
    for (let j = 0; j <= len2; j++) matrix[0][j] = j;

    // Fill matrix
    for (let i = 1; i <= len1; i++) {
      for (let j = 1; j <= len2; j++) {
        const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,      // deletion
          matrix[i][j - 1] + 1,      // insertion
          matrix[i - 1][j - 1] + cost // substitution
        );
      }
    }

    return matrix[len1][len2];
  }

  // Enhanced customer resolution with store validation
  resolveCustomer(customerName, storeName = '') {
    if (!customerName) {
      throw new Error('Customer name is required');
    }

    const normCustomer = this.normalizeText(customerName);
    const normStore = this.normalizeStore(storeName);
    const aliasKey = this.generateAliasKey(customerName, storeName);

    // Step 2: Fast-path lookup
    if (this.aliasCache.has(aliasKey)) {
      return this.aliasCache.get(aliasKey);
    }

    // Step 3: Get candidate set - customers with same normalized name
    const candidates = this.customersByName.get(normCustomer) || new Set();
    
    if (candidates.size === 0) {
      // No candidates, create new customer
      return this.createNewCustomer(customerName, storeName, normCustomer, normStore, aliasKey);
    }

    // Step 4 & 5: Apply decision rules to candidates
    const bestMatch = this.findBestMatch(normCustomer, normStore, candidates);
    
    if (bestMatch.type === 'MATCHED') {
      // Update alias cache and return existing customer
      this.aliasCache.set(aliasKey, bestMatch.commonId);
      this.saveToLocalStorage();
      return bestMatch.commonId;
    } else if (bestMatch.type === 'AMBIGUOUS') {
      // Add to manual review queue
      this.manualReviewQueue.add({
        aliasKey,
        customerName,
        storeName,
        candidates: Array.from(candidates),
        timestamp: new Date().toISOString()
      });
      this.saveToLocalStorage();
      
      // For now, create new customer but flag for review
      const newCommonId = this.createNewCustomer(customerName, storeName, normCustomer, normStore, aliasKey);
      console.warn(`Customer "${customerName}" at "${storeName}" added to manual review queue`);
      return newCommonId;
    } else {
      // NEW_CUSTOMER
      return this.createNewCustomer(customerName, storeName, normCustomer, normStore, aliasKey);
    }
  }

  // Find best matching candidate using decision rules
  findBestMatch(normCustomer, normStore, candidates) {
    let bestScore = 0;
    let bestCandidate = null;
    const potentialMatches = [];

    for (const commonId of candidates) {
      const customer = this.customers.get(commonId);
      if (!customer) continue;

      // Get all aliases for this customer to find best name match
      const nameScores = customer.aliases.map(alias => {
        const aliasNormCustomer = alias.split('|')[0];
        return this.calculateJaroWinkler(normCustomer, aliasNormCustomer);
      });
      
      const bestNameScore = Math.max(...nameScores);
      
      // Step 5.1: Customer Gate (required)
      let passesNameGate = false;
      
      if (bestNameScore >= this.thresholds.NAME_STRONG) {
        passesNameGate = true;
      } else if (bestNameScore >= this.thresholds.NAME_BORDER) {
        // Check Levenshtein for borderline cases
        const bestAlias = customer.aliases.find(alias => {
          const aliasNormCustomer = alias.split('|')[0];
          return this.calculateJaroWinkler(normCustomer, aliasNormCustomer) === bestNameScore;
        });
        
        if (bestAlias) {
          const aliasNormCustomer = bestAlias.split('|')[0];
          const levDistance = this.calculateLevenshtein(normCustomer, aliasNormCustomer);
          if (levDistance <= this.thresholds.LEV_SMALL) {
            passesNameGate = true;
          }
        }
      }
      
      if (!passesNameGate) continue;

      // Step 5.2: Store Validation (secondary)
      let passesStoreGate = false;
      let bestStoreScore = 0;
      
      if (!normStore) {
        // No store provided, accept based on name alone
        passesStoreGate = true;
        bestStoreScore = 1.0;
      } else {
        // Check store similarity against customer's store aliases
        const storeScores = customer.aliases.map(alias => {
          const aliasNormStore = alias.split('|')[1] || '';
          if (!aliasNormStore) return 0;
          return this.calculateJaroWinkler(normStore, aliasNormStore);
        });
        
        bestStoreScore = Math.max(0, ...storeScores);
        
        if (bestStoreScore >= this.thresholds.STORE_STRONG) {
          passesStoreGate = true;
        } else if (bestStoreScore >= this.thresholds.STORE_BORDER) {
          // Check Levenshtein for store
          const bestStoreAlias = customer.aliases.find(alias => {
            const aliasNormStore = alias.split('|')[1] || '';
            return aliasNormStore && this.calculateJaroWinkler(normStore, aliasNormStore) === bestStoreScore;
          });
          
          if (bestStoreAlias) {
            const aliasNormStore = bestStoreAlias.split('|')[1];
            const levDistance = this.calculateLevenshtein(normStore, aliasNormStore);
            if (levDistance <= this.thresholds.LEV_SMALL) {
              passesStoreGate = true;
            }
          }
        }
      }
      
      if (passesStoreGate) {
        const combinedScore = (bestNameScore + bestStoreScore) / 2;
        potentialMatches.push({
          commonId,
          nameScore: bestNameScore,
          storeScore: bestStoreScore,
          combinedScore
        });
        
        if (combinedScore > bestScore) {
          bestScore = combinedScore;
          bestCandidate = commonId;
        }
      }
    }

    // Step 5.3: Collision Guard
    if (potentialMatches.length > 1) {
      // Check if multiple customers have same name but different stores
      const nameGroups = new Map();
      
      for (const match of potentialMatches) {
        const customer = this.customers.get(match.commonId);
        const primaryName = this.normalizeText(customer.primaryName);
        
        if (!nameGroups.has(primaryName)) {
          nameGroups.set(primaryName, []);
        }
        nameGroups.get(primaryName).push(match);
      }
      
      // If we have multiple strong matches with different stores, flag for review
      const strongMatches = potentialMatches.filter(m => 
        m.nameScore >= this.thresholds.NAME_STRONG && 
        m.storeScore < this.thresholds.STORE_STRONG
      );
      
      if (strongMatches.length > 1) {
        return { type: 'AMBIGUOUS', matches: potentialMatches };
      }
    }

    if (bestCandidate) {
      return { type: 'MATCHED', commonId: bestCandidate, score: bestScore };
    }
    
    return { type: 'NEW_CUSTOMER' };
  }

  // Create new customer record
  createNewCustomer(customerName, storeName, normCustomer, normStore, aliasKey) {
    const newCommonId = this.generateCommonId();
    
    const customer = {
      commonId: newCommonId,
      primaryName: customerName,
      primaryStore: storeName,
      aliases: [aliasKey],
      totalReceipts: 0,
      totalSpent: 0,
      firstOrder: new Date().toISOString(),
      lastOrder: new Date().toISOString(),
      createdAt: new Date().toISOString()
    };
    
    this.customers.set(newCommonId, customer);
    this.aliasCache.set(aliasKey, newCommonId);
    
    // Add to name-based index
    if (!this.customersByName.has(normCustomer)) {
      this.customersByName.set(normCustomer, new Set());
    }
    this.customersByName.get(normCustomer).add(newCommonId);
    
    this.saveToLocalStorage();
    return newCommonId;
  }

  // Generate unique commonId
  generateCommonId() {
    return 'cust_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  // Get customer info by commonId
  getCustomerInfo(commonId) {
    return this.customers.get(commonId);
  }

  // Get all customers
  getAllCustomers() {
    return Array.from(this.customers.values());
  }

  // Legacy methods for backward compatibility
  getCustomerByName(customerName) {
    const normCustomer = this.normalizeText(customerName);
    const commonIds = this.customersByName.get(normCustomer);
    
    if (commonIds && commonIds.size > 0) {
      // Return first match for backward compatibility
      const firstCommonId = Array.from(commonIds)[0];
      return this.customers.get(firstCommonId);
    }
    
    return null;
  }

  // Batch process receipts (for initial processing)
  batchResolveCustomers(receipts) {
    const results = [];
    
    for (const receipt of receipts) {
      try {
        const commonId = this.resolveCustomer(
          receipt.customerName || receipt.customer, 
          receipt.storeName || receipt.store
        );
        
        results.push({
          receiptId: receipt.id,
          customerName: receipt.customerName || receipt.customer,
          storeName: receipt.storeName || receipt.store,
          commonId,
          success: true
        });
      } catch (error) {
        results.push({
          receiptId: receipt.id,
          customerName: receipt.customerName || receipt.customer,
          storeName: receipt.storeName || receipt.store,
          commonId: null,
          success: false,
          error: error.message
        });
      }
    }
    
    return results;
  }

  // Process receipts incrementally (only new ones since last processing)
  processNewReceipts(receipts) {
    if (!receipts || receipts.length === 0) {
      console.log('No receipts to process');
      return { processedCount: 0, results: [] };
    }
    
    console.log(`Processing ${receipts.length} receipts...`);
    
    const results = [];
    
    for (const receipt of receipts) {
      try {
        // Extract store name safely
        const storeName = receipt.storeName || receipt.store || '';
        
        const commonId = this.resolveCustomer(receipt.customerName, storeName);
        
        // Update customer statistics
        this.updateCustomerStats(commonId, receipt);
        
        // Set resolved ID on receipt for updating Appwrite
        receipt.resolvedCommonId = commonId;
        
        results.push({
          receiptId: receipt.id || receipt.$id,
          customerName: receipt.customerName,
          storeName: storeName,
          commonId,
          success: true
        });
        
      } catch (error) {
        console.warn(`Error processing receipt ${receipt.id || receipt.$id}:`, error);
        results.push({
          receiptId: receipt.id || receipt.$id,
          customerName: receipt.customerName,
          storeName: receipt.storeName || '',
          commonId: null,
          success: false,
          error: error.message
        });
      }
    }
    
    this.saveToLocalStorage();
    
    return {
      processedCount: results.filter(r => r.success).length,
      results,
      totalProcessed: receipts.length
    };
  }

  // Update customer statistics from receipt
  updateCustomerStats(commonId, receipt) {
    const customer = this.customers.get(commonId);
    if (!customer) return;
    
    customer.totalReceipts++;
    customer.totalSpent += parseFloat(receipt.total || 0);
    customer.lastOrder = receipt.date;
    
    // Update first order if this is earlier
    if (new Date(receipt.date) < new Date(customer.firstOrder)) {
      customer.firstOrder = receipt.date;
    }
    
    // Add alias if not already present
    const aliasKey = this.generateAliasKey(receipt.customerName, receipt.storeName);
    if (!customer.aliases.includes(aliasKey)) {
      customer.aliases.push(aliasKey);
    }
  }

  // Get last processed date from localStorage
  getLastProcessedDate() {
    try {
      const dateStr = localStorage.getItem('lastProcessedDate');
      return dateStr ? new Date(dateStr) : null;
    } catch (e) {
      console.warn('Could not get last processed date:', e);
      return null;
    }
  }

  // Set last processed date in localStorage
  setLastProcessedDate(date) {
    try {
      localStorage.setItem('lastProcessedDate', date.toISOString());
    } catch (e) {
      console.warn('Could not save last processed date:', e);
    }
  }

  // Manual review methods
  getManualReviewQueue() {
    return Array.from(this.manualReviewQueue);
  }

  resolveManualReview(aliasKey, selectedCommonId) {
    // Remove from review queue
    this.manualReviewQueue.delete(
      Array.from(this.manualReviewQueue).find(item => item.aliasKey === aliasKey)
    );
    
    // Add to alias cache
    this.aliasCache.set(aliasKey, selectedCommonId);
    
    // Update customer aliases
    const customer = this.customers.get(selectedCommonId);
    if (customer && !customer.aliases.includes(aliasKey)) {
      customer.aliases.push(aliasKey);
    }
    
    this.saveToLocalStorage();
  }

  // Enhanced save to localStorage with all new data structures
  saveToLocalStorage() {
    try {
      const data = {
        customers: Array.from(this.customers.entries()),
        aliasCache: Array.from(this.aliasCache.entries()),
        customersByName: Array.from(this.customersByName.entries()).map(([key, value]) => [
          key,
          Array.from(value)
        ]),
        manualReviewQueue: Array.from(this.manualReviewQueue),
        version: '2.0' // Version for migration purposes
      };
      
      localStorage.setItem('customerResolutionData', JSON.stringify(data));
    } catch (e) {
      console.warn('Could not save customer resolution data:', e);
    }
  }

  // Enhanced load from localStorage with migration support
  loadFromLocalStorage() {
    try {
      // Try new format first
      const newData = localStorage.getItem('customerResolutionData');
      if (newData) {
        const parsed = JSON.parse(newData);
        
        if (parsed.customers) {
          this.customers = new Map(parsed.customers);
        }
        if (parsed.aliasCache) {
          this.aliasCache = new Map(parsed.aliasCache);
        }
        if (parsed.customersByName) {
          this.customersByName = new Map(
            parsed.customersByName.map(([key, value]) => [key, new Set(value)])
          );
        }
        if (parsed.manualReviewQueue) {
          this.manualReviewQueue = new Set(parsed.manualReviewQueue);
        }
        
        return; // Successfully loaded new format
      }
      
      // Migration from old format
      const oldData = localStorage.getItem('customerMappings');
      if (oldData) {
        console.log('Migrating from old customer data format...');
        this.migrateFromOldFormat(JSON.parse(oldData));
      }
      
    } catch (e) {
      console.warn('Could not load customer resolution data:', e);
    }
  }

  // Migrate from old data format
  migrateFromOldFormat(oldData) {
    try {
      // Migrate customers
      if (oldData.customers) {
        const oldCustomers = new Map(oldData.customers);
        
        for (const [commonId, customer] of oldCustomers) {
          // Convert old format to new format
          const newCustomer = {
            commonId,
            primaryName: customer.primaryName,
            primaryStore: '', // Old format didn't have store
            aliases: customer.aliases || [],
            totalReceipts: customer.totalReceipts || 0,
            totalSpent: customer.totalSpent || 0,
            firstOrder: customer.firstOrder || new Date().toISOString(),
            lastOrder: customer.lastOrder || new Date().toISOString(),
            createdAt: new Date().toISOString()
          };
          
          this.customers.set(commonId, newCustomer);
          
          // Build customersByName index
          const normName = this.normalizeText(customer.primaryName);
          if (!this.customersByName.has(normName)) {
            this.customersByName.set(normName, new Set());
          }
          this.customersByName.get(normName).add(commonId);
        }
      }
      
      // Migrate name mappings to alias cache
      if (oldData.nameMappings) {
        const oldMappings = new Map(oldData.nameMappings);
        
        for (const [normalizedName, commonId] of oldMappings) {
          // Convert old normalized name to new alias key format
          const aliasKey = `${normalizedName}|`; // Empty store part
          this.aliasCache.set(aliasKey, commonId);
        }
      }
      
      // Save in new format and remove old data
      this.saveToLocalStorage();
      localStorage.removeItem('customerMappings');
      
      console.log('Migration completed successfully');
      
    } catch (e) {
      console.error('Migration failed:', e);
    }
  }

  // Clear all data (for testing/reset)
  clearData() {
    this.customers.clear();
    this.aliasCache.clear();
    this.customersByName.clear();
    this.manualReviewQueue.clear();
    localStorage.removeItem('customerResolutionData');
    localStorage.removeItem('lastProcessedDate');
    localStorage.removeItem('customerMappings'); // Remove old format too
  }

  // Enhanced statistics
  getStats() {
    return {
      totalCustomers: this.customers.size,
      totalAliases: this.aliasCache.size,
      manualReviewCount: this.manualReviewQueue.size,
      lastProcessedDate: this.getLastProcessedDate(),
      nameIndexSize: this.customersByName.size,
      avgAliasesPerCustomer: this.customers.size > 0 ? 
        Array.from(this.customers.values()).reduce((sum, c) => sum + c.aliases.length, 0) / this.customers.size : 0
    };
  }

  // Performance monitoring
  getCacheStats() {
    const totalAliases = this.aliasCache.size;
    const uniqueCustomers = new Set(this.aliasCache.values()).size;
    
    return {
      totalAliases,
      uniqueCustomers,
      cacheEfficiency: totalAliases > 0 ? (uniqueCustomers / totalAliases) * 100 : 0,
      manualReviewRate: this.manualReviewQueue.size
    };
  }

  // Utility methods for debugging and analysis
  getCustomersByStore(storeName) {
    const normStore = this.normalizeStore(storeName);
    const results = [];
    
    for (const customer of this.customers.values()) {
      const hasStore = customer.aliases.some(alias => {
        const aliasStore = alias.split('|')[1] || '';
        return aliasStore === normStore;
      });
      
      if (hasStore) {
        results.push(customer);
      }
    }
    
    return results;
  }

  // Get all unique store names
  getAllStores() {
    const stores = new Set();
    
    for (const customer of this.customers.values()) {
      for (const alias of customer.aliases) {
        const storeName = alias.split('|')[1];
        if (storeName) {
          stores.add(storeName);
        }
      }
    }
    
    return Array.from(stores).sort();
  }

  // Test similarity between two names/stores (for debugging)
  testSimilarity(text1, text2) {
    const jw = this.calculateJaroWinkler(text1, text2);
    const lev = this.calculateLevenshtein(text1, text2);
    
    return {
      jaroWinkler: jw,
      levenshtein: lev,
      strongMatch: jw >= this.thresholds.NAME_STRONG,
      borderlineMatch: jw >= this.thresholds.NAME_BORDER && lev <= this.thresholds.LEV_SMALL
    };
  }

  // Export data for backup or analysis
  exportData() {
    return {
      customers: Array.from(this.customers.entries()),
      aliasCache: Array.from(this.aliasCache.entries()),
      customersByName: Array.from(this.customersByName.entries()).map(([key, value]) => [
        key,
        Array.from(value)
      ]),
      manualReviewQueue: Array.from(this.manualReviewQueue),
      stats: this.getStats(),
      exportDate: new Date().toISOString()
    };
  }

  // Import data from backup
  importData(data) {
    if (data.customers) {
      this.customers = new Map(data.customers);
    }
    if (data.aliasCache) {
      this.aliasCache = new Map(data.aliasCache);
    }
    if (data.customersByName) {
      this.customersByName = new Map(
        data.customersByName.map(([key, value]) => [key, new Set(value)])
      );
    }
    if (data.manualReviewQueue) {
      this.manualReviewQueue = new Set(data.manualReviewQueue);
    }
    
    this.saveToLocalStorage();
  }

}

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CustomerResolutionService;
}
