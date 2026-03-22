// AuthManager - Firebase Authentication Service
// Handles user authentication, profile management, and admin role management

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  sendEmailVerification,
  updateProfile,
  onAuthStateChanged,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider
} from 'firebase/auth';

import {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  serverTimestamp
} from 'firebase/firestore';

import { auth, db, quotaManager, withRetry } from './firebase-config.js';

class AuthManager {
  constructor() {
    this.currentUser = null;
    this.authStateListeners = [];
    this.isInitialized = false;

    // Set up auth state listener
    this.setupAuthStateListener();
  }

  /**
   * Set up authentication state listener
   */
  setupAuthStateListener() {
    onAuthStateChanged(auth, async (user) => {
      this.currentUser = user;

      if (user) {
        // Load user profile data from Firestore
        try {
          const profile = await this.getUserProfile(user.uid);
          if (profile) {
            this.currentUser.profile = profile;
          } else {
            console.log('👤 No profile found for signed-in user, creating default...');
            const defaultProfile = {
              uid: user.uid,
              email: user.email,
              username: user.displayName || user.email.split('@')[0],
              coins: 0,
              xp: 0,
              level: 1,
              gameUids: { pubg: '', freefire: '' },
              joinedTournaments: [],
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp()
            };
            await setDoc(doc(db, 'users', user.uid), defaultProfile);
            this.currentUser.profile = defaultProfile;
            console.log('✅ Default profile created for:', user.email);
          }
        } catch (error) {
          console.warn('Failed to load or create user profile:', error.message);
        }
      }

      // Notify all listeners
      this.authStateListeners.forEach(callback => {
        try {
          callback(user);
        } catch (error) {
          console.error('Auth state listener error:', error);
        }
      });

      this.isInitialized = true;
    });
  }

  /**
   * Register a new user with email and password
   * @param {string} email - User email
   * @param {string} password - User password
   * @param {string} username - Display username
   * @param {string} referralCode - Optional referral code
   * @returns {Promise<Object>} User data
   */
  async signUp(email, password, username, referralCode = null) {
    try {
      // Create Firebase Auth user
      const userCredential = await withRetry(
        () => createUserWithEmailAndPassword(auth, email, password),
        'User registration'
      );

      const user = userCredential.user;

      // Update display name
      await updateProfile(user, { displayName: username });

      // Send email verification
      await sendEmailVerification(user);

      // Create user profile in Firestore
      const userData = {
        uid: user.uid,
        email: email.toLowerCase(),
        username: username,
        avatar: 'default',
        coins: 0,
        xp: 0,
        level: 1,
        gameUids: {
          pubg: '',
          freefire: ''
        },
        referralCode: this.generateReferralCode(username),
        referredBy: referralCode,
        isAdmin: false,
        emailVerified: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        lastActive: serverTimestamp()
      };

      await withRetry(
        () => setDoc(doc(db, 'users', user.uid), userData),
        'User profile creation'
      );

      quotaManager.trackWrite(1);

      // Handle referral bonus if applicable
      if (referralCode) {
        await this.processReferralBonus(referralCode, user.uid);
      }

      console.log('✅ User registered successfully:', username);
      return { user, userData };

    } catch (error) {
      console.error('❌ Registration failed:', error);
      throw this.handleAuthError(error);
    }
  }

  /**
   * Sign in existing user
   * @param {string} email - User email
   * @param {string} password - User password
   * @returns {Promise<Object>} User data
   */
  async signIn(email, password) {
    try {
      const userCredential = await withRetry(
        () => signInWithEmailAndPassword(auth, email.toLowerCase(), password),
        'User sign in'
      );

      const user = userCredential.user;

      // Update last active timestamp
      await this.updateLastActive(user.uid);

      console.log('✅ User signed in successfully:', user.email);
      return user;

    } catch (error) {
      console.error('❌ Sign in failed:', error);
      throw this.handleAuthError(error);
    }
  }

  /**
   * Sign out current user
   * @returns {Promise<void>}
   */
  async signOut() {
    try {
      await signOut(auth);
      this.currentUser = null;
      console.log('✅ User signed out successfully');
    } catch (error) {
      console.error('❌ Sign out failed:', error);
      throw this.handleAuthError(error);
    }
  }

  /**
   * Send password reset email
   * @param {string} email - User email
   * @returns {Promise<void>}
   */
  async resetPassword(email) {
    try {
      await withRetry(
        () => sendPasswordResetEmail(auth, email.toLowerCase()),
        'Password reset email'
      );
      console.log('✅ Password reset email sent to:', email);
    } catch (error) {
      console.error('❌ Password reset failed:', error);
      throw this.handleAuthError(error);
    }
  }

  /**
   * Update user profile
   * @param {Object} updates - Profile updates
   * @returns {Promise<void>}
   */
  async updateProfile(updates) {
    if (!this.currentUser) {
      throw new Error('No authenticated user');
    }

    try {
      const userRef = doc(db, 'users', this.currentUser.uid);
      const updateData = {
        ...updates,
        updatedAt: serverTimestamp()
      };

      await withRetry(
        () => setDoc(userRef, updateData, { merge: true }),
        'Profile update'
      );

      quotaManager.trackWrite(1);

      // Update Firebase Auth profile if display name changed
      if (updates.username) {
        await updateProfile(this.currentUser, { displayName: updates.username });
      }

      console.log('✅ Profile updated successfully');
    } catch (error) {
      console.error('❌ Profile update failed:', error);
      throw this.handleAuthError(error);
    }
  }

  /**
   * Change user password
   * @param {string} currentPassword - Current password
   * @param {string} newPassword - New password
   * @returns {Promise<void>}
   */
  async changePassword(currentPassword, newPassword) {
    if (!this.currentUser) {
      throw new Error('No authenticated user');
    }

    try {
      // Re-authenticate user
      const credential = EmailAuthProvider.credential(
        this.currentUser.email,
        currentPassword
      );

      await reauthenticateWithCredential(this.currentUser, credential);

      // Update password
      await updatePassword(this.currentUser, newPassword);

      console.log('✅ Password changed successfully');
    } catch (error) {
      console.error('❌ Password change failed:', error);
      throw this.handleAuthError(error);
    }
  }

  /**
   * Resend email verification
   * @returns {Promise<void>}
   */
  async resendEmailVerification() {
    if (!this.currentUser) {
      throw new Error('No authenticated user');
    }

    try {
      await sendEmailVerification(this.currentUser);
      console.log('✅ Verification email sent');
    } catch (error) {
      console.error('❌ Email verification failed:', error);
      throw this.handleAuthError(error);
    }
  }

  /**
   * Set admin claim for user (admin only)
   * @param {string} uid - User ID
   * @param {boolean} isAdmin - Admin status
   * @returns {Promise<void>}
   */
  async setAdminClaim(uid, isAdmin) {
    if (!this.currentUser || !await this.isCurrentUserAdmin()) {
      throw new Error('Admin privileges required');
    }

    try {
      const userRef = doc(db, 'users', uid);
      await withRetry(
        () => setDoc(userRef, {
          isAdmin: isAdmin,
          updatedAt: serverTimestamp()
        }, { merge: true }),
        'Admin claim update'
      );

      quotaManager.trackWrite(1);
      console.log(`✅ Admin claim ${isAdmin ? 'granted' : 'revoked'} for user:`, uid);
    } catch (error) {
      console.error('❌ Admin claim update failed:', error);
      throw this.handleAuthError(error);
    }
  }

  /**
   * Get current user
   * @returns {Object|null} Current user
   */
  getCurrentUser() {
    return this.currentUser;
  }

  /**
   * Check if current user is admin
   * @returns {Promise<boolean>} Admin status
   */
  async isCurrentUserAdmin() {
    if (!this.currentUser) return false;

    try {
      const userDoc = await this.getUserProfile(this.currentUser.uid);
      return userDoc?.isAdmin || false;
    } catch (error) {
      console.warn('Failed to check admin status:', error.message);
      return false;
    }
  }

  /**
   * Get user profile from Firestore
   * @param {string} uid - User ID
   * @returns {Promise<Object|null>} User profile data
   */
  async getUserProfile(uid) {
    try {
      const userRef = doc(db, 'users', uid);
      const userSnap = await withRetry(
        () => getDoc(userRef),
        'User profile fetch'
      );

      quotaManager.trackRead(1);

      if (userSnap.exists()) {
        return userSnap.data();
      }
      return null;
    } catch (error) {
      console.error('❌ Failed to get user profile:', error);
      throw error;
    }
  }

  /**
   * Load current user profile
   * @param {string} uid - User ID
   * @returns {Promise<void>}
   */
  async loadUserProfile(uid) {
    try {
      const profile = await this.getUserProfile(uid);
      if (profile) {
        this.currentUser.profile = profile;
      }
    } catch (error) {
      console.warn('Failed to load user profile:', error.message);
    }
  }

  /**
   * Update last active timestamp
   * @param {string} uid - User ID
   * @returns {Promise<void>}
   */
  async updateLastActive(uid) {
    try {
      const { setDoc } = await import('firebase/firestore');
      const userRef = doc(db, 'users', uid);
      await setDoc(userRef, {
        lastActive: serverTimestamp()
      }, { merge: true });
      quotaManager.trackWrite(1);
    } catch (error) {
      console.warn('Failed to update last active:', error.message);
    }
  }

  /**
   * Register auth state change listener
   * @param {Function} callback - Callback function
   * @returns {Function} Unsubscribe function
   */
  onAuthStateChanged(callback) {
    this.authStateListeners.push(callback);

    // If already initialized, call immediately
    if (this.isInitialized) {
      callback(this.currentUser);
    }

    // Return unsubscribe function
    return () => {
      const index = this.authStateListeners.indexOf(callback);
      if (index > -1) {
        this.authStateListeners.splice(index, 1);
      }
    };
  }

  /**
   * Wait for auth initialization
   * @returns {Promise<Object|null>} Current user
   */
  async waitForAuth() {
    if (this.isInitialized) {
      return this.currentUser;
    }

    return new Promise((resolve) => {
      const unsubscribe = this.onAuthStateChanged((user) => {
        unsubscribe();
        resolve(user);
      });
    });
  }

  /**
   * Generate referral code
   * @param {string} username - Username
   * @returns {string} Referral code
   */
  generateReferralCode(username) {
    const prefix = username.substring(0, 3).toUpperCase();
    const suffix = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `${prefix}${suffix}`;
  }

  /**
   * Process referral bonus
   * @param {string} referralCode - Referral code
   * @param {string} newUserUid - New user ID
   * @returns {Promise<void>}
   */
  async processReferralBonus(referralCode, newUserUid) {
    try {
      console.log('🔗 Processing referral bonus for code:', referralCode);

      // Create a pending transaction for the admin to approve
      const transactionData = {
        userId: newUserUid,
        type: 'referral',
        amount: 50, // Standard bonus
        status: 'pending',
        method: 'system',
        details: {
          referralCode,
          description: `Referral bonus for using code: ${referralCode}`
        },
        createdAt: serverTimestamp()
      };

      await withRetry(
        () => setDoc(doc(db, 'transactions', `referral_${newUserUid}_${Date.now()}`), transactionData),
        'Referral transaction creation'
      );

      quotaManager.trackWrite(1);
      console.log('✅ Referral transaction created for approval');

    } catch (error) {
      console.warn('⚠️ Referral bonus processing failed:', error.message);
    }
  }

  /**
   * Handle Firebase Auth errors
   * @param {Error} error - Firebase error
   * @returns {Error} Formatted error
   */
  handleAuthError(error) {
    const errorMessages = {
      'auth/user-not-found': 'No account found with this email address',
      'auth/wrong-password': 'Incorrect password',
      'auth/email-already-in-use': 'An account with this email already exists',
      'auth/weak-password': 'Password should be at least 6 characters',
      'auth/invalid-email': 'Invalid email address',
      'auth/user-disabled': 'This account has been disabled',
      'auth/too-many-requests': 'Too many failed attempts. Try again later',
      'auth/network-request-failed': 'Network error. Check your connection',
      'auth/requires-recent-login': 'Please sign in again to continue',
      'auth/invalid-credential': 'Invalid credentials provided'
    };

    const message = errorMessages[error.code] || error.message || 'Authentication failed';
    return new Error(message);
  }
}

// Create and export singleton instance
const authManager = new AuthManager();
export default authManager;