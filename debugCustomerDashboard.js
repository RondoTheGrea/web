// Debug test for customer dashboard
console.log('=== Customer Dashboard Debug Test ===');

// Test 1: Check if required global variables are available
console.log('1. Global Variables Check:');
console.log('  - databases:', typeof databases);
console.log('  - databaseId:', typeof databaseId);
console.log('  - Appwrite:', typeof Appwrite);
console.log('  - OptimizedBatchProcessor:', typeof OptimizedBatchProcessor);
console.log('  - CustomerResolutionService:', typeof CustomerResolutionService);

// Test 2: Check if DOM elements exist
console.log('2. DOM Elements Check:');
console.log('  - processCustomersBtn:', !!document.getElementById('processCustomersBtn'));
console.log('  - viewCustomersBtn:', !!document.getElementById('viewCustomersBtn'));
console.log('  - clearCustomersBtn:', !!document.getElementById('clearCustomersBtn'));
console.log('  - statusMessages:', !!document.getElementById('statusMessages'));
console.log('  - customerProcessingStatus:', !!document.getElementById('customerProcessingStatus'));
console.log('  - customersList:', !!document.getElementById('customersList'));
console.log('  - customers tab:', !!document.querySelector('[data-tab="customers"]'));

// Test 3: Check if functions are defined
console.log('3. Function Definitions Check:');
console.log('  - initCustomerDashboard:', typeof initCustomerDashboard);
console.log('  - processAllReceipts:', typeof processAllReceipts);
console.log('  - showProcessingStatus:', typeof showProcessingStatus);
console.log('  - checkCustomerStatus:', typeof checkCustomerStatus);

// Test 4: Try to initialize customer dashboard
console.log('4. Testing Customer Dashboard Initialization:');
try {
  if (typeof initCustomerDashboard === 'function') {
    console.log('  - Calling initCustomerDashboard...');
    initCustomerDashboard();
    console.log('  - ✅ Customer dashboard initialized successfully');
  } else {
    console.log('  - ❌ initCustomerDashboard function not found');
  }
} catch (error) {
  console.log('  - ❌ Error initializing customer dashboard:', error);
}

// Test 5: Check if optimizedProcessor was created
setTimeout(() => {
  console.log('5. Post-Initialization Check:');
  console.log('  - optimizedProcessor:', typeof optimizedProcessor);
  console.log('  - customerResolutionService:', typeof customerResolutionService);
  
  if (optimizedProcessor) {
    console.log('  - ✅ Optimized processor is available');
  } else {
    console.log('  - ❌ Optimized processor is not available');
  }
}, 1000);

console.log('=== Debug Test Complete ===');
