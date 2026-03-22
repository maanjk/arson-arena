// Firebase Cloud Messaging Service Worker
// Handles background notifications and message processing

// Import Firebase scripts for service worker
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

// Firebase configuration (same as main app)
const firebaseConfig = {
  apiKey: "your-api-key-here",
  authDomain: "your-project-id.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project-id.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef123456",
  measurementId: "G-XXXXXXXXXX"
};

// Initialize Firebase in service worker
firebase.initializeApp(firebaseConfig);

// Initialize Firebase Cloud Messaging
const messaging = firebase.messaging();

// Handle background messages
messaging.onBackgroundMessage((payload) => {
  console.log('📱 Background message received:', payload);

  const notificationTitle = payload.notification?.title || 'ARSON Arena';
  const notificationOptions = {
    body: payload.notification?.body || 'New notification',
    icon: '/icon-192x192.png',
    badge: '/badge-72x72.png',
    tag: payload.data?.type || 'general',
    data: payload.data || {},
    actions: getNotificationActions(payload.data?.type),
    requireInteraction: payload.data?.priority === 'high',
    silent: false,
    vibrate: [200, 100, 200]
  };

  // Show notification
  return self.registration.showNotification(notificationTitle, notificationOptions);
});

// Define notification actions based on type
function getNotificationActions(type) {
  switch (type) {
    case 'tournament_update':
      return [
        { action: 'view', title: 'View Tournament', icon: '/icon-view.png' },
        { action: 'dismiss', title: 'Dismiss', icon: '/icon-dismiss.png' }
      ];
    case 'transaction_update':
      return [
        { action: 'view_wallet', title: 'View Wallet', icon: '/icon-wallet.png' },
        { action: 'dismiss', title: 'Dismiss', icon: '/icon-dismiss.png' }
      ];
    case 'match_ready':
      return [
        { action: 'join_match', title: 'Join Match', icon: '/icon-play.png' },
        { action: 'view_details', title: 'View Details', icon: '/icon-view.png' }
      ];
    default:
      return [
        { action: 'open_app', title: 'Open App', icon: '/icon-open.png' },
        { action: 'dismiss', title: 'Dismiss', icon: '/icon-dismiss.png' }
      ];
  }
}

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  console.log('🔔 Notification clicked:', event);

  const notification = event.notification;
  const action = event.action;
  const data = notification.data || {};

  notification.close();

  // Handle different actions
  switch (action) {
    case 'view':
    case 'view_tournament':
      event.waitUntil(
        clients.openWindow(`/?view=tournament&id=${data.tournamentId || ''}`)
      );
      break;
    
    case 'view_wallet':
      event.waitUntil(
        clients.openWindow('/?view=wallet')
      );
      break;
    
    case 'join_match':
      event.waitUntil(
        clients.openWindow(`/?action=join&tournament=${data.tournamentId || ''}`)
      );
      break;
    
    case 'view_details':
      event.waitUntil(
        clients.openWindow(`/?view=tournament&id=${data.tournamentId || ''}`)
      );
      break;
    
    case 'open_app':
    default:
      event.waitUntil(
        clients.openWindow('/')
      );
      break;
    
    case 'dismiss':
      // Just close the notification (already done above)
      break;
  }

  // Track notification interaction
  if (data.trackingId) {
    fetch('/api/track-notification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        trackingId: data.trackingId,
        action: action || 'click',
        timestamp: Date.now()
      })
    }).catch(err => console.warn('Failed to track notification:', err));
  }
});

// Handle notification close events
self.addEventListener('notificationclose', (event) => {
  console.log('🔕 Notification closed:', event);
  
  const data = event.notification.data || {};
  
  // Track notification dismissal
  if (data.trackingId) {
    fetch('/api/track-notification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        trackingId: data.trackingId,
        action: 'close',
        timestamp: Date.now()
      })
    }).catch(err => console.warn('Failed to track notification close:', err));
  }
});

// Cache management for offline functionality
const CACHE_NAME = 'arson-arena-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/admin.html',
  '/firebase-config.js',
  '/manifest.json',
  '/icon-192x192.png',
  '/icon-512x512.png'
];

// Install service worker and cache resources
self.addEventListener('install', (event) => {
  console.log('🔧 Service Worker installing...');
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('📦 Caching app resources');
        return cache.addAll(urlsToCache);
      })
      .then(() => {
        console.log('✅ Service Worker installed successfully');
        return self.skipWaiting();
      })
      .catch((error) => {
        console.error('❌ Service Worker installation failed:', error);
      })
  );
});

// Activate service worker and clean up old caches
self.addEventListener('activate', (event) => {
  console.log('🚀 Service Worker activating...');
  
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('🗑️ Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      console.log('✅ Service Worker activated');
      return self.clients.claim();
    })
  );
});

// Fetch event handler for offline functionality
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests and Firebase URLs
  if (event.request.method !== 'GET' || 
      event.request.url.includes('firebaseapp.com') ||
      event.request.url.includes('googleapis.com')) {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // Return cached version if available
        if (response) {
          return response;
        }

        // Fetch from network
        return fetch(event.request).then((response) => {
          // Don't cache if not a valid response
          if (!response || response.status !== 200 || response.type !== 'basic') {
            return response;
          }

          // Clone the response
          const responseToCache = response.clone();

          // Cache the response
          caches.open(CACHE_NAME)
            .then((cache) => {
              cache.put(event.request, responseToCache);
            });

          return response;
        });
      })
      .catch(() => {
        // Return offline page for navigation requests
        if (event.request.destination === 'document') {
          return caches.match('/index.html');
        }
      })
  );
});

// Background sync for offline operations
self.addEventListener('sync', (event) => {
  console.log('🔄 Background sync triggered:', event.tag);
  
  switch (event.tag) {
    case 'sync-transactions':
      event.waitUntil(syncPendingTransactions());
      break;
    case 'sync-tournament-data':
      event.waitUntil(syncTournamentData());
      break;
    case 'sync-user-profile':
      event.waitUntil(syncUserProfile());
      break;
  }
});

// Sync functions for offline operations
async function syncPendingTransactions() {
  try {
    // Get pending transactions from IndexedDB
    const pendingTransactions = await getPendingTransactions();
    
    for (const transaction of pendingTransactions) {
      try {
        // Attempt to sync with Firebase
        await syncTransactionToFirebase(transaction);
        await removePendingTransaction(transaction.id);
        console.log('✅ Synced transaction:', transaction.id);
      } catch (error) {
        console.warn('⚠️ Failed to sync transaction:', transaction.id, error);
      }
    }
  } catch (error) {
    console.error('❌ Background sync failed:', error);
  }
}

async function syncTournamentData() {
  // Implementation for syncing tournament data
  console.log('🏆 Syncing tournament data...');
}

async function syncUserProfile() {
  // Implementation for syncing user profile changes
  console.log('👤 Syncing user profile...');
}

// Helper functions for IndexedDB operations
async function getPendingTransactions() {
  // Implementation to get pending transactions from IndexedDB
  return [];
}

async function syncTransactionToFirebase(transaction) {
  // Implementation to sync transaction to Firebase
}

async function removePendingTransaction(transactionId) {
  // Implementation to remove synced transaction from IndexedDB
}

// Error handling
self.addEventListener('error', (event) => {
  console.error('🚨 Service Worker error:', event.error);
});

self.addEventListener('unhandledrejection', (event) => {
  console.error('🚨 Service Worker unhandled rejection:', event.reason);
});

console.log('🔥 Firebase Messaging Service Worker loaded');