import { customerConfig } from './customerConfig.js';

// Initialize Appwrite client for customers
const customerClient = new Appwrite.Client();
customerClient.setEndpoint(customerConfig.endpoint).setProject(customerConfig.projectId);
const customerDatabases = new Appwrite.Databases(customerClient);

// Customer service functions
export class CustomerService {
    constructor() {
        this.databaseId = customerConfig.dataBaseId;
        this.collectionId = customerConfig.allreceipt;
        this.localReceipts = null;
        this.localCustomers = null;
        this.dbName = 'CustomerReceiptsDB';
        this.dbVersion = 2; // Increment version to trigger database upgrade
        this.initIndexedDB();
    }

    // Initialize IndexedDB
    async initIndexedDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);
            
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve();
            };
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                const oldVersion = event.oldVersion;
                
                console.log(`Upgrading IndexedDB from version ${oldVersion} to ${this.dbVersion}`);
                
                // Create object stores if they don't exist
                if (!db.objectStoreNames.contains('receipts')) {
                    db.createObjectStore('receipts', { keyPath: 'id' });
                    console.log('Created receipts object store');
                }
                if (!db.objectStoreNames.contains('customers')) {
                    db.createObjectStore('customers', { keyPath: 'customerKey' });
                    console.log('Created customers object store');
                }
                if (!db.objectStoreNames.contains('metadata')) {
                    db.createObjectStore('metadata', { keyPath: 'key' });
                    console.log('Created metadata object store');
                }
                
                // If upgrading from version 1, we need to clear old data to ensure consistency
                if (oldVersion === 1) {
                    console.log('Upgrading from version 1, clearing old data for consistency');
                    // The old data will be automatically cleared when we upgrade
                }
            };
        });
    }

    // Store metadata in IndexedDB
    async storeMetadata(key, value) {
        await this.initIndexedDB();
        const transaction = this.db.transaction(['metadata'], 'readwrite');
        const store = transaction.objectStore('metadata');
        await store.put({ key, value });
    }

    // Get metadata from IndexedDB
    async getMetadata(key) {
        await this.initIndexedDB();
        const transaction = this.db.transaction(['metadata'], 'readonly');
        const store = transaction.objectStore('metadata');
        const request = store.get(key);
        
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result?.value || null);
            request.onerror = () => reject(request.error);
        });
    }

    // Test connection to customer database
    async testConnection() {
        try {
            const health = await customerDatabases.listDocuments(
                this.databaseId, 
                this.collectionId, 
                [Appwrite.Query.limit(1)]
            );
            console.log("Customer database connection successful:", health);
            return true;
        } catch (error) {
            console.error("Customer database connection failed:", error);
            return false;
        }
    }

    // Store receipts in IndexedDB
    async storeReceiptsInIndexedDB(receipts) {
        await this.initIndexedDB();
        const transaction = this.db.transaction(['receipts'], 'readwrite');
        const store = transaction.objectStore('receipts');
        
        // Store new data (don't clear existing)
        for (const receipt of receipts) {
            try {
                await store.put({
                    id: receipt.$id || Math.random().toString(36).substr(2, 9),
                    ...receipt
                });
            } catch (error) {
                console.warn(`Failed to store receipt ${receipt.$id}:`, error);
            }
        }
        
        console.log(`Stored ${receipts.length} receipts in IndexedDB`);
    }

    // Store customers in IndexedDB
    async storeCustomersInIndexedDB(customers) {
        await this.initIndexedDB();
        const transaction = this.db.transaction(['customers'], 'readwrite');
        const store = transaction.objectStore('customers');
        
        // Clear existing customers and store new ones (since we're regenerating the customer list)
        await store.clear();
        
        // Store new data
        for (const customer of customers) {
            const customerKey = `${customer.customerName}|${customer.storeName}`;
            await store.put({
                customerKey,
                ...customer
            });
        }
        
        console.log(`Stored ${customers.length} customers in IndexedDB`);
    }

    // Get receipts from IndexedDB
    async getReceiptsFromIndexedDB() {
        await this.initIndexedDB();
        const transaction = this.db.transaction(['receipts'], 'readonly');
        const store = transaction.objectStore('receipts');
        const request = store.getAll();
        
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    // Get customers from IndexedDB
    async getCustomersFromIndexedDB() {
        await this.initIndexedDB();
        const transaction = this.db.transaction(['customers'], 'readonly');
        const store = transaction.objectStore('customers');
        const request = store.getAll();
        
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    // Get count of documents in database
    async getDatabaseDocumentCount() {
        try {
            const response = await customerDatabases.listDocuments(
                this.databaseId,
                this.collectionId,
                [Appwrite.Query.limit(1)]
            );
            return response.total;
        } catch (error) {
            console.error("Error getting document count:", error);
            return 0;
        }
    }

    // Fetch only new receipts since last fetch
    async fetchNewReceiptsOnly(progressCallback) {
        try {
            // Get the last processed receipt ID and date from metadata
            const lastProcessedId = await this.getMetadata('lastProcessedReceiptId');
            const lastProcessedDate = await this.getMetadata('lastProcessedDate');
            
            // Get current document count in database
            const currentDbCount = await this.getDatabaseDocumentCount();
            const localReceipts = await this.getReceiptsFromIndexedDB();
            const localCount = localReceipts.length;
            
            progressCallback(`Checking for new receipts... (Local: ${localCount}, Database: ${currentDbCount})`, 0);
            
            // If local count matches database count and we have metadata, no new receipts
            if (localCount === currentDbCount && lastProcessedId && lastProcessedDate) {
                progressCallback(`No new receipts found. Using ${localCount} existing receipts.`, localCount);
                return localReceipts;
            }
            
            // If we have receipts locally and metadata, try to fetch only new ones
            if (localReceipts.length > 0 && lastProcessedDate) {
                progressCallback("Fetching only new receipts since last update...", 0);
                
                // Fetch receipts newer than the last processed date
                const newReceipts = await this.fetchReceiptsAfterDate(lastProcessedDate, progressCallback);
                
                if (newReceipts.length > 0) {
                    // Remove duplicates by ID before combining
                    const existingIds = new Set(localReceipts.map(r => r.$id));
                    const uniqueNewReceipts = newReceipts.filter(r => !existingIds.has(r.$id));
                    
                    if (uniqueNewReceipts.length === 0) {
                        progressCallback("No truly new receipts found. Using existing data.", localReceipts.length);
                        // Update metadata to prevent future unnecessary checks
                        const latestLocalReceipt = localReceipts.reduce((latest, current) => 
                            new Date(current.date) > new Date(latest.date) ? current : latest
                        );
                        await this.storeMetadata('lastProcessedReceiptId', latestLocalReceipt.$id);
                        await this.storeMetadata('lastProcessedDate', latestLocalReceipt.date);
                        return localReceipts;
                    }
                    
                    // Combine existing and new receipts
                    const allReceipts = [...localReceipts, ...uniqueNewReceipts];
                    
                    // Store new receipts in IndexedDB
                    await this.storeReceiptsInIndexedDB(uniqueNewReceipts);
                    
                    // Update metadata with latest receipt info
                    const latestReceipt = allReceipts.reduce((latest, current) => 
                        new Date(current.date) > new Date(latest.date) ? current : latest
                    );
                    await this.storeMetadata('lastProcessedReceiptId', latestReceipt.$id);
                    await this.storeMetadata('lastProcessedDate', latestReceipt.date);
                    
                    progressCallback(`Successfully fetched ${uniqueNewReceipts.length} new receipts and updated local storage!`, allReceipts.length);
                    return allReceipts;
                } else {
                    progressCallback("No new receipts found. Using existing data.", localReceipts.length);
                    return localReceipts;
                }
            }
            
            // If no local data or first time, fetch everything
            progressCallback("No local data found, fetching all receipts...", 0);
            const allReceipts = await this.fetchAllReceipts(progressCallback);
            
            // Store metadata after first fetch
            if (allReceipts.length > 0) {
                const latestReceipt = allReceipts.reduce((latest, current) => 
                    new Date(current.date) > new Date(latest.date) ? current : latest
                );
                await this.storeMetadata('lastProcessedReceiptId', latestReceipt.$id);
                await this.storeMetadata('lastProcessedDate', latestReceipt.date);
            }
            
            return allReceipts;
            
        } catch (error) {
            console.error("Error in incremental fetch:", error);
            // Fallback to full fetch
            progressCallback("Incremental fetch failed, falling back to full fetch...", 0);
            return await this.fetchAllReceipts(progressCallback);
        }
    }

    // Fetch receipts after a specific date
    async fetchReceiptsAfterDate(date, progressCallback) {
        try {
            let allNewReceipts = [];
            let offset = 0;
            const limit = 100;
            let totalFetched = 0;
            
            // Add a small buffer to the date to avoid missing receipts due to timezone issues
            const adjustedDate = new Date(date);
            adjustedDate.setSeconds(adjustedDate.getSeconds() - 1);
            
            while (true) {
                try {
                    const response = await customerDatabases.listDocuments(
                        this.databaseId,
                        this.collectionId,
                        [
                            Appwrite.Query.greaterThan("date", adjustedDate.toISOString()),
                            Appwrite.Query.orderAsc("date"),
                            Appwrite.Query.limit(limit),
                            Appwrite.Query.offset(offset)
                        ]
                    );
                    
                    if (response.documents.length === 0) break;
                    
                    // Filter out receipts that might have the exact same date as our last processed date
                    const filteredReceipts = response.documents.filter(receipt => {
                        const receiptDate = new Date(receipt.date);
                        const lastDate = new Date(date);
                        return receiptDate > lastDate;
                    });
                    
                    allNewReceipts = allNewReceipts.concat(filteredReceipts);
                    totalFetched += filteredReceipts.length;
                    
                    progressCallback(`Fetched ${totalFetched} new receipts...`, totalFetched);
                    
                    if (response.documents.length < limit) break;
                    
                    offset += limit;
                    await new Promise(resolve => setTimeout(resolve, 100));
                    
                } catch (error) {
                    if (error.code === 429 || error.message.includes('rate limit')) {
                        progressCallback(`Rate limited, waiting 2 seconds... (${totalFetched} receipts fetched)`, totalFetched);
                        await new Promise(resolve => setTimeout(resolve, 2000));
                        continue;
                    } else {
                        throw error;
                    }
                }
            }
            
            return allNewReceipts;
            
        } catch (error) {
            console.error("Error fetching receipts after date:", error);
            throw error;
        }
    }

    // Fetch all receipts with pagination and rate limiting handling
    async fetchAllReceipts(progressCallback) {
        try {
            let allReceipts = [];
            let offset = 0;
            const limit = 100; // Fetch in batches of 100
            let totalFetched = 0;
            
            progressCallback("Starting to fetch all receipts...", 0);
            
            while (true) {
                try {
                    const response = await customerDatabases.listDocuments(
                        this.databaseId,
                        this.collectionId,
                        [
                            Appwrite.Query.orderAsc("date"),
                            Appwrite.Query.limit(limit),
                            Appwrite.Query.offset(offset)
                        ]
                    );
                    
                    allReceipts = allReceipts.concat(response.documents);
                    totalFetched += response.documents.length;
                    
                    // Update progress
                    progressCallback(`Fetched ${totalFetched} receipts...`, totalFetched);
                    
                    // If we got less than the limit, we've reached the end
                    if (response.documents.length < limit) {
                        break;
                    }
                    
                    offset += limit;
                    
                    // Add small delay to avoid rate limiting
                    await new Promise(resolve => setTimeout(resolve, 100));
                    
                } catch (error) {
                    if (error.code === 429 || error.message.includes('rate limit')) {
                        // Rate limited - wait and retry
                        progressCallback(`Rate limited, waiting 2 seconds... (${totalFetched} receipts fetched)`, totalFetched);
                        await new Promise(resolve => setTimeout(resolve, 2000));
                        continue;
                    } else {
                        throw error;
                    }
                }
            }
            
            // Store locally in IndexedDB
            this.localReceipts = allReceipts;
            await this.storeReceiptsInIndexedDB(allReceipts);
            
            // Update metadata with latest receipt info
            if (allReceipts.length > 0) {
                const latestReceipt = allReceipts[allReceipts.length - 1];
                await this.storeMetadata('lastProcessedReceiptId', latestReceipt.$id);
                await this.storeMetadata('lastProcessedDate', latestReceipt.date);
            }
            
            progressCallback(`Successfully fetched and stored ${allReceipts.length} receipts locally!`, allReceipts.length);
            return allReceipts;
            
        } catch (error) {
            console.error("Error fetching receipts:", error);
            throw error;
        }
    }

    // Process receipts to create customer groups
    async processReceiptsToCustomers(receipts) {
        const customerMap = new Map();
        
        receipts.forEach(receipt => {
            const customerName = receipt.customerName || 'Unknown Customer';
            const storeName = receipt.storeName || 'No Store Name';
            
            // Create unique key for customer + store combination
            const customerKey = `${customerName}|${storeName}`;
            
            if (!customerMap.has(customerKey)) {
                customerMap.set(customerKey, {
                    customerName,
                    storeName,
                    receipts: [],
                    totalSpent: 0,
                    receiptCount: 0
                });
            }
            
            const customer = customerMap.get(customerKey);
            customer.receipts.push(receipt);
            customer.totalSpent += parseFloat(receipt.total || receipt.amountPaid || 0);
            customer.receiptCount++;
        });
        
        // Convert to array and sort alphabetically by store name
        const customers = Array.from(customerMap.values()).sort((a, b) => {
            return a.storeName.localeCompare(b.storeName);
        });
        
        // Store locally in IndexedDB
        this.localCustomers = customers;
        await this.storeCustomersInIndexedDB(customers);
        
        return customers;
    }

    // Get customers from local storage or fetch if needed
    async getCustomers(progressCallback) {
        // Try to get from IndexedDB first
        try {
            const storedReceipts = await this.getReceiptsFromIndexedDB();
            const storedCustomers = await this.getCustomersFromIndexedDB();
            
            if (storedReceipts.length > 0 && storedCustomers.length > 0) {
                this.localReceipts = storedReceipts;
                this.localCustomers = storedCustomers;
                progressCallback(`Loaded ${this.localCustomers.length} customers from local storage`, this.localCustomers.length);
                
                // Check if we need to refresh data (only if it's been more than 1 hour)
                const lastRefreshTime = await this.getMetadata('lastRefreshTime');
                const now = Date.now();
                const oneHour = 60 * 60 * 1000; // 1 hour in milliseconds
                
                if (!lastRefreshTime || (now - lastRefreshTime) > oneHour) {
                    progressCallback("Checking for new receipts...", 0);
                    const newReceipts = await this.fetchNewReceiptsOnly(progressCallback);
                    
                    if (newReceipts.length !== storedReceipts.length) {
                        // We have new receipts, reprocess customers
                        this.localReceipts = newReceipts;
                        await this.storeMetadata('lastRefreshTime', now);
                        return await this.processReceiptsToCustomers(newReceipts);
                    } else {
                        // No new receipts, update refresh time to prevent unnecessary checks
                        await this.storeMetadata('lastRefreshTime', now);
                    }
                } else {
                    progressCallback(`Using cached data (last refreshed ${Math.round((now - lastRefreshTime) / 60000)} minutes ago)`, this.localCustomers.length);
                }
                
                return this.localCustomers;
            }
        } catch (error) {
            console.error("Error reading from IndexedDB:", error);
            // Fall through to fetch from server
        }
        
        // Fetch from server if not in local storage
        progressCallback("No local data found, fetching from server...", 0);
        const receipts = await this.fetchNewReceiptsOnly(progressCallback);
        
        // Store refresh time after first fetch
        await this.storeMetadata('lastRefreshTime', Date.now());
        
        return await this.processReceiptsToCustomers(receipts);
    }

    // Get receipt history for a specific customer
    getCustomerReceiptHistory(customerKey) {
        if (!this.localCustomers) return [];
        
        const customer = this.localCustomers.find(c => 
            `${c.customerName}|${c.storeName}` === customerKey
        );
        
        return customer ? customer.receipts : [];
    }

    // Force refresh all data (useful for manual refresh)
    async forceRefresh(progressCallback) {
        progressCallback("Force refreshing all data...", 0);
        
        // Clear metadata to force full refresh
        await this.storeMetadata('lastProcessedReceiptId', null);
        await this.storeMetadata('lastProcessedDate', null);
        await this.storeMetadata('lastRefreshTime', null);
        
        // Fetch everything fresh
        const receipts = await this.fetchAllReceipts(progressCallback);
        return await this.processReceiptsToCustomers(receipts);
    }
    
    // Check if data refresh is needed
    async isRefreshNeeded() {
        try {
            const lastRefreshTime = await this.getMetadata('lastRefreshTime');
            if (!lastRefreshTime) return true;
            
            const now = Date.now();
            const oneHour = 60 * 60 * 1000; // 1 hour in milliseconds
            return (now - lastRefreshTime) > oneHour;
        } catch (error) {
            console.error("Error checking refresh status:", error);
            return true; // Default to refresh if we can't check
        }
    }
}
