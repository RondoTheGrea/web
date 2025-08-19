// Test the date-based processing system
(async function testDateBasedProcessing() {
    console.log('🔍 Testing Date-Based Processing System');
    console.log('=====================================');
    
    try {
        // Clear existing data to start fresh
        console.log('1. Clearing existing customer data...');
        if (window.customerResolutionService) {
            window.customerResolutionService.clearMemory();
        }
        
        // Clear localStorage date tracking
        localStorage.removeItem('lastCustomersTabVisit');
        localStorage.removeItem('lastFullProcess');
        
        console.log('2. Testing first-time tab visit...');
        // Simulate first customers tab click
        if (window.handleCustomersTabClick) {
            await window.handleCustomersTabClick();
        } else {
            console.log('   ❌ handleCustomersTabClick function not found');
        }
        
        // Check if date was stored
        const firstVisit = localStorage.getItem('lastCustomersTabVisit');
        console.log(`   📅 First visit date stored: ${firstVisit}`);
        
        // Wait a moment
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        console.log('3. Testing subsequent tab visit...');
        // Simulate another tab click
        if (window.handleCustomersTabClick) {
            await window.handleCustomersTabClick();
        }
        
        const secondVisit = localStorage.getItem('lastCustomersTabVisit');
        console.log(`   📅 Second visit date stored: ${secondVisit}`);
        
        // Check memory stats
        if (window.customerResolutionService) {
            const stats = window.customerResolutionService.getStats();
            console.log('4. Memory Stats:');
            console.log(`   📊 Total customers: ${stats.totalCustomers}`);
            console.log(`   📊 Unique customers: ${stats.uniqueCustomers}`);
            console.log(`   📊 Resolved customers: ${stats.resolvedCustomers}`);
        }
        
        // Test rolling logs
        console.log('5. Testing rolling log system...');
        const logContainer = document.getElementById('statusMessages');
        if (logContainer) {
            const messages = logContainer.children;
            console.log(`   📝 Current log messages: ${messages.length}`);
            console.log('   📝 First message:', messages[0]?.textContent?.slice(0, 50) + '...');
            console.log('   📝 Last message:', messages[messages.length-1]?.textContent?.slice(0, 50) + '...');
        }
        
        console.log('✅ Date-based processing test completed!');
        
    } catch (error) {
        console.error('❌ Test failed:', error);
    }
})();
