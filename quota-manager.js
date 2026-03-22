// Firebase Quota Management and Monitoring System
// Comprehensive quota tracking, caching strategies, and fallback mechanisms

import { quotaManager } from './firebase-config.js';

class QuotaManagementSystem {
  constructor() {
    this.quotaManager = quotaManager;
    this.cacheStrategies = new Map();
    this.fallbackMechanisms = new Map();
    this.alertThresholds = {
      warning: 80,  // 80% threshold
      critical: 90, // 90% threshold
      emergency: 95 // 95% threshold
    };

    this.setupCacheStrategies();
    this.setupFallbackMechanisms();
    this.startMonitoring();
  }

  /**
   * Setup client-side caching strategies
   */
  setupCacheStrategies() {
    // User profile caching - long duration
    this.cacheStrategies.set('userProfiles', {
      duration: 30 * 60 * 1000, // 30 minutes
      maxSize: 100,
      priority: 'high'
    });

    // Tournament data caching - medium duration
    this.cacheStrategies.set('tournaments', {
      duration: 10 * 60 * 1000, // 10 minutes
      maxSize: 50,
      priority: 'medium'
    });

    // Leaderboard caching - short duration
    this.cacheStrategies.set('leaderboards', {
      duration: 5 * 60 * 1000, // 5 minutes
      maxSize: 10,
      priority: 'medium'
    });

    // Transaction history caching - medium duration
    this.cacheStrategies.set('transactions', {
      duration: 15 * 60 * 1000, // 15 minutes
      maxSize: 200,
      priority: 'low'
    });

    // System configuration caching - long duration
    this.cacheStrategies.set('systemConfig', {
      duration: 60 * 60 * 1000, // 1 hour
      maxSize: 5,
      priority: 'high'
    });
  }

  /**
   * Setup fallback mechanisms for quota exceeded scenarios
   */
  setupFallbackMechanisms() {
    // Read quota exceeded fallback
    this.fallbackMechanisms.set('readQuotaExceeded', {
      strategy: 'cacheOnly',
      message: 'Using cached data due to daily read limit',
      action: this.enableCacheOnlyMode.bind(this)
    });

    // Write quota exceeded fallback
    this.fallbackMechanisms.set('writeQuotaExceeded', {
      strategy: 'queueWrites',
      message: 'Queuing writes for tomorrow due to daily write limit',
      action: this.enableWriteQueueMode.bind(this)
    });

    // Delete quota exceeded fallback
    this.fallbackMechanisms.set('deleteQuotaExceeded', {
      strategy: 'queueDeletes',
      message: 'Queuing deletes for tomorrow due to daily delete limit',
      action: this.enableDeleteQueueMode.bind(this)
    });

    // Network failure fallback
    this.fallbackMechanisms.set('networkFailure', {
      strategy: 'offlineMode',
      message: 'Working offline - changes will sync when connection is restored',
      action: this.enableOfflineMode.bind(this)
    });
  }

  /**
   * Start quota monitoring
   */
  startMonitoring() {
    // Check quota status every 5 minutes
    setInterval(() => {
      this.checkQuotaStatus();
    }, 5 * 60 * 1000);

    // Initial check
    this.checkQuotaStatus();
  }

  /**
   * Check current quota status and trigger alerts
   */
  checkQuotaStatus() {
    const status = this.quotaManager.getQuotaStatus();

    Object.entries(status).forEach(([type, data]) => {
      const percentage = data.percentage;

      if (percentage >= this.alertThresholds.emergency) {
        this.handleEmergencyThreshold(type, data);
      } else if (percentage >= this.alertThresholds.critical) {
        this.handleCriticalThreshold(type, data);
      } else if (percentage >= this.alertThresholds.warning) {
        this.handleWarningThreshold(type, data);
      }
    });
  }

  /**
   * Handle warning threshold (80%)
   */
  handleWarningThreshold(type, data) {
    console.warn(`⚠️ Firebase ${type} quota at ${data.percentage.toFixed(1)}%`);

    // Show user notification
    this.showQuotaAlert('warning', type, data.percentage);

    // Enable aggressive caching
    this.enableAggressiveCaching(type);
  }

  /**
   * Handle critical threshold (90%)
   */
  handleCriticalThreshold(type, data) {
    console.error(`🚨 Firebase ${type} quota at ${data.percentage.toFixed(1)}%`);

    // Show critical alert
    this.showQuotaAlert('critical', type, data.percentage);

    // Reduce non-essential operations
    this.reduceNonEssentialOperations(type);

    // Enable maximum caching
    this.enableMaximumCaching(type);
  }

  /**
   * Handle emergency threshold (95%)
   */
  handleEmergencyThreshold(type, data) {
    console.error(`🆘 Firebase ${type} quota at ${data.percentage.toFixed(1)}%`);

    // Show emergency alert
    this.showQuotaAlert('emergency', type, data.percentage);

    // Enable fallback mechanisms
    this.enableFallbackMechanism(type);
  }

  /**
   * Show quota alert to user
   */
  showQuotaAlert(level, type, percentage) {
    const messages = {
      warning: `Firebase ${type} usage at ${percentage.toFixed(0)}%. Optimizing performance...`,
      critical: `Firebase ${type} usage at ${percentage.toFixed(0)}%. Limited functionality may occur.`,
      emergency: `Firebase ${type} quota nearly exhausted. Using cached data only.`
    };

    const alertTypes = {
      warning: 'warning',
      critical: 'error',
      emergency: 'error'
    };

    if (window.showToast) {
      window.showToast(messages[level], alertTypes[level]);
    }

    // Also show in console for debugging
    console.log(`📊 Quota Alert [${level.toUpperCase()}]: ${messages[level]}`);
  }

  /**
   * Enable aggressive caching for specific operation type
   */
  enableAggressiveCaching(operationType) {
    // Increase cache durations by 50%
    this.cacheStrategies.forEach((strategy, key) => {
      strategy.duration = Math.floor(strategy.duration * 1.5);
    });

    console.log(`📋 Aggressive caching enabled for ${operationType}`);
  }

  /**
   * Enable maximum caching
   */
  enableMaximumCaching(operationType) {
    // Double cache durations and increase sizes
    this.cacheStrategies.forEach((strategy, key) => {
      strategy.duration = strategy.duration * 2;
      strategy.maxSize = Math.floor(strategy.maxSize * 1.5);
    });

    console.log(`📋 Maximum caching enabled for ${operationType}`);
  }

  /**
   * Reduce non-essential operations
   */
  reduceNonEssentialOperations(operationType) {
    // Disable real-time listeners for non-critical data
    if (operationType === 'reads') {
      this.disableNonEssentialListeners();
    }

    // Batch writes more aggressively
    if (operationType === 'writes') {
      this.enableAggressiveBatching();
    }

    console.log(`🔧 Non-essential operations reduced for ${operationType}`);
  }

  /**
   * Enable fallback mechanism
   */
  enableFallbackMechanism(operationType) {
    const fallbackKey = `${operationType}QuotaExceeded`;
    const fallback = this.fallbackMechanisms.get(fallbackKey);

    if (fallback) {
      console.log(`🔄 Enabling fallback: ${fallback.strategy}`);
      fallback.action();

      if (window.showToast) {
        window.showToast(fallback.message, 'info');
      }
    }
  }

  /**
   * Enable cache-only mode
   */
  enableCacheOnlyMode() {
    window.FIREBASE_CACHE_ONLY_MODE = true;
    console.log('📋 Cache-only mode enabled');

    // Notify all components to use cache only
    window.dispatchEvent(new CustomEvent('quotaExceeded', {
      detail: { type: 'reads', mode: 'cacheOnly' }
    }));
  }

  /**
   * Enable write queue mode
   */
  enableWriteQueueMode() {
    window.FIREBASE_WRITE_QUEUE_MODE = true;
    console.log('📝 Write queue mode enabled');

    // Initialize write queue if not exists
    if (!window.FIREBASE_WRITE_QUEUE) {
      window.FIREBASE_WRITE_QUEUE = [];
    }

    window.dispatchEvent(new CustomEvent('quotaExceeded', {
      detail: { type: 'writes', mode: 'queue' }
    }));
  }

  /**
   * Enable delete queue mode
   */
  enableDeleteQueueMode() {
    window.FIREBASE_DELETE_QUEUE_MODE = true;
    console.log('🗑️ Delete queue mode enabled');

    // Initialize delete queue if not exists
    if (!window.FIREBASE_DELETE_QUEUE) {
      window.FIREBASE_DELETE_QUEUE = [];
    }

    window.dispatchEvent(new CustomEvent('quotaExceeded', {
      detail: { type: 'deletes', mode: 'queue' }
    }));
  }

  /**
   * Enable offline mode
   */
  enableOfflineMode() {
    window.FIREBASE_OFFLINE_MODE = true;
    console.log('📴 Offline mode enabled');

    window.dispatchEvent(new CustomEvent('networkFailure', {
      detail: { mode: 'offline' }
    }));
  }

  /**
   * Disable non-essential real-time listeners
   */
  disableNonEssentialListeners() {
    // This would be implemented by components listening to this event
    window.dispatchEvent(new CustomEvent('disableNonEssentialListeners'));
    console.log('👂 Non-essential listeners disabled');
  }

  /**
   * Enable aggressive batching
   */
  enableAggressiveBatching() {
    window.FIREBASE_AGGRESSIVE_BATCHING = true;
    window.FIREBASE_BATCH_SIZE = 50; // Increase batch size
    window.FIREBASE_BATCH_TIMEOUT = 1000; // Reduce batch timeout

    window.dispatchEvent(new CustomEvent('enableAggressiveBatching'));
    console.log('📦 Aggressive batching enabled');
  }

  /**
   * Get optimization recommendations
   */
  getOptimizationRecommendations() {
    const status = this.quotaManager.getQuotaStatus();
    const recommendations = [];

    Object.entries(status).forEach(([type, data]) => {
      if (data.percentage > 70) {
        switch (type) {
          case 'reads':
            recommendations.push({
              type: 'reads',
              priority: 'high',
              action: 'Enable longer caching for user profiles and static data',
              impact: 'Reduce reads by 30-50%'
            });
            recommendations.push({
              type: 'reads',
              priority: 'medium',
              action: 'Disable real-time listeners for non-critical data',
              impact: 'Reduce reads by 20-40%'
            });
            break;

          case 'writes':
            recommendations.push({
              type: 'writes',
              priority: 'high',
              action: 'Batch write operations more aggressively',
              impact: 'Reduce writes by 40-60%'
            });
            recommendations.push({
              type: 'writes',
              priority: 'medium',
              action: 'Queue non-critical updates for off-peak hours',
              impact: 'Spread write load over time'
            });
            break;

          case 'deletes':
            recommendations.push({
              type: 'deletes',
              priority: 'high',
              action: 'Batch delete operations',
              impact: 'Reduce delete operations by 50%'
            });
            break;
        }
      }
    });

    return recommendations;
  }

  generateUsageReport() {
    if (!this.quotaManager) {
      return {
        timestamp: new Date().toISOString(),
        quotaStatus: {
          reads: { used: 0, limit: 1000, percentage: 0 },
          writes: { used: 0, limit: 1000, percentage: 0 },
          deletes: { used: 0, limit: 1000, percentage: 0 }
        },
        cacheStats: { totalStrategies: 0 },
        recommendations: [],
        fallbacksActive: {},
        optimizationLevel: 'normal'
      };
    }
    const status = this.quotaManager.getQuotaStatus();
    const recommendations = this.getOptimizationRecommendations();

    return {
      timestamp: new Date().toISOString(),
      quotaStatus: status,
      cacheStats: this.getCacheStats(),
      recommendations: recommendations,
      fallbacksActive: this.getActiveFallbacks(),
      optimizationLevel: this.getCurrentOptimizationLevel()
    };
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return {
      strategies: Object.fromEntries(this.cacheStrategies),
      totalStrategies: this.cacheStrategies.size,
      averageCacheDuration: this.getAverageCacheDuration()
    };
  }

  /**
   * Get active fallback mechanisms
   */
  getActiveFallbacks() {
    return {
      cacheOnlyMode: !!window.FIREBASE_CACHE_ONLY_MODE,
      writeQueueMode: !!window.FIREBASE_WRITE_QUEUE_MODE,
      deleteQueueMode: !!window.FIREBASE_DELETE_QUEUE_MODE,
      offlineMode: !!window.FIREBASE_OFFLINE_MODE,
      aggressiveBatching: !!window.FIREBASE_AGGRESSIVE_BATCHING
    };
  }

  /**
   * Get current optimization level
   */
  getCurrentOptimizationLevel() {
    const status = this.quotaManager.getQuotaStatus();
    const maxPercentage = Math.max(
      status.reads.percentage,
      status.writes.percentage,
      status.deletes.percentage
    );

    if (maxPercentage >= 95) return 'emergency';
    if (maxPercentage >= 90) return 'critical';
    if (maxPercentage >= 80) return 'warning';
    return 'normal';
  }

  /**
   * Get average cache duration
   */
  getAverageCacheDuration() {
    const durations = Array.from(this.cacheStrategies.values()).map(s => s.duration);
    return durations.reduce((sum, duration) => sum + duration, 0) / durations.length;
  }

  /**
   * Reset quota counters (for testing)
   */
  resetQuotas() {
    this.quotaManager.resetDailyQuotas();
    console.log('📊 Quotas reset for testing');
  }

  /**
   * Simulate quota usage (for testing)
   */
  simulateUsage(type, count) {
    switch (type) {
      case 'reads':
        this.quotaManager.trackRead(count);
        break;
      case 'writes':
        this.quotaManager.trackWrite(count);
        break;
      case 'deletes':
        this.quotaManager.trackDelete(count);
        break;
    }
    console.log(`📊 Simulated ${count} ${type} operations`);
  }
}

// Create and export singleton instance
const quotaManagementSystem = new QuotaManagementSystem();

// Export for global access
window.quotaManagementSystem = quotaManagementSystem;

export default quotaManagementSystem;