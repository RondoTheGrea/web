// Customer Resolution Service
// Handles customer deduplication and commonId assignment

class CustomerResolutionService {
  constructor() {
    this.customers = new Map(); // commonId -> customer data
    this.nameMappings = new Map(); // normalized name -> commonId
    this.loadFromLocalStorage();
  }

  // Normalize customer names for comparison
  normalizeName(name) {
    if (!name) return '';
    return name.toLowerCase()
      .replace(/[^\w\s]/g, '') // Remove special characters
      .replace(/\s+/g, ' ')    // Normalize spaces
      .trim();
  }

  // Calculate similarity between two names (Jaccard similarity)
  calculateSimilarity(name1, name2) {
    if (!name1 || !name2) return 0;
    
    const set1 = new Set(name1.split(''));
    const set2 = new Set(name2.split(''));
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    
    return intersection.size / union.size;
  }

  // Check if two customers are likely the same person
  isLikelySameCustomer(name1, store1, name2, store2) {
    const normalizedName1 = this.normalizeName(name1);
    const normalizedName2 = this.normalizeName(name2);
    const normalizedStore1 = this.normalizeName(store1);
    const normalizedStore2 = this.normalizeName(store2);

    // Exact match
    if (normalizedName1 === normalizedName2 && normalizedStore1 === normalizedStore2) {
      return true;
    }

    // High name similarity (likely same person)
    const nameSimilarity = this.calculateSimilarity(normalizedName1, normalizedName2);
    if (nameSimilarity > 0.8) {
      // If names are very similar, check store similarity
      const storeSimilarity = this.calculateSimilarity(normalizedStore1, normalizedStore2);
      return storeSimilarity > 0.6; // Lower threshold for store names
    }

    // Check for common abbreviations or variations
    const nameVariations = this.getCommonVariations(normalizedName1);
    if (nameVariations.includes(normalizedName2)) {
      return true;
    }

    return false;
  }

  // Get common name variations
  getCommonVariations(name) {
    const variations = [];
    
    // Split name into parts
    const parts = name.split(' ');
    
    // Add first name only
    if (parts.length > 1) {
      variations.push(parts[0]);
    }
    
    // Add initials
    if (parts.length > 1) {
      const initials = parts.map(part => part.charAt(0)).join('');
      variations.push(initials);
    }
    
    // Add first + last
    if (parts.length > 2) {
      variations.push(parts[0] + ' ' + parts[parts.length - 1]);
    }
    
    return variations;
  }

  // Resolve customer and return commonId
  resolveCustomer(customerName, storeName) {
    const normalizedName = this.normalizeName(customerName);
    const normalizedStore = storeName ? this.normalizeName(storeName) : '';
    const fullKey = `${normalizedName}|${normalizedStore}`;

    // Check for exact match
    if (this.nameMappings.has(fullKey)) {
      return this.nameMappings.get(fullKey);
    }

    // Check for fuzzy matches
    let bestMatch = null;
    let bestSimilarity = 0.7; // Threshold for similarity

    for (const [key, commonId] of this.nameMappings) {
      const [existingName, existingStore] = key.split('|');
      
      if (this.isLikelySameCustomer(normalizedName, normalizedStore, existingName, existingStore)) {
        // Use existing customer
        this.nameMappings.set(fullKey, commonId);
        this.saveToLocalStorage();
        return commonId;
      }
    }

    // Create new customer
    const newCommonId = this.generateCommonId();
    this.customers.set(newCommonId, {
      commonId: newCommonId,
      primaryName: customerName,
      primaryStore: storeName,
      aliases: [fullKey],
      totalReceipts: 0,
      totalSpent: 0,
      firstOrder: new Date().toISOString(),
      lastOrder: new Date().toISOString()
    });

    this.nameMappings.set(fullKey, newCommonId);
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

  // Save to localStorage
  saveToLocalStorage() {
    try {
      localStorage.setItem('customerMappings', JSON.stringify({
        customers: Array.from(this.customers.entries()),
        nameMappings: Array.from(this.nameMappings.entries())
      }));
    } catch (e) {
      console.warn('Could not save customer mappings:', e);
    }
  }

  // Load from localStorage
  loadFromLocalStorage() {
    try {
      const saved = JSON.parse(localStorage.getItem('customerMappings') || '{}');
      if (saved.customers) {
        this.customers = new Map(saved.customers);
      }
      if (saved.nameMappings) {
        this.nameMappings = new Map(saved.nameMappings);
      }
    } catch (e) {
      console.warn('Could not load customer mappings:', e);
    }
  }

  // Clear all data (for testing/reset)
  clearData() {
    this.customers.clear();
    this.nameMappings.clear();
    localStorage.removeItem('customerMappings');
  }

  // Get statistics
  getStats() {
    return {
      totalCustomers: this.customers.size,
      totalMappings: this.nameMappings.size
    };
  }
}

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CustomerResolutionService;
}
