// Transaction Data Migration Utilities
// Converts localStorage transaction data to Firestore schema with atomic operations and audit trail

import databaseManager from './database-manager.js';
import { quotaManager } from './firebase-config.js';
import { serverTimestamp, runTransaction, doc } from 'firebase/firestore';
import { db } from './firebase-config.js';

class TransactionMigrationManager {
  constructor() {
    this.backupData = new Map();
    this.migrationLog = [];
    this.validationRules = this.setupValidationRules();
    this.transactionTypes = this.setupTransactionTypes();
    this.statusMapping = this.setupStatusMapping();
  }

  /**
   * Setup validation rules for transaction data
   * @returns {Object} Validation rules
   */
  setupValidationRules() {
    return {
      userId: {
        required: true,
        type: 'string',
        minLength: 1,
        message: 'User ID is required'
      },
      type: {
        required: true,
        type: 'string',
        enum: ['deposit', 'withdrawal', 'tournament_fee', 'prize', 'referral', 'bonus', 'refund', 'fee', 'win', 'add', 'withdraw'],
        message: 'Type must be a valid transaction type'
      },
      amount: {
        required: true,
        type: 'number',
        min: 0,
        max: 1000000,
        message: 'Amount must be between 0 and 1,000,000'
      },
      status: {
        required: true,
        type: 'string',
        enum: ['pending', 'completed', 'failed', 'cancelled'],
        message: 'Status must be pending, completed, failed, or cancelled'
      },
      method: {
        required: false,
        type: 'string',
        enum: ['easypaisa', 'jazzcash', 'bank', 'system', 'other'],
        message: 'Method must be a valid payment method'
      },
      details: {
        required: false,
        type: 'object',
        message: 'Details must be an object'
      }
    };
  }

  /**
   * Setup transaction types mapping
   * @returns {Object} Transaction types
   */
  setupTransactionTypes() {
    return {
      // Deposit types
      'deposit': 'deposit',
      'add': 'deposit',
      'credit': 'deposit',
      'top_up': 'deposit',

      // Withdrawal types
      'withdraw': 'withdrawal',
      'withdrawal': 'withdrawal',
      'payout': 'withdrawal',
      'cash_out': 'withdrawal',

      // Tournament types
      'tournament': 'tournament_fee',
      'tournament_fee': 'tournament_fee',
      'entry': 'tournament_fee',
      'join': 'tournament_fee',

      // Prize types
      'prize': 'prize',
      'win': 'prize',
      'victory': 'prize',
      'reward': 'prize',

      // Bonus types
      'bonus': 'bonus',
      'welcome': 'bonus',
      'daily': 'bonus',
      'login': 'bonus',
      'referral': 'referral',

      // System types
      'refund': 'refund',
      'adjustment': 'refund'
    };
  }

  /**
   * Setup status mapping
   * @returns {Object} Status mapping
   */
  setupStatusMapping() {
    return {
      'pending': 'pending',
      'processing': 'pending',
      'awaiting': 'pending',
      'waiting': 'pending',

      'completed': 'completed',
      'approved': 'completed',
      'success': 'completed',
      'done': 'completed',
      'confirmed': 'completed',

      'failed': 'failed',
      'rejected': 'failed',
      'error': 'failed',
      'declined': 'failed',

      'cancelled': 'cancelled',
      'canceled': 'cancelled',
      'revoked': 'cancelled'
    };
  }

  /**
   * Get localStorage transaction data
   * @returns {Object} Transaction data from localStorage
   */
  getLocalStorageTransactions() {
    try {
      const data = {
        userTransactions: [],
        adminTransactions: [],
        referralRequests: []
      };

      // Get user transactions from user profiles
      const users = JSON.parse(localStorage.getItem('battlesaas_users') || '[]');
      users.forEach(user => {
        if (user.transactions && Array.isArray(user.transactions)) {
          user.transactions.forEach(tx => {
            data.userTransactions.push({
              ...tx,
              userId: user.name, // Will be mapped to actual UID later
              username: user.name
            });
          });
        }
      });

      // Get admin transactions (deposits/withdrawals)
      const adminTx = JSON.parse(localStorage.getItem('battlesaas_admin_transactions') || '[]');
      data.adminTransactions = adminTx;

      // Get referral requests
      const referrals = JSON.parse(localStorage.getItem('battlesaas_referral_requests') || '[]');
      data.referralRequests = referrals;

      console.log(`📋 Found transaction data:`, {
        userTransactions: data.userTransactions.length,
        adminTransactions: data.adminTransactions.length,
        referralRequests: data.referralRequests.length
      });

      return data;
    } catch (error) {
      console.error('❌ Failed to parse localStorage transactions:', error);
      return { userTransactions: [], adminTransactions: [], referralRequests: [] };
    }
  }

  /**
   * Validate transaction data against schema
   * @param {Object} transactionData - Transaction data to validate
   * @returns {Object} Validation result
   */
  validateTransactionData(transactionData) {
    const errors = [];
    const warnings = [];

    for (const [field, rules] of Object.entries(this.validationRules)) {
      const value = transactionData[field];

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
        if (rules.enum && !rules.enum.includes(value)) {
          errors.push(`${field} must be one of: ${rules.enum.join(', ')}`);
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
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Parse transaction description to determine type and amount
   * @param {string} description - Transaction description
   * @param {string} amount - Amount string (e.g., "+500", "-100")
   * @returns {Object} Parsed transaction info
   */
  parseTransactionInfo(description, amount) {
    const desc = description.toLowerCase().trim();
    const amountStr = amount.toString().trim();
    const isPositive = amountStr.startsWith('+');
    const isNegative = amountStr.startsWith('-');
    const numericAmount = Math.abs(parseFloat(amountStr.replace(/[+\-]/g, '')) || 0);

    let type = 'bonus'; // Default type
    let method = 'system';

    // Determine transaction type from description
    if (desc.includes('deposit') || desc.includes('add')) {
      type = 'deposit';
      method = desc.includes('easypaisa') ? 'easypaisa' :
        desc.includes('jazzcash') ? 'jazzcash' : 'bank';
    } else if (desc.includes('withdraw') || desc.includes('payout')) {
      type = 'withdrawal';
      method = desc.includes('easypaisa') ? 'easypaisa' :
        desc.includes('jazzcash') ? 'jazzcash' : 'bank';
    } else if (desc.includes('tournament') || desc.includes('joined')) {
      type = isNegative ? 'tournament_fee' : 'prize';
    } else if (desc.includes('victory') || desc.includes('win') || desc.includes('prize')) {
      type = 'prize';
    } else if (desc.includes('welcome') || desc.includes('bonus')) {
      type = 'bonus';
    } else if (desc.includes('daily') || desc.includes('login')) {
      type = 'bonus';
    } else if (desc.includes('referral')) {
      type = 'referral';
    } else if (desc.includes('uid') || desc.includes('change')) {
      type = 'tournament_fee'; // UID changes cost coins
    }

    return {
      type,
      method,
      amount: numericAmount,
      isCredit: isPositive || (!isNegative && numericAmount > 0)
    };
  }

  /**
   * Sanitize transaction data for Firestore
   * @param {Object} transactionData - Raw transaction data
   * @param {string} userId - Firebase Auth UID
   * @returns {Object} Sanitized transaction data
   */
  sanitizeTransactionData(transactionData, userId) {
    // Handle different transaction sources
    let sanitized;

    if (transactionData.desc && transactionData.amount) {
      // User transaction from profile
      const parsed = this.parseTransactionInfo(transactionData.desc, transactionData.amount);

      sanitized = {
        id: `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        userId: userId,
        type: parsed.type,
        amount: parsed.amount,
        status: 'completed', // User transactions are already completed
        method: parsed.method,
        details: {
          description: transactionData.desc,
          originalAmount: transactionData.amount,
          isCredit: parsed.isCredit
        },
        createdAt: this.parseTransactionDate(transactionData.date),
        processedAt: this.parseTransactionDate(transactionData.date)
      };
    } else if (transactionData.type && (transactionData.type === 'deposit' || transactionData.type === 'withdraw')) {
      // Admin transaction (deposit/withdrawal request)
      sanitized = {
        id: transactionData.id ? `txn_${transactionData.id}` : `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        userId: userId, // Will need to be mapped from username
        type: transactionData.type === 'withdraw' ? 'withdrawal' : 'deposit',
        amount: parseFloat(transactionData.amount) || 0,
        status: this.statusMapping[transactionData.status?.toLowerCase()] || 'pending',
        method: transactionData.method || 'easypaisa',
        details: {
          transactionId: transactionData.tid,
          accountNumber: transactionData.account,
          fee: parseFloat(transactionData.fee) || 0,
          adminNotes: transactionData.notes || ''
        },
        createdAt: this.parseTransactionDate(transactionData.date),
        processedAt: transactionData.status === 'completed' ? this.parseTransactionDate(transactionData.date) : null
      };
    } else {
      // Generic transaction
      sanitized = {
        id: `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        userId: userId,
        type: 'bonus',
        amount: parseFloat(transactionData.amount) || 0,
        status: 'completed',
        method: 'system',
        details: {
          description: transactionData.description || 'Unknown transaction',
          originalData: transactionData
        },
        createdAt: new Date(),
        processedAt: new Date()
      };
    }

    // Clean up null/undefined values
    Object.keys(sanitized).forEach(key => {
      if (sanitized[key] === null || sanitized[key] === undefined) {
        delete sanitized[key];
      }
    });

    return sanitized;
  }

  /**
   * Parse transaction date
   * @param {string} dateString - Date string
   * @returns {Date} Parsed date
   */
  parseTransactionDate(dateString) {
    if (!dateString) return new Date();

    try {
      if (dateString === 'Just now') {
        return new Date();
      }

      const parsed = new Date(dateString);
      return isNaN(parsed.getTime()) ? new Date() : parsed;
    } catch (error) {
      console.warn(`Failed to parse transaction date: ${dateString}`);
      return new Date();
    }
  }

  /**
   * Create backup of transaction data
   * @returns {Object} Backup data
   */
  createTransactionBackup() {
    try {
      const backup = {
        timestamp: new Date().toISOString(),
        transactions: this.getLocalStorageTransactions()
      };

      const backupKey = `transaction_backup_${Date.now()}`;
      this.backupData.set(backupKey, backup);
      localStorage.setItem(backupKey, JSON.stringify(backup));

      console.log(`✅ Transaction backup created: ${backupKey}`);
      return { backupKey, backup };
    } catch (error) {
      console.error('❌ Failed to create transaction backup:', error);
      throw new Error('Transaction backup creation failed');
    }
  }

  /**
   * Migrate single transaction to Firestore with atomic operations
   * @param {Object} localTransaction - Local transaction data
   * @param {string} userId - Firebase Auth UID
   * @returns {Promise<Object>} Migration result
   */
  async migrateSingleTransaction(localTransaction, userId) {
    const migrationResult = {
      success: false,
      id: localTransaction.id,
      userId: userId,
      errors: [],
      warnings: []
    };

    try {
      // Sanitize data
      const sanitizedData = this.sanitizeTransactionData(localTransaction, userId);

      // Validate data
      const validation = this.validateTransactionData(sanitizedData);
      migrationResult.warnings = validation.warnings;

      if (!validation.isValid) {
        migrationResult.errors = validation.errors;
        console.error(`❌ Validation failed for transaction ${sanitizedData.id}:`, validation.errors);
        return migrationResult;
      }

      // Check if transaction already exists
      const existingTransaction = await databaseManager.getCachedDoc(`transactions/${sanitizedData.id}`);
      if (existingTransaction) {
        console.log(`⚠️ Transaction ${sanitizedData.id} already exists in Firestore`);
        migrationResult.warnings.push('Transaction already exists in Firestore');
        migrationResult.success = true;
        return migrationResult;
      }

      // Create transaction with atomic operation
      await this.createTransactionWithAudit(sanitizedData);

      migrationResult.success = true;
      console.log(`✅ Transaction ${sanitizedData.id} migrated successfully`);

    } catch (error) {
      console.error(`❌ Failed to migrate transaction:`, error);
      migrationResult.errors.push(error.message);
    }

    return migrationResult;
  }

  /**
   * Create transaction with audit trail using Firestore transaction
   * @param {Object} transactionData - Transaction data
   * @returns {Promise<void>}
   */
  async createTransactionWithAudit(transactionData) {
    return runTransaction(db, async (transaction) => {
      // Create the transaction document
      const transactionRef = doc(db, `transactions/${transactionData.id}`);
      transaction.set(transactionRef, {
        ...transactionData,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      // Create audit trail entry
      const auditRef = doc(db, `audit_trail/${transactionData.id}_created`);
      transaction.set(auditRef, {
        transactionId: transactionData.id,
        action: 'created',
        userId: transactionData.userId,
        amount: transactionData.amount,
        type: transactionData.type,
        status: transactionData.status,
        timestamp: serverTimestamp(),
        source: 'migration'
      });

      // Update quota tracking
      quotaManager.trackWrite(2); // Transaction + audit entry
    });
  }

  /**
   * Update transaction status with atomic operation and audit trail
   * @param {string} transactionId - Transaction ID
   * @param {string} newStatus - New status
   * @param {string} adminId - Admin user ID
   * @param {string} notes - Admin notes
   * @returns {Promise<void>}
   */
  async updateTransactionStatus(transactionId, newStatus, adminId, notes = '') {
    return runTransaction(db, async (transaction) => {
      // Get current transaction
      const transactionRef = databaseManager.doc(`transactions/${transactionId}`);
      const transactionDoc = await transaction.get(transactionRef);

      if (!transactionDoc.exists()) {
        throw new Error('Transaction not found');
      }

      const currentData = transactionDoc.data();

      // Update transaction
      transaction.update(transactionRef, {
        status: newStatus,
        processedBy: adminId,
        processedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        'details.adminNotes': notes
      });

      // Create audit trail entry
      const auditRef = databaseManager.doc(`audit_trail/${transactionId}_${Date.now()}`);
      transaction.set(auditRef, {
        transactionId: transactionId,
        action: 'status_updated',
        previousStatus: currentData.status,
        newStatus: newStatus,
        adminId: adminId,
        notes: notes,
        timestamp: serverTimestamp()
      });

      // If completing a deposit/withdrawal, update user balance
      if (newStatus === 'completed' && currentData.status === 'pending') {
        const userRef = databaseManager.doc(`users/${currentData.userId}`);
        const userDoc = await transaction.get(userRef);

        if (userDoc.exists()) {
          const userData = userDoc.data();
          let newBalance = userData.coins || 0;

          if (currentData.type === 'deposit') {
            newBalance += currentData.amount;
          } else if (currentData.type === 'withdrawal') {
            // Balance was already deducted when request was made
            // No additional balance change needed
          }

          transaction.update(userRef, {
            coins: newBalance,
            updatedAt: serverTimestamp()
          });
        }
      }

      quotaManager.trackWrite(3); // Transaction + audit + user (if applicable)
    });
  }

  /**
   * Migrate all transactions from localStorage to Firestore
   * @param {Object} userMapping - Mapping of usernames to Firebase UIDs
   * @param {boolean} dryRun - Perform validation only without actual migration
   * @returns {Promise<Object>} Migration summary
   */
  async migrateAllTransactions(userMapping = {}, dryRun = false) {
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
        const backup = this.createTransactionBackup();
        summary.backupKey = backup.backupKey;
      }

      // Get localStorage transactions
      const localTransactions = this.getLocalStorageTransactions();
      const allTransactions = [
        ...localTransactions.userTransactions,
        ...localTransactions.adminTransactions
      ];

      summary.total = allTransactions.length;

      if (allTransactions.length === 0) {
        console.log('📋 No transactions found in localStorage');
        return summary;
      }

      console.log(`🚀 Starting ${dryRun ? 'validation' : 'migration'} of ${allTransactions.length} transactions`);

      // Process each transaction
      for (const localTransaction of allTransactions) {
        try {
          // Map username to UID (Robust case-insensitive lookup)
          const username = localTransaction.userId || localTransaction.user || localTransaction.username;
          let userId = userMapping[username];

          if (!userId) {
            // Try case-insensitive fallback
            const lowerUsername = username?.toLowerCase();
            const matchingKey = Object.keys(userMapping).find(k => k.toLowerCase() === lowerUsername);
            if (matchingKey) userId = userMapping[matchingKey];
          }

          if (!userId) userId = `temp_${username}`;

          // Allow the migration to proceed even with 'temp_' UIDs, as that's how legacy users are currently being ID'd
          if (!userId) {
            console.warn(`⚠️ No mapping found for user: ${username}`);
            summary.skipped++;
            summary.results.push({
              id: localTransaction.id,
              username: username,
              success: false,
              errors: ['No UID mapping found for user']
            });
            continue;
          }

          if (dryRun) {
            // Validation only
            const sanitizedData = this.sanitizeTransactionData(localTransaction, userId);
            const validation = this.validateTransactionData(sanitizedData);

            const result = {
              id: localTransaction.id,
              username: username,
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
            const result = await this.migrateSingleTransaction(localTransaction, userId);
            summary.results.push(result);

            if (result.success) {
              summary.successful++;
            } else {
              summary.failed++;
            }
          }

        } catch (error) {
          console.error(`❌ Error processing transaction:`, error);
          summary.failed++;
          summary.results.push({
            id: localTransaction.id || 'Unknown',
            success: false,
            errors: [error.message]
          });
        }
      }

      // Log summary
      console.log(`📊 Transaction ${dryRun ? 'Validation' : 'Migration'} Summary:`, {
        total: summary.total,
        successful: summary.successful,
        failed: summary.failed,
        skipped: summary.skipped
      });

      return summary;

    } catch (error) {
      console.error(`❌ Transaction ${dryRun ? 'validation' : 'migration'} failed:`, error);
      throw error;
    }
  }

  /**
   * Process referral bonuses from localStorage
   * @param {Object} userMapping - Mapping of usernames to Firebase UIDs
   * @returns {Promise<Object>} Processing summary
   */
  async processReferralBonuses(userMapping = {}) {
    const summary = {
      total: 0,
      processed: 0,
      failed: 0,
      results: []
    };

    try {
      const localTransactions = this.getLocalStorageTransactions();
      const referralRequests = localTransactions.referralRequests;

      summary.total = referralRequests.length;

      if (referralRequests.length === 0) {
        console.log('📋 No referral requests found');
        return summary;
      }

      console.log(`🚀 Processing ${referralRequests.length} referral requests`);

      for (const referral of referralRequests) {
        try {
          const newUserUid = userMapping[referral.newUser];

          if (!newUserUid) {
            console.warn(`⚠️ No UID mapping for new user: ${referral.newUser}`);
            summary.failed++;
            continue;
          }

          // Create referral bonus transaction
          const bonusTransaction = {
            id: `txn_referral_${referral.id}`,
            userId: newUserUid,
            type: 'referral',
            amount: 50, // Standard referral bonus
            status: referral.status === 'Approved' ? 'completed' : 'pending',
            method: 'system',
            details: {
              referralCode: referral.referralCode,
              referralId: referral.id,
              description: `Referral bonus for using code: ${referral.referralCode}`
            },
            createdAt: this.parseTransactionDate(referral.date),
            processedAt: referral.status === 'Approved' ? this.parseTransactionDate(referral.date) : null
          };

          await this.createTransactionWithAudit(bonusTransaction);

          summary.processed++;
          summary.results.push({
            referralId: referral.id,
            newUser: referral.newUser,
            success: true
          });

        } catch (error) {
          console.error(`❌ Failed to process referral ${referral.id}:`, error);
          summary.failed++;
          summary.results.push({
            referralId: referral.id,
            newUser: referral.newUser,
            success: false,
            error: error.message
          });
        }
      }

      console.log(`📊 Referral Processing Summary:`, {
        total: summary.total,
        processed: summary.processed,
        failed: summary.failed
      });

      return summary;

    } catch (error) {
      console.error('❌ Referral processing failed:', error);
      throw error;
    }
  }

  /**
   * Get transaction migration status
   * @returns {Object} Migration status
   */
  getTransactionMigrationStatus() {
    const localTransactions = this.getLocalStorageTransactions();
    const totalTransactions = localTransactions.userTransactions.length +
      localTransactions.adminTransactions.length;

    return {
      hasLocalData: totalTransactions > 0,
      totalTransactions: totalTransactions,
      userTransactions: localTransactions.userTransactions.length,
      adminTransactions: localTransactions.adminTransactions.length,
      referralRequests: localTransactions.referralRequests.length,
      backups: this.getAvailableBackups()
    };
  }

  /**
   * Get available transaction backups
   * @returns {Array} Available backup keys
   */
  getAvailableBackups() {
    const backups = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('transaction_backup_')) {
        try {
          const backup = JSON.parse(localStorage.getItem(key));
          backups.push({
            key,
            timestamp: backup.timestamp,
            transactionCount: (backup.transactions?.userTransactions?.length || 0) +
              (backup.transactions?.adminTransactions?.length || 0)
          });
        } catch (error) {
          console.warn(`Invalid transaction backup found: ${key}`);
        }
      }
    }

    return backups.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }

  /**
   * Clean up old transaction backups
   * @param {number} keepCount - Number of backups to keep
   */
  cleanupTransactionBackups(keepCount = 3) {
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
        console.warn(`Failed to delete transaction backup ${backup.key}:`, error);
      }
    });

    console.log(`🧹 Cleaned up ${deleted} old transaction backups`);
  }

  /**
   * Rollback transaction migration
   * @param {string} backupKey - Backup key to restore from
   * @returns {Promise<void>}
   */
  async rollbackMigration(backupKey) {
    try {
      let backup = this.backupData.get(backupKey);

      if (!backup) {
        const backupData = localStorage.getItem(backupKey);
        if (!backupData) {
          throw new Error('Backup not found');
        }
        backup = JSON.parse(backupData);
      }

      // This would typically involve deleting migrated transactions from Firestore
      // and restoring localStorage data, but should be used with caution
      console.log(`⚠️ Transaction rollback requested for backup: ${backupKey}`);
      console.log('Manual intervention may be required for complete rollback');

    } catch (error) {
      console.error('❌ Failed to rollback transaction migration:', error);
      throw error;
    }
  }
}

// Create and export singleton instance
const transactionMigrationManager = new TransactionMigrationManager();
export default transactionMigrationManager;