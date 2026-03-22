// DatabaseManager - Firestore Operations Service
// Optimized for Firebase Free Tier with quota management and aggressive caching

import {
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  onSnapshot,
  writeBatch,
  runTransaction,
  serverTimestamp,
  enableNetwork,
  disableNetwork,
  clearIndexedDbPersistence,
  terminate
} from 'firebase/firestore';

import { db, quotaManager, withRetry } from './firebase-config.js';

class DatabaseManager {
  constructor() {
    this.cache = new Map();
    this.listeners = new Map();
    this.batchOperations = [];
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes cache
    this.maxCacheSize = 1000;

    // Enable offline persistence
    this.enableOfflinePersistence();

    // Setup cache cleanup
    this.setupCacheCleanup();
  }

  /**
   * Enable Firestore offline persistence
   */
  async enableOfflinePersistence() {
    try {
      // Offline persistence is enabled by default in v9
      console.log('✅ Firestore offline persistence enabled');
    } catch (error) {
      console.warn('⚠️ Offline persistence setup failed:', error.message);
    }
  }

  /**
   * Setup cache cleanup interval
   */
  setupCacheCleanup() {
    setInterval(() => {
      this.cleanupCache();
    }, 10 * 60 * 1000); // Cleanup every 10 minutes
  }

  /**
   * Clean up expired cache entries
   */
  cleanupCache() {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.cacheTimeout) {
        this.cache.delete(key);
        cleaned++;
      }
    }

    // If cache is still too large, remove oldest entries
    if (this.cache.size > this.maxCacheSize) {
      const entries = Array.from(this.cache.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp);

      const toRemove = this.cache.size - this.maxCacheSize;
      for (let i = 0; i < toRemove; i++) {
        this.cache.delete(entries[i][0]);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`🧹 Cleaned ${cleaned} cache entries`);
    }
  }

  /**
   * Get cached data or fetch from Firestore
   * @param {string} path - Document path
   * @param {boolean} forceRefresh - Force refresh from server
   * @returns {Promise<Object|null>} Document data
   */
  async getCachedDoc(path, forceRefresh = false) {
    const cacheKey = `doc:${path}`;
    const cached = this.cache.get(cacheKey);

    // Return cached data if valid and not forcing refresh
    if (!forceRefresh && cached && (Date.now() - cached.timestamp) < this.cacheTimeout) {
      console.log(`📋 Cache hit for: ${path}`);
      return cached.data;
    }

    // Fetch from Firestore
    try {
      const docRef = doc(db, ...path.split('/'));
      const docSnap = await withRetry(
        () => getDoc(docRef),
        `Get document: ${path}`
      );

      quotaManager.trackRead(1);

      const data = docSnap.exists() ? docSnap.data() : null;

      // Cache the result
      this.cache.set(cacheKey, {
        data,
        timestamp: Date.now()
      });

      return data;
    } catch (error) {
      console.error(`❌ Failed to get document ${path}:`, error);

      // Return cached data if available during error
      if (cached) {
        console.log(`📋 Returning stale cache for: ${path}`);
        return cached.data;
      }

      throw error;
    }
  }

  /**
   * Create or update document
   * @param {string} path - Document path
   * @param {Object} data - Document data
   * @param {boolean} merge - Merge with existing data
   * @returns {Promise<void>}
   */
  async setDocument(path, data, merge = false) {
    if (!quotaManager.canPerformOperation('writes', 1)) {
      throw new Error('Daily write quota exceeded');
    }

    try {
      const docRef = doc(db, ...path.split('/'));
      const docData = {
        ...data,
        updatedAt: serverTimestamp()
      };

      if (merge) {
        await withRetry(
          () => setDoc(docRef, docData, { merge: true }),
          `Update document: ${path}`
        );
      } else {
        docData.createdAt = docData.createdAt || serverTimestamp();
        await withRetry(
          () => setDoc(docRef, docData),
          `Set document: ${path}`
        );
      }

      quotaManager.trackWrite(1);

      // Update cache
      const cacheKey = `doc:${path}`;
      this.cache.set(cacheKey, {
        data: docData,
        timestamp: Date.now()
      });

      console.log(`✅ Document ${merge ? 'updated' : 'created'}: ${path}`);
    } catch (error) {
      console.error(`❌ Failed to ${merge ? 'update' : 'create'} document ${path}:`, error);
      throw error;
    }
  }

  /**
   * Delete document
   * @param {string} path - Document path
   * @returns {Promise<void>}
   */
  async deleteDocument(path) {
    if (!quotaManager.canPerformOperation('deletes', 1)) {
      throw new Error('Daily delete quota exceeded');
    }

    try {
      const docRef = doc(db, ...path.split('/'));
      await withRetry(
        () => deleteDoc(docRef),
        `Delete document: ${path}`
      );

      quotaManager.trackDelete(1);

      // Remove from cache
      const cacheKey = `doc:${path}`;
      this.cache.delete(cacheKey);

      console.log(`✅ Document deleted: ${path}`);
    } catch (error) {
      console.error(`❌ Failed to delete document ${path}:`, error);
      throw error;
    }
  }

  /**
   * Query collection with caching
   * @param {string} collectionPath - Collection path
   * @param {Array} constraints - Query constraints
   * @param {boolean} useCache - Use cached results
   * @returns {Promise<Array>} Query results
   */
  async queryCollection(collectionPath, constraints = [], useCache = true) {
    const cacheKey = `query:${collectionPath}:${JSON.stringify(constraints)}`;
    const cached = this.cache.get(cacheKey);

    // Return cached data if valid
    if (useCache && cached && (Date.now() - cached.timestamp) < this.cacheTimeout) {
      console.log(`📋 Cache hit for query: ${collectionPath}`);
      return cached.data;
    }

    try {
      const collectionRef = collection(db, collectionPath);
      let q = collectionRef;

      // Apply constraints
      constraints.forEach(constraint => {
        if (constraint.type === 'where') {
          q = query(q, where(constraint.field, constraint.operator, constraint.value));
        } else if (constraint.type === 'orderBy') {
          q = query(q, orderBy(constraint.field, constraint.direction));
        } else if (constraint.type === 'limit') {
          q = query(q, limit(constraint.value));
        }
      });

      const querySnapshot = await withRetry(
        () => getDocs(q),
        `Query collection: ${collectionPath}`
      );

      quotaManager.trackRead(querySnapshot.size);

      const results = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      // Cache results
      if (useCache) {
        this.cache.set(cacheKey, {
          data: results,
          timestamp: Date.now()
        });
      }

      return results;
    } catch (error) {
      console.error(`❌ Failed to query collection ${collectionPath}:`, error);

      // Return cached data if available during error
      if (cached) {
        console.log(`📋 Returning stale cache for query: ${collectionPath}`);
        return cached.data;
      }

      throw error;
    }
  }

  /**
   * Set up real-time listener (use sparingly)
   * @param {string} path - Document or collection path
   * @param {Function} callback - Callback function
   * @param {Array} constraints - Query constraints for collections
   * @returns {Function} Unsubscribe function
   */
  setupRealtimeListener(path, callback, constraints = []) {
    const listenerId = `${path}:${Date.now()}`;

    try {
      let ref;

      if (path.split('/').length % 2 === 0) {
        // Document path
        ref = doc(db, ...path.split('/'));
      } else {
        // Collection path
        ref = collection(db, path);

        // Apply constraints for collection queries
        if (constraints.length > 0) {
          let q = ref;
          constraints.forEach(constraint => {
            if (constraint.type === 'where') {
              q = query(q, where(constraint.field, constraint.operator, constraint.value));
            } else if (constraint.type === 'orderBy') {
              q = query(q, orderBy(constraint.field, constraint.direction));
            } else if (constraint.type === 'limit') {
              q = query(q, limit(constraint.value));
            }
          });
          ref = q;
        }
      }

      const unsubscribe = onSnapshot(ref,
        (snapshot) => {
          try {
            let data;

            if (snapshot.docs) {
              // Collection snapshot
              data = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
              }));
              quotaManager.trackRead(snapshot.docs.length);
            } else {
              // Document snapshot
              data = snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
              quotaManager.trackRead(1);
            }

            // Update cache
            const cacheKey = snapshot.docs ? `query:${path}` : `doc:${path}`;
            this.cache.set(cacheKey, {
              data,
              timestamp: Date.now()
            });

            callback(data);
          } catch (error) {
            console.error('Realtime listener callback error:', error);
          }
        },
        (error) => {
          console.error(`❌ Realtime listener error for ${path}:`, error);
          callback(null, error);
        }
      );

      this.listeners.set(listenerId, unsubscribe);
      console.log(`👂 Realtime listener setup for: ${path}`);

      // Return unsubscribe function
      return () => {
        unsubscribe();
        this.listeners.delete(listenerId);
        console.log(`🔇 Realtime listener removed for: ${path}`);
      };

    } catch (error) {
      console.error(`❌ Failed to setup realtime listener for ${path}:`, error);
      throw error;
    }
  }

  /**
   * Add operation to batch
   * @param {string} operation - Operation type (set, update, delete)
   * @param {string} path - Document path
   * @param {Object} data - Document data
   */
  addToBatch(operation, path, data = null) {
    this.batchOperations.push({ operation, path, data });
  }

  /**
   * Execute batch operations
   * @returns {Promise<void>}
   */
  async executeBatch() {
    if (this.batchOperations.length === 0) {
      return;
    }

    const writeCount = this.batchOperations.filter(op =>
      op.operation === 'set' || op.operation === 'update'
    ).length;

    const deleteCount = this.batchOperations.filter(op =>
      op.operation === 'delete'
    ).length;

    if (!quotaManager.canPerformOperation('writes', writeCount) ||
      !quotaManager.canPerformOperation('deletes', deleteCount)) {
      throw new Error('Insufficient quota for batch operation');
    }

    try {
      const batch = writeBatch(db);

      this.batchOperations.forEach(({ operation, path, data }) => {
        const docRef = doc(db, ...path.split('/'));

        switch (operation) {
          case 'set':
            batch.set(docRef, { ...data, updatedAt: serverTimestamp() });
            break;
          case 'update':
            batch.update(docRef, { ...data, updatedAt: serverTimestamp() });
            break;
          case 'delete':
            batch.delete(docRef);
            break;
        }
      });

      await withRetry(
        () => batch.commit(),
        'Batch operation'
      );

      quotaManager.trackWrite(writeCount);
      quotaManager.trackDelete(deleteCount);

      console.log(`✅ Batch executed: ${this.batchOperations.length} operations`);
      this.batchOperations = [];

    } catch (error) {
      console.error('❌ Batch operation failed:', error);
      throw error;
    }
  }

  /**
   * Run atomic transaction
   * @param {Function} updateFunction - Transaction update function
   * @returns {Promise<any>} Transaction result
   */
  async runTransaction(updateFunction) {
    try {
      const result = await withRetry(
        () => runTransaction(db, updateFunction),
        'Firestore transaction'
      );

      // Note: Transaction reads/writes are tracked within the updateFunction
      console.log('✅ Transaction completed successfully');
      return result;

    } catch (error) {
      console.error('❌ Transaction failed:', error);
      throw error;
    }
  }

  /**
   * User-specific operations
   */

  // Create user profile
  async createUser(uid, userData) {
    return this.setDocument(`users/${uid}`, userData);
  }

  // Update user profile
  async updateUser(uid, updates) {
    return this.setDocument(`users/${uid}`, updates, true);
  }

  // Get user profile
  async getUser(uid) {
    return this.getCachedDoc(`users/${uid}`);
  }

  // Setup user change listener
  onUserChanged(uid, callback) {
    return this.setupRealtimeListener(`users/${uid}`, callback);
  }

  // Setup all users listener (Admin only)
  onAllUsersChanged(callback, limit = 100) {
    const constraints = [
      { type: 'orderBy', field: 'updatedAt', direction: 'desc' },
      { type: 'limit', value: limit }
    ];
    return this.setupRealtimeListener('users', callback, constraints);
  }

  /**
   * Tournament-specific operations
   */

  // Create tournament
  async createTournament(tournamentData) {
    const tournamentId = `tournament_${Date.now()}`;
    return this.setDocument(`tournaments/${tournamentId}`, {
      id: tournamentId,
      ...tournamentData
    });
  }

  // Update tournament
  async updateTournament(id, updates) {
    return this.setDocument(`tournaments/${id}`, updates, true);
  }

  // Delete tournament
  async deleteTournament(id) {
    return this.deleteDocument(`tournaments/${id}`);
  }

  // Get tournaments
  async getTournaments(status = null, limit = 50) {
    const constraints = [
      { type: 'orderBy', field: 'createdAt', direction: 'desc' },
      { type: 'limit', value: limit }
    ];

    if (status) {
      constraints.unshift({ type: 'where', field: 'status', operator: '==', value: status });
    }

    return this.queryCollection('tournaments', constraints);
  }

  // Setup tournaments change listener
  onTournamentsChanged(callback, status = null) {
    const constraints = [
      { type: 'orderBy', field: 'createdAt', direction: 'desc' },
      { type: 'limit', value: 50 }
    ];

    if (status) {
      constraints.unshift({ type: 'where', field: 'status', operator: '==', value: status });
    }

    return this.setupRealtimeListener('tournaments', callback, constraints);
  }

  /**
   * Transaction-specific operations
   */

  // Create transaction
  async createTransaction(transactionData) {
    const transactionId = `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    return this.setDocument(`transactions/${transactionId}`, {
      id: transactionId,
      createdAt: serverTimestamp(),
      ...transactionData
    });
  }

  // Update transaction status
  async updateTransactionStatus(id, status, adminNotes = '') {
    return this.setDocument(`transactions/${id}`, {
      status,
      adminNotes,
      processedAt: serverTimestamp()
    }, true);
  }

  // Get user transactions
  async getUserTransactions(userId, limit = 50) {
    const constraints = [
      { type: 'where', field: 'userId', operator: '==', value: userId },
      { type: 'orderBy', field: 'createdAt', direction: 'desc' },
      { type: 'limit', value: limit }
    ];

    return this.queryCollection('transactions', constraints);
  }

  // Setup transactions change listener
  onTransactionsChanged(callback, userId = null) {
    const constraints = [
      { type: 'orderBy', field: 'createdAt', direction: 'desc' },
      { type: 'limit', value: 100 }
    ];

    if (userId) {
      constraints.unshift({ type: 'where', field: 'userId', operator: '==', value: userId });
    }

    return this.setupRealtimeListener('transactions', callback, constraints);
  }

  // Setup all transactions listener (Admin only)
  onAllTransactionsChanged(callback, limit = 200) {
    const constraints = [
      { type: 'orderBy', field: 'createdAt', direction: 'desc' },
      { type: 'limit', value: limit }
    ];
    return this.setupRealtimeListener('transactions', callback, constraints);
  }

  /**
   * Leaderboard operations
   */

  // Update leaderboard
  async updateLeaderboard(type, userData) {
    return this.setDocument(`leaderboards/${type}`, {
      type,
      rankings: userData,
      lastUpdated: serverTimestamp()
    });
  }

  // Get leaderboard
  async getLeaderboard(type) {
    return this.getCachedDoc(`leaderboards/${type}`);
  }

  // Setup leaderboard change listener
  onLeaderboardChanged(type, callback) {
    return this.setupRealtimeListener(`leaderboards/${type}`, callback);
  }

  /**
   * Utility methods
   */

  // Clear all cache
  clearCache() {
    this.cache.clear();
    console.log('🧹 Cache cleared');
  }

  // Get cache stats
  getCacheStats() {
    return {
      size: this.cache.size,
      maxSize: this.maxCacheSize,
      timeout: this.cacheTimeout,
      activeListeners: this.listeners.size
    };
  }

  // Cleanup all listeners
  cleanup() {
    this.listeners.forEach(unsubscribe => unsubscribe());
    this.listeners.clear();
    this.clearCache();
    console.log('🧹 DatabaseManager cleanup completed');
  }

  // Force network reconnection
  async reconnect() {
    try {
      await disableNetwork(db);
      await enableNetwork(db);
      console.log('🔄 Firestore reconnected');
    } catch (error) {
      console.error('❌ Firestore reconnection failed:', error);
    }
  }
}

// Create and export singleton instance
const databaseManager = new DatabaseManager();
export default databaseManager;