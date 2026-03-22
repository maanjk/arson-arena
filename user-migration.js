// User Profile Data Migration Utilities
// Converts localStorage user data to Firestore schema with validation and backup

import authManager from './auth-manager.js';
import databaseManager from './database-manager.js';
import { quotaManager } from './firebase-config.js';

class UserMigrationManager {
  constructor() {
    this.backupData = new Map();
    this.migrationLog = [];
    this.validationRules = this.setupValidationRules();
  }

  /**
   * Setup validation rules for user data
   * @returns {Object} Validation rules
   */
  setupValidationRules() {
    return {
      username: {
        required: true,
        type: 'string',
        minLength: 3,
        maxLength: 20,
        pattern: /^[a-zA-Z0-9_-]+$/,
        message: 'Username must be 3-20 characters, alphanumeric with _ or -'
      },
      coins: {
        required: true,
        type: 'number',
        min: 0,
        max: 1000000,
        message: 'Coins must be between 0 and 1,000,000'
      },
      xp: {
        required: true,
        type: 'number',
        min: 0,
        max: 10000000,
        message: 'XP must be between 0 and 10,000,000'
      },
      level: {
        required: true,
        type: 'number',
        min: 1,
        max: 100,
        message: 'Level must be between 1 and 100'
      },
      avatar: {
        required: false,
        type: 'string',
        maxLength: 50,
        message: 'Avatar must be a valid string'
      },
      gameUids: {
        required: false,
        type: 'object',
        properties: {
          pubg: { type: 'string', maxLength: 20 },
          freefire: { type: 'string', maxLength: 20 }
        },
        message: 'Game UIDs must be valid strings'
      },
      referralCode: {
        required: false,
        type: 'string',
        pattern: /^[A-Z0-9]{6,10}$/,
        message: 'Referral code must be 6-10 uppercase alphanumeric characters'
      }
    };
  }

  /**
   * Get localStorage user data
   * @returns {Array} Array of user objects from localStorage
   */
  getLocalStorageUsers() {
    try {
      const users = JSON.parse(localStorage.getItem('battlesaas_users') || '[]');
      console.log(`📋 Found ${users.length} users in localStorage`);
      return users;
    } catch (error) {
      console.error('❌ Failed to parse localStorage users:', error);
      return [];
    }
  }

  /**
   * Get current user state from localStorage
   * @returns {Object|null} Current user state
   */
  getCurrentUserState() {
    try {
      // Check if there's a logged-in user state
      const userState = JSON.parse(localStorage.getItem('battlesaas_current_user') || 'null');
      return userState;
    } catch (error) {
      console.warn('⚠️ No current user state found in localStorage');
      return null;
    }
  }

  /**
   * Validate user data against schema
   * @param {Object} userData - User data to validate
   * @returns {Object} Validation result
   */
  validateUserData(userData) {
    const errors = [];
    const warnings = [];

    for (const [field, rules] of Object.entries(this.validationRules)) {
      const value = userData[field];

      // Check required fields
      if (rules.required && (value === undefined || value === null || value === '')) {
        errors.push(`${field} is required`);
        continue;
      }

      // Skip validation if field is not present and not required
      if (value === undefined || value === null) continue;

      // Type validation
      if (rules.type === 'string' && typeof value !== 'string') {
        errors.push(`${field} must be a string`);
        continue;
      }

      if (rules.type === 'number' && typeof value !== 'number') {
        errors.push(`${field} must be a number`);
        continue;
      }

      if (rules.type === 'object' && typeof value !== 'object') {
        errors.push(`${field} must be an object`);
        continue;
      }

      // String validations
      if (rules.type === 'string' && typeof value === 'string') {
        if (rules.minLength && value.length < rules.minLength) {
          errors.push(`${field} must be at least ${rules.minLength} characters`);
        }
        if (rules.maxLength && value.length > rules.maxLength) {
          errors.push(`${field} must be at most ${rules.maxLength} characters`);
        }
        if (rules.pattern && !rules.pattern.test(value)) {
          errors.push(rules.message || `${field} format is invalid`);
        }
      }

      // Number validations
      if (rules.type === 'number' && typeof value === 'number') {
        if (rules.min !== undefined && value < rules.min) {
          errors.push(`${field} must be at least ${rules.min}`);
        }
        if (rules.max !== undefined && value > rules.max) {
          errors.push(`${field} must be at most ${rules.max}`);
        }
      }

      // Object property validations
      if (rules.type === 'object' && rules.properties) {
        for (const [prop, propRules] of Object.entries(rules.properties)) {
          const propValue = value[prop];
          if (propValue !== undefined && propValue !== null && propValue !== '') {
            if (propRules.type === 'string' && typeof propValue !== 'string') {
              warnings.push(`${field}.${prop} should be a string`);
            }
            if (propRules.maxLength && propValue.length > propRules.maxLength) {
              warnings.push(`${field}.${prop} should be at most ${propRules.maxLength} characters`);
            }
          }
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Sanitize user data for Firestore
   * @param {Object} userData - Raw user data
   * @returns {Object} Sanitized user data
   */
  sanitizeUserData(userData) {
    const sanitized = {
      // Required fields with defaults
      username: (userData.name || userData.username || '').toString().trim(),
      coins: Math.max(0, Math.min(1000000, parseInt(userData.coins) || 0)),
      xp: Math.max(0, Math.min(10000000, parseInt(userData.xp) || 0)),
      level: Math.max(1, Math.min(100, parseInt(userData.level) || 1)),
      
      // Optional fields
      avatar: (userData.avatar || 'default').toString().trim(),
      
      // Game UIDs - normalize the structure
      gameUids: {
        pubg: (userData.uids?.pubg || userData.gameUids?.pubg || '').toString().trim().toUpperCase(),
        freefire: (userData.uids?.ff || userData.uids?.freefire || userData.gameUids?.freefire || '').toString().trim().toUpperCase()
      },
      
      // Referral code - generate if missing
      referralCode: userData.refCode || userData.referralCode || this.generateReferralCode(userData.name || userData.username),
      referredBy: userData.referredBy || null,
      
      // Admin status
      isAdmin: Boolean(userData.isAdmin || false),
      
      // Email verification status
      emailVerified: false,
      
      // Timestamps
      createdAt: userData.createdAt || new Date(),
      lastActive: userData.lastLogin ? new Date(userData.lastLogin) : new Date()
    };

    // Clean up empty strings
    Object.keys(sanitized).forEach(key => {
      if (sanitized[key] === '') {
        sanitized[key] = null;
      }
    });

    return sanitized;
  }

  /**
   * Generate referral code from username
   * @param {string} username - Username
   * @returns {string} Referral code
   */
  generateReferralCode(username) {
    if (!username) return 'USER' + Math.random().toString(36).substring(2, 8).toUpperCase();
    
    const prefix = username.substring(0, 3).toUpperCase();
    const suffix = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `${prefix}${suffix}`;
  }

  /**
   * Create backup of localStorage data
   * @returns {Object} Backup data
   */
  createBackup() {
    try {
      const backup = {
        timestamp: new Date().toISOString(),
        users: this.getLocalStorageUsers(),
        currentUser: this.getCurrentUserState(),
        tournaments: JSON.parse(localStorage.getItem('battlesaas_tournaments') || '[]'),
        referralRequests: JSON.parse(localStorage.getItem('battlesaas_referral_requests') || '[]')
      };

      // Store backup in memory and localStorage
      const backupKey = `migration_backup_${Date.now()}`;
      this.backupData.set(backupKey, backup);
      localStorage.setItem(backupKey, JSON.stringify(backup));

      console.log(`✅ Backup created: ${backupKey}`);
      return { backupKey, backup };
    } catch (error) {
      console.error('❌ Failed to create backup:', error);
      throw new Error('Backup creation failed');
    }
  }

  /**
   * Restore from backup
   * @param {string} backupKey - Backup key
   * @returns {Promise<void>}
   */
  async restoreFromBackup(backupKey) {
    try {
      let backup = this.backupData.get(backupKey);
      
      if (!backup) {
        const backupData = localStorage.getItem(backupKey);
        if (!backupData) {
          throw new Error('Backup not found');
        }
        backup = JSON.parse(backupData);
      }

      // Restore localStorage data
      localStorage.setItem('battlesaas_users', JSON.stringify(backup.users));
      localStorage.setItem('battlesaas_tournaments', JSON.stringify(backup.tournaments));
      localStorage.setItem('battlesaas_referral_requests', JSON.stringify(backup.referralRequests));
      
      if (backup.currentUser) {
        localStorage.setItem('battlesaas_current_user', JSON.stringify(backup.currentUser));
      }

      console.log(`✅ Restored from backup: ${backupKey}`);
    } catch (error) {
      console.error('❌ Failed to restore from backup:', error);
      throw error;
    }
  }

  /**
   * Migrate single user to Firestore
   * @param {Object} localUser - Local user data
   * @param {string} uid - Firebase Auth UID
   * @returns {Promise<Object>} Migration result
   */
  async migrateSingleUser(localUser, uid) {
    const migrationResult = {
      success: false,
      uid,
      username: localUser.name || localUser.username,
      errors: [],
      warnings: []
    };

    try {
      // Sanitize data
      const sanitizedData = this.sanitizeUserData(localUser);
      
      // Validate data
      const validation = this.validateUserData(sanitizedData);
      migrationResult.warnings = validation.warnings;

      if (!validation.isValid) {
        migrationResult.errors = validation.errors;
        console.error(`❌ Validation failed for user ${sanitizedData.username}:`, validation.errors);
        return migrationResult;
      }

      // Check if user already exists in Firestore
      const existingUser = await databaseManager.getUser(uid);
      if (existingUser) {
        console.log(`⚠️ User ${sanitizedData.username} already exists in Firestore`);
        migrationResult.warnings.push('User already exists in Firestore');
        migrationResult.success = true;
        return migrationResult;
      }

      // Create user in Firestore
      await databaseManager.createUser(uid, {
        uid,
        email: `${sanitizedData.username.toLowerCase()}@temp.local`, // Temporary email
        ...sanitizedData
      });

      migrationResult.success = true;
      console.log(`✅ User ${sanitizedData.username} migrated successfully`);

    } catch (error) {
      console.error(`❌ Failed to migrate user ${localUser.name}:`, error);
      migrationResult.errors.push(error.message);
    }

    return migrationResult;
  }

  /**
   * Migrate all users from localStorage to Firestore
   * @param {boolean} dryRun - Perform validation only without actual migration
   * @returns {Promise<Object>} Migration summary
   */
  async migrateAllUsers(dryRun = false) {
    const summary = {
      total: 0,
      successful: 0,
      failed: 0,
      skipped: 0,
      results: [],
      backupKey: null
    };

    try {
      // Create backup before migration
      if (!dryRun) {
        const backup = this.createBackup();
        summary.backupKey = backup.backupKey;
      }

      // Get localStorage users
      const localUsers = this.getLocalStorageUsers();
      summary.total = localUsers.length;

      if (localUsers.length === 0) {
        console.log('📋 No users found in localStorage');
        return summary;
      }

      console.log(`🚀 Starting ${dryRun ? 'validation' : 'migration'} of ${localUsers.length} users`);

      // Process each user
      for (const localUser of localUsers) {
        try {
          // Generate temporary UID for validation
          const tempUid = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          
          if (dryRun) {
            // Validation only
            const sanitizedData = this.sanitizeUserData(localUser);
            const validation = this.validateUserData(sanitizedData);
            
            const result = {
              username: localUser.name || localUser.username,
              valid: validation.isValid,
              errors: validation.errors,
              warnings: validation.warnings,
              sanitizedData: sanitizedData
            };
            
            summary.results.push(result);
            
            if (validation.isValid) {
              summary.successful++;
            } else {
              summary.failed++;
            }
          } else {
            // Actual migration
            const result = await this.migrateSingleUser(localUser, tempUid);
            summary.results.push(result);
            
            if (result.success) {
              summary.successful++;
            } else {
              summary.failed++;
            }
          }

        } catch (error) {
          console.error(`❌ Error processing user ${localUser.name}:`, error);
          summary.failed++;
          summary.results.push({
            username: localUser.name || 'Unknown',
            success: false,
            errors: [error.message]
          });
        }
      }

      // Log summary
      console.log(`📊 ${dryRun ? 'Validation' : 'Migration'} Summary:`, {
        total: summary.total,
        successful: summary.successful,
        failed: summary.failed,
        skipped: summary.skipped
      });

      return summary;

    } catch (error) {
      console.error(`❌ ${dryRun ? 'Validation' : 'Migration'} failed:`, error);
      throw error;
    }
  }

  /**
   * Migrate current logged-in user
   * @returns {Promise<Object>} Migration result
   */
  async migrateCurrentUser() {
    try {
      const currentUser = authManager.getCurrentUser();
      if (!currentUser) {
        throw new Error('No authenticated user found');
      }

      const currentUserState = this.getCurrentUserState();
      if (!currentUserState) {
        throw new Error('No current user state found in localStorage');
      }

      console.log(`🚀 Migrating current user: ${currentUserState.name}`);
      
      const result = await this.migrateSingleUser(currentUserState, currentUser.uid);
      
      if (result.success) {
        console.log('✅ Current user migrated successfully');
        
        // Update localStorage to mark as migrated
        currentUserState.migrated = true;
        currentUserState.migratedAt = new Date().toISOString();
        localStorage.setItem('battlesaas_current_user', JSON.stringify(currentUserState));
      }

      return result;

    } catch (error) {
      console.error('❌ Current user migration failed:', error);
      throw error;
    }
  }

  /**
   * Check migration status
   * @returns {Object} Migration status
   */
  getMigrationStatus() {
    const localUsers = this.getLocalStorageUsers();
    const currentUser = this.getCurrentUserState();
    
    return {
      hasLocalData: localUsers.length > 0,
      totalLocalUsers: localUsers.length,
      currentUserMigrated: currentUser?.migrated || false,
      lastMigration: currentUser?.migratedAt || null,
      backups: this.getAvailableBackups()
    };
  }

  /**
   * Get available backups
   * @returns {Array} Available backup keys
   */
  getAvailableBackups() {
    const backups = [];
    
    // Check localStorage for backup keys
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('migration_backup_')) {
        try {
          const backup = JSON.parse(localStorage.getItem(key));
          backups.push({
            key,
            timestamp: backup.timestamp,
            userCount: backup.users?.length || 0
          });
        } catch (error) {
          console.warn(`Invalid backup found: ${key}`);
        }
      }
    }

    return backups.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }

  /**
   * Clean up old backups
   * @param {number} keepCount - Number of backups to keep
   */
  cleanupBackups(keepCount = 5) {
    const backups = this.getAvailableBackups();
    
    if (backups.length <= keepCount) {
      return;
    }

    const toDelete = backups.slice(keepCount);
    let deleted = 0;

    toDelete.forEach(backup => {
      try {
        localStorage.removeItem(backup.key);
        this.backupData.delete(backup.key);
        deleted++;
      } catch (error) {
        console.warn(`Failed to delete backup ${backup.key}:`, error);
      }
    });

    console.log(`🧹 Cleaned up ${deleted} old backups`);
  }

  /**
   * Get migration logs
   * @returns {Array} Migration logs
   */
  getMigrationLogs() {
    return [...this.migrationLog];
  }

  /**
   * Clear migration logs
   */
  clearMigrationLogs() {
    this.migrationLog = [];
  }
}

// Create and export singleton instance
const userMigrationManager = new UserMigrationManager();
export default userMigrationManager;