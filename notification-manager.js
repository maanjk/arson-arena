// NotificationManager for Firebase Cloud Messaging
// Handles FCM initialization, token management, and notification operations

import { messaging, auth, db } from './firebase-config.js';
import { getToken, onMessage, deleteToken } from 'firebase/messaging';
import {
  doc,
  updateDoc,
  getDoc,
  setDoc,
  deleteDoc,
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  arrayUnion,
  arrayRemove
} from 'firebase/firestore';

class NotificationManager {
  constructor() {
    this.fcmToken = null;
    this.isInitialized = false;
    this.messageCallbacks = [];
    this.notificationHistory = [];
    this.userPreferences = {
      enabled: true,
      tournaments: true,
      transactions: true,
      announcements: true,
      matches: true,
      sound: true,
      vibration: true
    };

    // VAPID key for FCM (Replace with actual key from Firebase Console)
    this.vapidKey = 'BFp_XXXXXXXX-XXXXXXXX'; // Mock professional-looking placeholder

    this.init();
  }

  /**
   * Initialize the NotificationManager
   */
  async init() {
    try {
      // Check if messaging is available
      if (!messaging) {
        console.warn('⚠️ Firebase Cloud Messaging is not available');
        return false;
      }

      // Check if notifications are supported
      if (!('Notification' in window)) {
        console.warn('⚠️ Notifications are not supported in this browser');
        return false;
      }

      // Check if service worker is supported
      if (!('serviceWorker' in navigator)) {
        console.warn('⚠️ Service Worker is not supported in this browser');
        return false;
      }

      // Register service worker if not already registered
      await this.registerServiceWorker();

      // Load user preferences
      await this.loadUserPreferences();

      // Set up message listener for foreground messages
      this.setupForegroundMessageListener();

      // Listen for auth state changes
      auth.onAuthStateChanged(async (user) => {
        if (user) {
          await this.handleUserSignIn(user);
        } else {
          await this.handleUserSignOut();
        }
      });

      // Initialize announcement system
      this.initializeAnnouncementSystem();

      this.isInitialized = true;
      console.log('✅ NotificationManager initialized successfully');
      return true;

    } catch (error) {
      console.error('❌ NotificationManager initialization failed:', error.message);
      return false;
    }
  }

  /**
   * Register service worker for FCM
   */
  async registerServiceWorker() {
    try {
      const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
      console.log('✅ Service Worker registered for FCM:', registration.scope);
      return registration;
    } catch (error) {
      console.error('❌ Service Worker registration failed:', error);
      throw error;
    }
  }

  /**
   * Request notification permission from user
   */
  async requestPermission() {
    try {
      if (Notification.permission === 'granted') {
        return true;
      }

      if (Notification.permission === 'denied') {
        console.warn('⚠️ Notification permission denied');
        return false;
      }

      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        await this.getFCMToken();
        return true;
      }
      return false;
    } catch (error) {
      console.error('❌ Error requesting permission:', error);
      return false;
    }
  }

  /**
   * Get FCM token
   */
  async getFCMToken() {
    try {
      if (!messaging) return null;

      const token = await getToken(messaging, { vapidKey: this.vapidKey });
      if (token) {
        this.fcmToken = token;
        if (auth.currentUser) {
          await this.saveFCMTokenToProfile(token);
        }
        return token;
      }
      return null;
    } catch (error) {
      console.error('❌ Error getting FCM token:', error);
      return null;
    }
  }

  /**
   * Save token to profile
   */
  async saveFCMTokenToProfile(token) {
    try {
      const userRef = doc(db, 'users', auth.currentUser.uid);
      await setDoc(userRef, {
        fcmTokens: arrayUnion(token),
        lastTokenUpdate: serverTimestamp()
      }, { merge: true });
    } catch (error) {
      console.error('❌ Error saving token:', error);
    }
  }

  /**
   * Remove token from profile
   */
  async removeFCMTokenFromProfile(token) {
    try {
      if (!auth.currentUser) return;
      const userRef = doc(db, 'users', auth.currentUser.uid);
      await setDoc(userRef, {
        fcmTokens: arrayRemove(token)
      }, { merge: true });
    } catch (error) {
      console.error('❌ Error removing token:', error);
    }
  }

  /**
   * Delete token
   */
  async deleteFCMToken() {
    try {
      if (!messaging || !this.fcmToken) return;
      await this.removeFCMTokenFromProfile(this.fcmToken);
      await deleteToken(messaging);
      this.fcmToken = null;
    } catch (error) {
      console.error('❌ Error deleting token:', error);
    }
  }

  /**
   * Foreground listener
   */
  setupForegroundMessageListener() {
    if (!messaging) return;

    onMessage(messaging, (payload) => {
      console.log('📨 Foreground message:', payload);
      this.addToNotificationHistory(payload);

      if (this.shouldShowNotification(payload)) {
        this.showInAppNotification(payload);
      }

      this.messageCallbacks.forEach(cb => {
        try { cb(payload); } catch (e) { }
      });

      this.handleNotificationAction(payload);
    });
  }

  onMessage(callback) {
    if (typeof callback === 'function') this.messageCallbacks.push(callback);
  }

  offMessage(callback) {
    const idx = this.messageCallbacks.indexOf(callback);
    if (idx > -1) this.messageCallbacks.splice(idx, 1);
  }

  shouldShowNotification(payload) {
    if (!this.userPreferences.enabled) return false;
    const type = payload.data?.type;
    switch (type) {
      case 'tournament_update':
      case 'tournament_created':
        return this.userPreferences.tournaments;
      case 'transaction_update':
        return this.userPreferences.transactions;
      case 'system_announcement':
        return this.userPreferences.announcements;
      case 'match_ready':
        return this.userPreferences.matches;
      default:
        return true;
    }
  }

  showInAppNotification(payload) {
    const title = payload.notification?.title || 'ARSON Arena';
    const body = payload.notification?.body || 'New notification';
    const type = payload.data?.type || 'info';

    if (window.showToast) {
      window.showToast(body, this.getToastType(type), title);
    } else {
      this.showBrowserNotification(title, body, payload.data);
    }
  }

  showBrowserNotification(title, body, data = {}) {
    if (Notification.permission !== 'granted') return;
    const options = {
      body,
      icon: '/icon-192x192.png',
      badge: '/badge-72x72.png',
      tag: data.type || 'general',
      data,
      silent: !this.userPreferences.sound
    };
    const n = new Notification(title, options);
    n.onclick = () => {
      this.handleNotificationClick(data);
      n.close();
    };
  }

  getToastType(type) {
    if (type.includes('success')) return 'success';
    if (type.includes('error')) return 'error';
    if (type.includes('warning')) return 'warning';
    return 'info';
  }

  handleNotificationAction(payload) {
    const data = payload.data || {};
    if (!window.switchView) return;

    switch (data.type) {
      case 'tournament_created':
      case 'tournament_update':
        setTimeout(() => {
          window.switchView('dashboard');
          if (window.openTournamentModal && data.tournamentId) {
            window.openTournamentModal(data.tournamentId);
          }
        }, 100);
        break;
      case 'transaction_update':
        setTimeout(() => window.switchView('wallet'), 100);
        break;
      case 'system_announcement':
        if (data.announcementId) {
          // Handled by real-time listener usually, but can trigger modal here if needed
        }
        break;
    }
  }

  handleNotificationClick(data) {
    this.handleNotificationAction({ data });
  }

  addToNotificationHistory(payload) {
    const n = {
      id: Date.now().toString(),
      title: payload.notification?.title || 'ARSON Arena',
      body: payload.notification?.body || '',
      type: payload.data?.type || 'general',
      data: payload.data || {},
      timestamp: new Date(),
      read: false
    };
    this.notificationHistory.unshift(n);
    if (this.notificationHistory.length > 50) this.notificationHistory.pop();
    this.saveNotificationHistory();
    window.dispatchEvent(new CustomEvent('notification-received', { detail: n }));
  }

  saveNotificationHistory() {
    localStorage.setItem('notification_history', JSON.stringify(this.notificationHistory));
  }

  loadNotificationHistory() {
    const saved = localStorage.getItem('notification_history');
    if (saved) {
      this.notificationHistory = JSON.parse(saved).map(n => ({ ...n, timestamp: new Date(n.timestamp) }));
    }
  }

  async updatePreferences(prefs) {
    this.userPreferences = { ...this.userPreferences, ...prefs };
    localStorage.setItem('notification_preferences', JSON.stringify(this.userPreferences));
    if (auth.currentUser) {
      const userRef = doc(db, 'users', auth.currentUser.uid);
      await setDoc(userRef, { notificationPreferences: this.userPreferences }, { merge: true });
    }
    window.dispatchEvent(new CustomEvent('notification-preferences-updated', { detail: this.userPreferences }));
  }

  async loadUserPreferences() {
    const saved = localStorage.getItem('notification_preferences');
    if (saved) this.userPreferences = { ...this.userPreferences, ...JSON.parse(saved) };
    if (auth.currentUser) {
      const snap = await getDoc(doc(db, 'users', auth.currentUser.uid));
      if (snap.exists() && snap.data().notificationPreferences) {
        this.userPreferences = { ...this.userPreferences, ...snap.data().notificationPreferences };
      }
    }
    this.loadNotificationHistory();
  }

  async handleUserSignIn(user) {
    await this.loadUserPreferences();
    if (Notification.permission === 'granted') await this.getFCMToken();
  }

  async handleUserSignOut() {
    if (this.fcmToken) await this.deleteFCMToken();
    this.userPreferences = {
      enabled: true, tournaments: true, transactions: true,
      announcements: true, matches: true, sound: true, vibration: true
    };
  }

  /**
   * SYSTEM ANNOUNCEMENT FUNCTIONALITY
   */

  async sendSystemAnnouncement(data) {
    try {
      const id = `announcement_${Date.now()}`;
      const announcement = {
        id,
        title: data.title,
        message: data.message,
        type: data.type || 'info',
        priority: data.priority || 'normal',
        persistent: data.persistent || false,
        actionText: data.actionText || null,
        actionUrl: data.actionUrl || null,
        createdAt: serverTimestamp(),
        expiresAt: data.expiresIn ? new Date(Date.now() + (data.expiresIn * 3600000)) : null,
        active: true,
        createdBy: auth.currentUser?.uid || 'admin'
      };

      await setDoc(doc(db, 'system_announcements', id), announcement);
      console.log('📢 Announcement sent to Firestore:', id);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Send notification for tournament participant change (join/leave)
   */
  async handleTournamentParticipantChange(tournamentId, tournament, type, user) {
    if (!this.userPreferences.tournaments) return;

    const message = type === 'joined' ?
      `${user.username} joined "${tournament.title}"` :
      `${user.username} left "${tournament.title}"`;

    await this.sendLocalNotification('Tournament Update', message, {
      type: 'tournament_participant',
      tournamentId
    });
  }

  /**
   * Send notification for tournament status change
   */
  async handleTournamentStatusChange(tournamentId, tournament, oldStatus, newStatus) {
    if (!this.userPreferences.tournaments) return;

    let message = `Tournament "${tournament.title}" status changed to ${newStatus}`;
    if (newStatus === 'active') message = `Tournament "${tournament.title}" is now LIVE!`;
    if (newStatus === 'completed') message = `Tournament "${tournament.title}" has finished. Check results!`;

    await this.sendLocalNotification('Tournament Alert', message, {
      type: 'tournament_status',
      tournamentId,
      status: newStatus
    });
  }

  /**
   * Send notification when room details are added
   */
  async handleTournamentRoomDetailsAdded(tournamentId, tournament, roomDetails) {
    if (!this.userPreferences.matches) return;

    const message = `Match room details for "${tournament.title}" are now available!`;
    await this.sendLocalNotification('Match Ready', message, {
      type: 'tournament_room',
      tournamentId,
      ...roomDetails
    });
  }

  /**
   * Broadcast notification about a new tournament
   */
  async broadcastTournamentNotification(type, tournament) {
    if (type === 'tournament_created') {
      const message = `New ${tournament.game} tournament: "${tournament.title}" - Join now!`;
      await this.sendLocalNotification('New Tournament', message, {
        type: 'tournament_created',
        tournamentId: tournament.id
      });
    }
  }

  /**
   * Show a local browser notification
   */
  async sendLocalNotification(title, body, data = {}) {
    if (!this.userPreferences.enabled) return;

    if (Notification.permission === 'granted') {
      const options = {
        body,
        icon: '/assets/logo.png', // Add proper icon path
        badge: '/assets/badge.png',
        data: {
          ...data,
          timestamp: Date.now()
        },
        vibrate: this.userPreferences.vibration ? [200, 100, 200] : []
      };

      const notification = new Notification(title, options);

      notification.onclick = (event) => {
        event.preventDefault();
        window.focus();
        if (data.tournamentId && window.openTournamentModal) {
          window.openTournamentModal(data.tournamentId);
        }
        notification.close();
      };

      this.notificationHistory.push({
        id: `local_${Date.now()}`,
        title,
        message: body,
        data,
        createdAt: new Date(),
        read: false
      });

      return true;
    }
    return false;
  }

  onAnnouncementsChanged(callback) {
    const q = query(
      collection(db, 'system_announcements'),
      where('active', '==', true),
      orderBy('createdAt', 'desc'),
      limit(10)
    );

    return onSnapshot(q,
      (snap) => {
        const announcements = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        callback(announcements);

        // Check for new high priority ones
        announcements.forEach(a => {
          const seen = JSON.parse(localStorage.getItem('seen_announcements') || '[]');
          if (a.priority === 'high' && !seen.includes(a.id)) {
            this.showAnnouncementModal(a);
            seen.push(a.id);
            localStorage.setItem('seen_announcements', JSON.stringify(seen));
          }
        });
      },
      (error) => {
        console.error('❌ Announcement listener error:', error);
        callback([]); // Return empty array on error
      }
    );
  }

  async deleteAnnouncement(id) {
    try {
      await deleteDoc(doc(db, 'system_announcements', id));
      return true;
    } catch (error) {
      console.error('❌ Failed to delete announcement:', error);
      return false;
    }
  }

  dismissAnnouncement(id) {
    const seen = JSON.parse(localStorage.getItem('seen_announcements') || '[]');
    if (!seen.includes(id)) {
      seen.push(id);
      localStorage.setItem('seen_announcements', JSON.stringify(seen));
    }
    this.hidePersistentBanner(id);
    const overlay = document.getElementById('announcement-overlay');
    if (overlay && overlay.getAttribute('data-announcement-id') === id) {
      overlay.classList.add('hidden');
    }
  }

  showAnnouncementModal(announcement) {
    const overlay = document.getElementById('announcement-overlay');
    const modal = document.getElementById('announcement-modal');
    if (!overlay || !modal) return;

    modal.innerHTML = `
      <div class=\"text-center\">
        <div class=\"w-16 h-16 rounded-full bg-white/10 flex items-center justify-center mx-auto mb-4\">
          <i class=\"ph-bold ph-megaphone text-3xl\"></i>
        </div>
        <h2 class=\"text-xl font-bold text-white mb-3\">${announcement.title}</h2>
        <p class=\"text-ios-subtext text-sm leading-relaxed mb-6\">${announcement.message}</p>
        <div class=\"flex gap-3 justify-center\">
          ${announcement.actionUrl ? `<a href=\"${announcement.actionUrl}\" class=\"px-6 py-2 bg-ios-blue text-white font-bold rounded-xl\">${announcement.actionText || 'Read More'}</a>` : ''}
          <button onclick=\"notificationManager.dismissAnnouncement('${announcement.id}')\" class=\"px-6 py-2 bg-white/10 text-white font-bold rounded-xl\">Got it</button>
        </div>
      </div>
    `;
    overlay.classList.remove('hidden');
    overlay.setAttribute('data-announcement-id', announcement.id);
  }

  hidePersistentBanner(id) {
    const banner = document.getElementById('notification-banner');
    if (banner && banner.getAttribute('data-announcement-id') === id) {
      banner.classList.add('hidden');
    }
  }

  initializeAnnouncementSystem() {
    setInterval(() => this.cleanupExpiredAnnouncements(), 3600000);
  }

  async cleanupExpiredAnnouncements() {
    // Usually handled by backend, but here we can do a local cleanup if needed
  }

  getStatus() {
    return {
      isInitialized: this.isInitialized,
      hasToken: !!this.fcmToken,
      permission: Notification.permission,
      preferences: this.userPreferences,
      unreadCount: this.notificationHistory.filter(n => !n.read).length
    };
  }

  getNotificationHistory() {
    return this.notificationHistory;
  }

  getUnreadCount() {
    return this.notificationHistory.filter(n => !n.read).length;
  }

  markNotificationAsRead(id) {
    const n = this.notificationHistory.find(x => x.id === id);
    if (n) {
      n.read = true;
      this.saveNotificationHistory();
      window.dispatchEvent(new CustomEvent('notification-read', { detail: { id } }));
    }
  }

  markAllNotificationsAsRead() {
    this.notificationHistory.forEach(n => { n.read = true; });
    this.saveNotificationHistory();
    window.dispatchEvent(new CustomEvent('notifications-all-read'));
  }
}

const notificationManager = new NotificationManager();
if (window.Firebase) window.Firebase.notificationManager = notificationManager;
export default notificationManager;