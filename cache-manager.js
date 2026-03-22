// Advanced Caching System for Firebase Free Tier Optimization
// Implements multiple caching strategies to minimize Firestore reads

class CacheManager {
  constructor() {
    this.caches = new Map();
    this.cacheStats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      totalRequests: 0
    };
    
    this.initializeCaches();
    this.setupCacheCleanup();
    this.setupStorageEventListener();
  }

  /**
   * Initialize different cache types
   */
  initializeCaches() {
    // Memory cache - fastest, limited size
    this.caches.set('memory', new MemoryCache({
      maxSize: 500,
      ttl: 5 * 60 * 1000 // 5 minutes
    }));

    // Session storage cache - survives page refresh
    this.caches.set('session', new SessionStorageCache({
      maxSize: 200,
      ttl: 30 * 60 * 1000 // 30 minutes
    }));

    // Local storage cache - survives browser restart
    this.caches.set('local', new LocalStorageCache({
      maxSize: 100,
      ttl: 24 * 60 * 60 * 1000 // 24 hours
    }));

    // IndexedDB cache - for large data sets
    this.caches.set('indexed', new IndexedDBCache({
      maxSize: 1000,
      ttl: 7 * 24 * 60 * 60 * 1000 // 7 days
    }));
  }

  /**
   * Setup periodic cache cleanup
   */
  setupCacheCleanup() {
    // Clean expired entries every 10 minutes
    setInterval(() => {
      this.cleanupExpiredEntries();
    }, 10 * 60 * 1000);

    // Clean up on page visibility change
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.cleanupExpiredEntries();
      }
    });
  }

  /**
   * Setup storage event listener for cross-tab synchronization
   */
  setupStorageEventListener() {
    window.addEventListener('storage', (event) => {
      if (event.key && event.key.startsWith('firebase_cache_')) {
        // Invalidate memory cache when localStorage changes
        const cacheKey = event.key.replace('firebase_cache_', '');
        this.caches.get('memory').delete(cacheKey);
      }
    });
  }

  /**
   * Get data from cache with fallback strategy
   * @param {string} key - Cache key
   * @param {string} strategy - Cache strategy ('memory', 'session', 'local', 'indexed', 'all')
   * @returns {Promise<any>} Cached data or null
   */
  async get(key, strategy = 'all') {
    this.cacheStats.totalRequests++;

    if (strategy === 'all') {
      // Try caches in order of speed
      const cacheOrder = ['memory', 'session', 'local', 'indexed'];
      
      for (const cacheType of cacheOrder) {
        const cache = this.caches.get(cacheType);
        const data = await cache.get(key);
        
        if (data !== null) {
          this.cacheStats.hits++;
          
          // Promote to faster caches
          await this.promoteToFasterCaches(key, data, cacheType);
          
          return data;
        }
      }
    } else {
      const cache = this.caches.get(strategy);
      if (cache) {
        const data = await cache.get(key);
        if (data !== null) {
          this.cacheStats.hits++;
          return data;
        }
      }
    }

    this.cacheStats.misses++;
    return null;
  }

  /**
   * Set data in cache with appropriate strategy
   * @param {string} key - Cache key
   * @param {any} data - Data to cache
   * @param {Object} options - Cache options
   */
  async set(key, data, options = {}) {
    const {
      strategy = 'auto',
      ttl = null,
      priority = 'medium',
      size = this.estimateSize(data)
    } = options;

    let cacheTypes = [];

    if (strategy === 'auto') {
      cacheTypes = this.selectOptimalCaches(size, ttl, priority);
    } else if (strategy === 'all') {
      cacheTypes = ['memory', 'session', 'local', 'indexed'];
    } else {
      cacheTypes = [strategy];
    }

    // Store in selected caches
    for (const cacheType of cacheTypes) {
      const cache = this.caches.get(cacheType);
      if (cache) {
        await cache.set(key, data, { ttl, priority });
      }
    }
  }

  /**
   * Delete data from all caches
   * @param {string} key - Cache key
   */
  async delete(key) {
    for (const cache of this.caches.values()) {
      await cache.delete(key);
    }
  }

  /**
   * Clear specific cache or all caches
   * @param {string} cacheType - Cache type to clear, or 'all'
   */
  async clear(cacheType = 'all') {
    if (cacheType === 'all') {
      for (const cache of this.caches.values()) {
        await cache.clear();
      }
    } else {
      const cache = this.caches.get(cacheType);
      if (cache) {
        await cache.clear();
      }
    }
  }

  /**
   * Promote data to faster caches
   */
  async promoteToFasterCaches(key, data, currentCacheType) {
    const cacheOrder = ['memory', 'session', 'local', 'indexed'];
    const currentIndex = cacheOrder.indexOf(currentCacheType);
    
    // Promote to all faster caches
    for (let i = 0; i < currentIndex; i++) {
      const cache = this.caches.get(cacheOrder[i]);
      await cache.set(key, data);
    }
  }

  /**
   * Select optimal caches based on data characteristics
   */
  selectOptimalCaches(size, ttl, priority) {
    const caches = [];

    // Always use memory cache for small, frequently accessed data
    if (size < 10000 && priority === 'high') {
      caches.push('memory');
    }

    // Use session cache for medium-term data
    if (ttl && ttl <= 30 * 60 * 1000) { // 30 minutes
      caches.push('session');
    }

    // Use local storage for persistent data
    if (ttl && ttl > 30 * 60 * 1000) {
      caches.push('local');
    }

    // Use IndexedDB for large data sets
    if (size > 50000) {
      caches.push('indexed');
    }

    // Default to session cache if no specific strategy
    if (caches.length === 0) {
      caches.push('session');
    }

    return caches;
  }

  /**
   * Estimate data size in bytes
   */
  estimateSize(data) {
    return new Blob([JSON.stringify(data)]).size;
  }

  /**
   * Clean up expired entries from all caches
   */
  async cleanupExpiredEntries() {
    let totalCleaned = 0;
    
    for (const [type, cache] of this.caches.entries()) {
      const cleaned = await cache.cleanup();
      totalCleaned += cleaned;
    }

    if (totalCleaned > 0) {
      this.cacheStats.evictions += totalCleaned;
      console.log(`🧹 Cleaned ${totalCleaned} expired cache entries`);
    }
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const hitRate = this.cacheStats.totalRequests > 0 
      ? (this.cacheStats.hits / this.cacheStats.totalRequests * 100).toFixed(2)
      : 0;

    return {
      ...this.cacheStats,
      hitRate: `${hitRate}%`,
      cacheTypes: Array.from(this.caches.keys()),
      cacheSizes: Object.fromEntries(
        Array.from(this.caches.entries()).map(([type, cache]) => [type, cache.size()])
      )
    };
  }

  /**
   * Preload critical data
   */
  async preloadCriticalData(userId) {
    const criticalData = [
      { key: `user:${userId}`, path: `users/${userId}` },
      { key: 'system:config', path: 'system/config' },
      { key: 'tournaments:active', path: 'tournaments', query: { status: 'active' } }
    ];

    for (const item of criticalData) {
      // Check if already cached
      const cached = await this.get(item.key);
      if (!cached) {
        // Would fetch from Firestore and cache
        console.log(`📋 Preloading critical data: ${item.key}`);
      }
    }
  }
}

/**
 * Memory Cache Implementation
 */
class MemoryCache {
  constructor(options = {}) {
    this.cache = new Map();
    this.maxSize = options.maxSize || 500;
    this.defaultTTL = options.ttl || 5 * 60 * 1000;
  }

  async get(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expires) {
      this.cache.delete(key);
      return null;
    }

    // Update access time for LRU
    entry.lastAccessed = Date.now();
    return entry.data;
  }

  async set(key, data, options = {}) {
    const ttl = options.ttl || this.defaultTTL;
    const entry = {
      data,
      expires: Date.now() + ttl,
      lastAccessed: Date.now(),
      priority: options.priority || 'medium'
    };

    // Evict if at capacity
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      this.evictLRU();
    }

    this.cache.set(key, entry);
  }

  async delete(key) {
    return this.cache.delete(key);
  }

  async clear() {
    this.cache.clear();
  }

  async cleanup() {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expires) {
        this.cache.delete(key);
        cleaned++;
      }
    }

    return cleaned;
  }

  size() {
    return this.cache.size;
  }

  evictLRU() {
    let oldestKey = null;
    let oldestTime = Date.now();

    for (const [key, entry] of this.cache.entries()) {
      if (entry.lastAccessed < oldestTime) {
        oldestTime = entry.lastAccessed;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
    }
  }
}

/**
 * Session Storage Cache Implementation
 */
class SessionStorageCache {
  constructor(options = {}) {
    this.prefix = 'firebase_session_';
    this.maxSize = options.maxSize || 200;
    this.defaultTTL = options.ttl || 30 * 60 * 1000;
  }

  async get(key) {
    try {
      const item = sessionStorage.getItem(this.prefix + key);
      if (!item) return null;

      const entry = JSON.parse(item);
      if (Date.now() > entry.expires) {
        sessionStorage.removeItem(this.prefix + key);
        return null;
      }

      return entry.data;
    } catch (error) {
      console.warn('Session cache get error:', error);
      return null;
    }
  }

  async set(key, data, options = {}) {
    try {
      const ttl = options.ttl || this.defaultTTL;
      const entry = {
        data,
        expires: Date.now() + ttl,
        created: Date.now()
      };

      sessionStorage.setItem(this.prefix + key, JSON.stringify(entry));
    } catch (error) {
      console.warn('Session cache set error:', error);
      // Try to free space and retry
      await this.cleanup();
      try {
        sessionStorage.setItem(this.prefix + key, JSON.stringify(entry));
      } catch (retryError) {
        console.error('Session cache retry failed:', retryError);
      }
    }
  }

  async delete(key) {
    sessionStorage.removeItem(this.prefix + key);
  }

  async clear() {
    const keys = Object.keys(sessionStorage);
    keys.forEach(key => {
      if (key.startsWith(this.prefix)) {
        sessionStorage.removeItem(key);
      }
    });
  }

  async cleanup() {
    const now = Date.now();
    let cleaned = 0;

    const keys = Object.keys(sessionStorage);
    keys.forEach(key => {
      if (key.startsWith(this.prefix)) {
        try {
          const item = sessionStorage.getItem(key);
          const entry = JSON.parse(item);
          if (now > entry.expires) {
            sessionStorage.removeItem(key);
            cleaned++;
          }
        } catch (error) {
          // Remove corrupted entries
          sessionStorage.removeItem(key);
          cleaned++;
        }
      }
    });

    return cleaned;
  }

  size() {
    return Object.keys(sessionStorage).filter(key => 
      key.startsWith(this.prefix)
    ).length;
  }
}

/**
 * Local Storage Cache Implementation
 */
class LocalStorageCache {
  constructor(options = {}) {
    this.prefix = 'firebase_cache_';
    this.maxSize = options.maxSize || 100;
    this.defaultTTL = options.ttl || 24 * 60 * 60 * 1000;
  }

  async get(key) {
    try {
      const item = localStorage.getItem(this.prefix + key);
      if (!item) return null;

      const entry = JSON.parse(item);
      if (Date.now() > entry.expires) {
        localStorage.removeItem(this.prefix + key);
        return null;
      }

      return entry.data;
    } catch (error) {
      console.warn('Local cache get error:', error);
      return null;
    }
  }

  async set(key, data, options = {}) {
    try {
      const ttl = options.ttl || this.defaultTTL;
      const entry = {
        data,
        expires: Date.now() + ttl,
        created: Date.now()
      };

      localStorage.setItem(this.prefix + key, JSON.stringify(entry));
    } catch (error) {
      console.warn('Local cache set error:', error);
      await this.cleanup();
    }
  }

  async delete(key) {
    localStorage.removeItem(this.prefix + key);
  }

  async clear() {
    const keys = Object.keys(localStorage);
    keys.forEach(key => {
      if (key.startsWith(this.prefix)) {
        localStorage.removeItem(key);
      }
    });
  }

  async cleanup() {
    const now = Date.now();
    let cleaned = 0;

    const keys = Object.keys(localStorage);
    keys.forEach(key => {
      if (key.startsWith(this.prefix)) {
        try {
          const item = localStorage.getItem(key);
          const entry = JSON.parse(item);
          if (now > entry.expires) {
            localStorage.removeItem(key);
            cleaned++;
          }
        } catch (error) {
          localStorage.removeItem(key);
          cleaned++;
        }
      }
    });

    return cleaned;
  }

  size() {
    return Object.keys(localStorage).filter(key => 
      key.startsWith(this.prefix)
    ).length;
  }
}

/**
 * IndexedDB Cache Implementation (for large data sets)
 */
class IndexedDBCache {
  constructor(options = {}) {
    this.dbName = 'FirebaseCache';
    this.storeName = 'cache';
    this.version = 1;
    this.maxSize = options.maxSize || 1000;
    this.defaultTTL = options.ttl || 7 * 24 * 60 * 60 * 1000;
    this.db = null;
    
    this.initDB();
  }

  async initDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };
      
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { keyPath: 'key' });
          store.createIndex('expires', 'expires', { unique: false });
        }
      };
    });
  }

  async get(key) {
    if (!this.db) await this.initDB();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.get(key);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const entry = request.result;
        if (!entry || Date.now() > entry.expires) {
          if (entry) this.delete(key); // Clean up expired entry
          resolve(null);
        } else {
          resolve(entry.data);
        }
      };
    });
  }

  async set(key, data, options = {}) {
    if (!this.db) await this.initDB();
    
    const ttl = options.ttl || this.defaultTTL;
    const entry = {
      key,
      data,
      expires: Date.now() + ttl,
      created: Date.now()
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.put(entry);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async delete(key) {
    if (!this.db) await this.initDB();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.delete(key);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async clear() {
    if (!this.db) await this.initDB();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.clear();
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async cleanup() {
    if (!this.db) await this.initDB();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const index = store.index('expires');
      const range = IDBKeyRange.upperBound(Date.now());
      const request = index.openCursor(range);
      
      let cleaned = 0;
      
      request.onerror = () => reject(request.error);
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          cursor.delete();
          cleaned++;
          cursor.continue();
        } else {
          resolve(cleaned);
        }
      };
    });
  }

  async size() {
    if (!this.db) await this.initDB();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.count();
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }
}

// Create and export singleton instance
const cacheManager = new CacheManager();
export default cacheManager;