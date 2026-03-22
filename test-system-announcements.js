// Test System Announcements Functionality
// This file tests the system announcement broadcasting and in-app notification display

console.log('🧪 Testing System Announcements...');

// Test function to verify announcement system
async function testSystemAnnouncements() {
    try {
        console.log('📢 Starting system announcement tests...');
        
        // Check if NotificationManager is available
        if (!window.notificationManager) {
            console.error('❌ NotificationManager not available');
            return false;
        }
        
        console.log('✅ NotificationManager found');
        
        // Test 1: Send a basic system announcement
        console.log('🧪 Test 1: Basic system announcement');
        const basicAnnouncement = {
            title: '🧪 Test System Announcement',
            message: 'This is a test announcement to verify the system is working correctly.',
            type: 'info',
            priority: 'normal',
            persistent: false,
            expiresIn: 1 // 1 hour
        };
        
        const result1 = await window.notificationManager.sendSystemAnnouncement(basicAnnouncement);
        console.log(result1 ? '✅ Basic announcement sent' : '❌ Basic announcement failed');
        
        // Test 2: Send a high priority announcement
        console.log('🧪 Test 2: High priority announcement');
        const highPriorityAnnouncement = {
            title: '🚨 High Priority Test',
            message: 'This is a high priority announcement that should show a modal.',
            type: 'warning',
            priority: 'high',
            persistent: false,
            expiresIn: 2
        };
        
        const result2 = await window.notificationManager.sendSystemAnnouncement(highPriorityAnnouncement);
        console.log(result2 ? '✅ High priority announcement sent' : '❌ High priority announcement failed');
        
        // Test 3: Send a persistent announcement
        console.log('🧪 Test 3: Persistent announcement');
        const persistentAnnouncement = {
            title: '📌 Persistent Test',
            message: 'This announcement should stay visible until dismissed.',
            type: 'success',
            priority: 'normal',
            persistent: true,
            expiresIn: 24
        };
        
        const result3 = await window.notificationManager.sendSystemAnnouncement(persistentAnnouncement);
        console.log(result3 ? '✅ Persistent announcement sent' : '❌ Persistent announcement failed');
        
        // Test 4: Send announcement with action button
        console.log('🧪 Test 4: Announcement with action');
        const actionAnnouncement = {
            title: '🔗 Action Test',
            message: 'This announcement has an action button.',
            type: 'info',
            priority: 'normal',
            persistent: false,
            actionText: 'Visit Site',
            actionUrl: 'https://example.com',
            expiresIn: 1
        };
        
        const result4 = await window.notificationManager.sendSystemAnnouncement(actionAnnouncement);
        console.log(result4 ? '✅ Action announcement sent' : '❌ Action announcement failed');
        
        // Test 5: Test predefined announcement types
        console.log('🧪 Test 5: Predefined announcement types');
        
        // Maintenance notice
        const maintenanceResult = await window.notificationManager.sendMaintenanceNotice({
            title: '🔧 Test Maintenance',
            message: 'Testing maintenance notice functionality.',
            duration: 1
        });
        console.log(maintenanceResult ? '✅ Maintenance notice sent' : '❌ Maintenance notice failed');
        
        // Emergency alert
        const emergencyResult = await window.notificationManager.sendEmergencyAlert({
            title: '🚨 Test Emergency',
            message: 'Testing emergency alert functionality.'
        });
        console.log(emergencyResult ? '✅ Emergency alert sent' : '❌ Emergency alert failed');
        
        // Promotional announcement
        const promoResult = await window.notificationManager.sendPromotionalAnnouncement({
            title: '🎉 Test Promotion',
            message: 'Testing promotional announcement functionality.',
            actionText: 'Learn More',
            actionUrl: 'https://example.com'
        });
        console.log(promoResult ? '✅ Promotional announcement sent' : '❌ Promotional announcement failed');
        
        // Test 6: Check stored announcements
        console.log('🧪 Test 6: Stored announcements');
        const storedAnnouncements = window.notificationManager.getStoredAnnouncements();
        console.log(`✅ Found ${storedAnnouncements.length} stored announcements`);
        
        // Test 7: Check notification history
        console.log('🧪 Test 7: Notification history');
        const notificationHistory = window.notificationManager.getNotificationHistory();
        console.log(`✅ Found ${notificationHistory.length} notifications in history`);
        
        // Test 8: Check unread count
        console.log('🧪 Test 8: Unread count');
        const unreadCount = window.notificationManager.getUnreadCount();
        console.log(`✅ Unread notifications: ${unreadCount}`);
        
        console.log('🎉 All system announcement tests completed!');
        
        // Show summary toast
        if (window.showToast) {
            window.showToast('🧪 System announcement tests completed!', 'success');
        }
        
        return true;
        
    } catch (error) {
        console.error('❌ System announcement test failed:', error);
        
        if (window.showToast) {
            window.showToast('❌ System announcement test failed', 'error');
        }
        
        return false;
    }
}

// Test admin panel functions
function testAdminPanelFunctions() {
    console.log('🧪 Testing admin panel functions...');
    
    // Check if admin functions are available
    const adminFunctions = [
        'handleAnnouncementSubmit',
        'sendTestAnnouncement',
        'sendMaintenanceNotice',
        'sendEmergencyAlert',
        'sendPromotionalAnnouncement'
    ];
    
    adminFunctions.forEach(funcName => {
        if (typeof window[funcName] === 'function') {
            console.log(`✅ ${funcName} function available`);
        } else {
            console.log(`❌ ${funcName} function missing`);
        }
    });
}

// Test UI elements
function testUIElements() {
    console.log('🧪 Testing UI elements...');
    
    const elements = [
        'announcement-overlay',
        'announcement-modal',
        'notification-banner',
        'notification-panel',
        'notification-bell',
        'notification-badge'
    ];
    
    elements.forEach(elementId => {
        const element = document.getElementById(elementId);
        if (element) {
            console.log(`✅ ${elementId} element found`);
        } else {
            console.log(`❌ ${elementId} element missing`);
        }
    });
}

// Run tests when page loads
window.addEventListener('load', function() {
    setTimeout(() => {
        console.log('🚀 Starting system announcement tests...');
        
        // Test UI elements
        testUIElements();
        
        // Test admin panel functions (if available)
        testAdminPanelFunctions();
        
        // Test announcement system
        testSystemAnnouncements();
        
    }, 2000); // Wait 2 seconds for everything to initialize
});

// Make test function available globally
window.testSystemAnnouncements = testSystemAnnouncements;

console.log('✅ System announcement test script loaded');