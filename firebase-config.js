// Firebase Configuration and Initialization
// Optimized for Firebase Free Tier with quota monitoring

// Firebase SDK imports (tree-shaking enabled)
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, enableNetwork, disableNetwork } from 'firebase/firestore';
import { getMessaging, getToken, onMessage } from 'firebase/messaging';
import { getAnalytics } from 'firebase/analytics';

// Firebase configuration object
// Replace with your actual Firebase project configuration
const firebaseConfig = {
  apiKey: "demo-key",
  authDomain: "arson-arena-firebase.firebaseapp.com",
  projectId: "arson-arena-firebase",
  storageBucket: "arson-arena-firebase.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef123456",
  measurementId: "G-XXXXXXXXXX"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase services
const auth = getAuth(app);
const db = getFirestore(app);

// Development environment detection
const isDevelopment = window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1' ||
  window.location.hostname.includes('localhost');

// Services that may not be supported in all environments (e.g., node, some browsers)
let messaging = null;
let analytics = null;

// Only initialize messaging/analytics outside of development to avoid API key errors
if (!isDevelopment) {
  try {
    messaging = getMessaging(app);
  } catch (error) {
    console.warn('⚠️ Firebase Cloud Messaging is not supported in this environment');
  }

  try {
    analytics = getAnalytics(app);
  } catch (error) {
    console.warn('⚠️ Firebase Analytics is not supported in this environment');
  }
}

// Connect to Firebase emulators in development
if (isDevelopment) {
  try {
    // Connect to Auth emulator
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });

    // Connect to Firestore emulator
    connectFirestoreEmulator(db, '127.0.0.1', 8080);

    console.log('🔧 Connected to Firebase emulators (127.0.0.1)');
  } catch (error) {
    console.warn('⚠️ Firebase emulators not available:', error.message);
  }
}

// Quota monitoring and usage tracking
class FirebaseQuotaManager {
  constructor() {
    this.quotas = {
      firestoreReads: { daily: 50000, used: 0, resetTime: this.getNextMidnight() },
      firestoreWrites: { daily: 20000, used: 0, resetTime: this.getNextMidnight() },
      firestoreDeletes: { daily: 20000, used: 0, resetTime: this.getNextMidnight() }
    };

    this.loadQuotaData();
    this.setupQuotaReset();
  }

  getNextMidnight() {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    return tomorrow.getTime();
  }

  loadQuotaData() {
    const saved = localStorage.getItem('firebase_quota_usage');
    if (saved) {
      const data = JSON.parse(saved);
      // Reset if it's a new day
      if (Date.now() > data.firestoreReads.resetTime) {
        this.resetDailyQuotas();
      } else {
        this.quotas = data;
      }
    }
  }

  saveQuotaData() {
    localStorage.setItem('firebase_quota_usage', JSON.stringify(this.quotas));
  }

  resetDailyQuotas() {
    const nextMidnight = this.getNextMidnight();
    this.quotas.firestoreReads.used = 0;
    this.quotas.firestoreReads.resetTime = nextMidnight;
    this.quotas.firestoreWrites.used = 0;
    this.quotas.firestoreWrites.resetTime = nextMidnight;
    this.quotas.firestoreDeletes.used = 0;
    this.quotas.firestoreDeletes.resetTime = nextMidnight;
    this.saveQuotaData();
  }

  setupQuotaReset() {
    // Check for quota reset every hour
    setInterval(() => {
      if (Date.now() > this.quotas.firestoreReads.resetTime) {
        this.resetDailyQuotas();
        console.log('📊 Daily Firebase quotas reset');
      }
    }, 3600000); // 1 hour
  }

  trackRead(count = 1) {
    this.quotas.firestoreReads.used += count;
    this.saveQuotaData();
    this.checkQuotaWarnings('reads');
  }

  trackWrite(count = 1) {
    this.quotas.firestoreWrites.used += count;
    this.saveQuotaData();
    this.checkQuotaWarnings('writes');
  }

  trackDelete(count = 1) {
    this.quotas.firestoreDeletes.used += count;
    this.saveQuotaData();
    this.checkQuotaWarnings('deletes');
  }

  checkQuotaWarnings(type) {
    const quota = this.quotas[`firestore${type.charAt(0).toUpperCase() + type.slice(1)}`];
    const percentage = (quota.used / quota.daily) * 100;

    if (percentage >= 90) {
      console.warn(`🚨 Firebase ${type} quota at ${percentage.toFixed(1)}% (${quota.used}/${quota.daily})`);
      this.showQuotaWarning(type, percentage);
    } else if (percentage >= 80) {
      console.warn(`⚠️ Firebase ${type} quota at ${percentage.toFixed(1)}% (${quota.used}/${quota.daily})`);
    }
  }

  showQuotaWarning(type, percentage) {
    // Show user-friendly warning
    if (window.showToast) {
      window.showToast(`Firebase ${type} quota at ${percentage.toFixed(0)}%`, 'warning');
    }
  }

  canPerformOperation(type, count = 1) {
    const quota = this.quotas[`firestore${type.charAt(0).toUpperCase() + type.slice(1)}`];
    return (quota.used + count) <= quota.daily;
  }

  getQuotaStatus() {
    return {
      reads: {
        used: this.quotas.firestoreReads.used,
        limit: this.quotas.firestoreReads.daily,
        percentage: (this.quotas.firestoreReads.used / this.quotas.firestoreReads.daily) * 100
      },
      writes: {
        used: this.quotas.firestoreWrites.used,
        limit: this.quotas.firestoreWrites.daily,
        percentage: (this.quotas.firestoreWrites.used / this.quotas.firestoreWrites.daily) * 100
      },
      deletes: {
        used: this.quotas.firestoreDeletes.used,
        limit: this.quotas.firestoreDeletes.daily,
        percentage: (this.quotas.firestoreDeletes.used / this.quotas.firestoreDeletes.daily) * 100
      }
    };
  }
}

// Initialize quota manager
const quotaManager = new FirebaseQuotaManager();

// Network status monitoring
let isOnline = navigator.onLine;
let networkRetryCount = 0;
const maxRetries = 3;

window.addEventListener('online', () => {
  isOnline = true;
  networkRetryCount = 0;
  enableNetwork(db).then(() => {
    console.log('🌐 Firestore back online');
    if (window.showToast) {
      window.showToast('Connection restored', 'success');
    }
  });
});

window.addEventListener('offline', () => {
  isOnline = false;
  console.log('📴 Device offline - using cached data');
  if (window.showToast) {
    window.showToast('Working offline', 'info');
  }
});

// Error handling with retry logic
async function withRetry(operation, context = 'Firebase operation') {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (error) {
      console.warn(`⚠️ ${context} failed (attempt ${i + 1}/${maxRetries}):`, error.message);

      if (i === maxRetries - 1) {
        console.error(`❌ ${context} failed after ${maxRetries} attempts:`, error);
        throw error;
      }

      // Exponential backoff
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
    }
  }
}

// Firebase service initialization with error handling
async function initializeFirebaseServices() {
  try {
    // Test Firestore connection
    await withRetry(async () => {
      const { doc, getDoc } = await import('firebase/firestore');
      await getDoc(doc(db, '_test', 'connection'));
      console.log('✅ Firestore connection verified');
    }, 'Firestore connection test');

    // Initialize FCM if supported
    if ('serviceWorker' in navigator && 'Notification' in window) {
      try {
        const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
        console.log('✅ Service Worker registered for FCM');
      } catch (error) {
        console.warn('⚠️ Service Worker registration failed:', error.message);
      }
    }

    console.log('🚀 Firebase services initialized successfully');
    return true;
  } catch (error) {
    console.error('❌ Firebase initialization failed:', error);
    return false;
  }
}

// Export Firebase instances and utilities
export {
  app,
  auth,
  db,
  messaging,
  analytics,
  quotaManager,
  withRetry,
  initializeFirebaseServices,
  isDevelopment
};

// Global error handler for Firebase
window.addEventListener('unhandledrejection', (event) => {
  if (event.reason?.code?.startsWith('firebase/')) {
    console.error('🔥 Firebase error:', event.reason);

    // Handle specific Firebase errors
    switch (event.reason.code) {
      case 'firebase/quota-exceeded':
        if (window.showToast) {
          window.showToast('Daily quota exceeded. Try again tomorrow.', 'error');
        }
        break;
      case 'firebase/network-request-failed':
        if (window.showToast) {
          window.showToast('Network error. Check your connection.', 'error');
        }
        break;
      case 'firebase/permission-denied':
        if (window.showToast) {
          window.showToast('Access denied. Please sign in again.', 'error');
        }
        break;
    }
  }
});

// Initialize services when DOM is ready (except during tests)
if (typeof process === 'undefined' || process.env.NODE_ENV !== 'test') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeFirebaseServices);
  } else {
    initializeFirebaseServices();
  }
}