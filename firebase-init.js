// Firebase Initialization Script
// This script initializes Firebase services and provides utility functions

// Import Firebase configuration
import { 
  app, 
  auth, 
  db, 
  messaging, 
  analytics, 
  quotaManager, 
  withRetry, 
  initializeFirebaseServices,
  isDevelopment 
} from './firebase-config.js';

// Firebase service imports
import { 
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  updateProfile
} from 'firebase/auth';

import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  writeBatch,
  runTransaction,
  enableNetwork,
  disableNetwork,
  connectFirestoreEmulator
} from 'firebase/firestore';

import {
  getToken,
  onMessage
} from 'firebase/messaging';

// Global Firebase utilities
window.Firebase = {
  // Core services
  app,
  auth,
  db,
  messaging,
  analytics,
  
  // Utility functions
  quotaManager,
  withRetry,
  isDevelopment,
  
  // Auth functions
  signIn: signInWithEmailAndPassword,
  signUp: createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  resetPassword: sendPasswordResetEmail,
  updateProfile,
  
  // Firestore functions
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  writeBatch,
  runTransaction,
  enableNetwork,
  disableNetwork,
  
  // Messaging functions
  getToken,
  onMessage,
  
  // Custom utilities
  trackRead: (count = 1) => quotaManager.trackRead(count),
  trackWrite: (count = 1) => quotaManager.trackWrite(count),
  trackDelete: (count = 1) => quotaManager.trackDelete(count),
  getQuotaStatus: () => quotaManager.getQuotaStatus(),
  canPerformOperation: (type, count = 1) => quotaManager.canPerformOperation(type, count)
};

// Authentication state management
let currentUser = null;
let authStateCallbacks = [];

// Listen for auth state changes
onAuthStateChanged(auth, (user) => {
  currentUser = user;
  console.log('🔐 Auth state changed:', user ? `Signed in as ${user.email}` : 'Signed out');
  
  // Call all registered callbacks
  authStateCallbacks.forEach(callback => {
    try {
      callback(user);
    } catch (error) {
      console.error('❌ Auth state callback error:', error);
    }
  });
});

// Register auth state callback
window.Firebase.onAuthStateChange = (callback) => {
  authStateCallbacks.push(callback);
  // Call immediately with current state
  if (currentUser !== null) {
    callback(currentUser);
  }
};

// Get current user
window.Firebase.getCurrentUser = () => currentUser;

// Notification handling
if ('Notification' in window && messaging) {
  // Request notification permission
  window.Firebase.requestNotificationPermission = async () => {
    try {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        console.log('✅ Notification permission granted');
        
        // Get FCM token
        const token = await getToken(messaging, {
          vapidKey: 'your-vapid-key-here' // Replace with your VAPID key
        });
        
        if (token) {
          console.log('📱 FCM token:', token);
          return token;
        }
      } else {
        console.warn('⚠️ Notification permission denied');
      }
    } catch (error) {
      console.error('❌ Error getting notification permission:', error);
    }
    return null;
  };

  // Handle foreground messages
  onMessage(messaging, (payload) => {
    console.log('📨 Foreground message received:', payload);
    
    // Show custom notification
    if (window.showToast) {
      window.showToast(
        payload.notification?.body || 'New notification',
        'info',
        payload.notification?.title || 'ARSON Arena'
      );
    }
    
    // Handle different message types
    if (payload.data?.type) {
      handleNotificationAction(payload.data);
    }
  });
}

// Handle notification actions
function handleNotificationAction(data) {
  switch (data.type) {
    case 'tournament_update':
      if (window.switchView && data.tournamentId) {
        window.switchView('dashboard');
        // Optionally open tournament modal
        if (window.openTournamentModal) {
          setTimeout(() => window.openTournamentModal(data.tournamentId), 500);
        }
      }
      break;
      
    case 'transaction_update':
      if (window.switchView) {
        window.switchView('wallet');
      }
      break;
      
    case 'match_ready':
      if (window.switchView && data.tournamentId) {
        window.switchView('dashboard');
        if (window.showToast) {
          window.showToast('Match is ready! Join now.', 'success');
        }
      }
      break;
      
    default:
      console.log('📱 Unhandled notification type:', data.type);
  }
}

// Error handling utilities
window.Firebase.handleError = (error, context = 'Firebase operation') => {
  console.error(`❌ ${context} failed:`, error);
  
  let userMessage = 'An unexpected error occurred';
  
  // Handle specific Firebase errors
  switch (error.code) {
    case 'auth/user-not-found':
      userMessage = 'User account not found';
      break;
    case 'auth/wrong-password':
      userMessage = 'Invalid password';
      break;
    case 'auth/email-already-in-use':
      userMessage = 'Email already registered';
      break;
    case 'auth/weak-password':
      userMessage = 'Password is too weak';
      break;
    case 'auth/invalid-email':
      userMessage = 'Invalid email address';
      break;
    case 'permission-denied':
      userMessage = 'Access denied';
      break;
    case 'unavailable':
      userMessage = 'Service temporarily unavailable';
      break;
    case 'quota-exceeded':
      userMessage = 'Daily quota exceeded. Try again tomorrow.';
      break;
    case 'network-request-failed':
      userMessage = 'Network error. Check your connection.';
      break;
  }
  
  if (window.showToast) {
    window.showToast(userMessage, 'error');
  }
  
  return userMessage;
};

// Offline/online status handling
let isOnline = navigator.onLine;

window.addEventListener('online', () => {
  if (!isOnline) {
    isOnline = true;
    console.log('🌐 Back online');
    if (window.showToast) {
      window.showToast('Connection restored', 'success');
    }
  }
});

window.addEventListener('offline', () => {
  if (isOnline) {
    isOnline = false;
    console.log('📴 Gone offline');
    if (window.showToast) {
      window.showToast('Working offline', 'info');
    }
  }
});

// Utility to check if online
window.Firebase.isOnline = () => isOnline;

// Development utilities
if (isDevelopment) {
  // Add Firebase to global scope for debugging
  window.FirebaseDebug = {
    auth,
    db,
    messaging,
    quotaManager,
    currentUser: () => currentUser,
    quotaStatus: () => quotaManager.getQuotaStatus()
  };
  
  console.log('🔧 Firebase debug utilities available at window.FirebaseDebug');
}

// Initialize Firebase services
initializeFirebaseServices().then((success) => {
  if (success) {
    console.log('🚀 Firebase initialization complete');
    
    // Dispatch custom event for app to know Firebase is ready
    window.dispatchEvent(new CustomEvent('firebase-ready', {
      detail: { success: true }
    }));
  } else {
    console.error('❌ Firebase initialization failed');
    
    window.dispatchEvent(new CustomEvent('firebase-ready', {
      detail: { success: false }
    }));
  }
});

// Export for module usage
export default window.Firebase;