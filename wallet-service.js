// WalletService - Financial Operations Management
// Implements secure wallet management with transaction history and atomic operations

import {
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  increment
} from 'firebase/firestore';

import { auth, db, quotaManager, withRetry } from './firebase-config.js';
import databaseManager from './database-manager.js';

class WalletService {
  constructor() {
    this.transactionTypes = {
      DEPOSIT: 'deposit',
      WITHDRAWAL: 'withdrawal',
      TOURNAMENT_FEE: 'tournament_fee',
      PRIZE: 'prize',
      REFERRAL: 'referral'
    };

    this.transactionStatus = {
      PENDING: 'pending',
      COMPLETED: 'completed',
      FAILED: 'failed',
      CANCELLED: 'cancelled'
    };

    this.paymentMethods = {
      EASYPAISA: 'easypaisa',
      JAZZCASH: 'jazzcash',
      BANK_TRANSFER: 'bank_transfer'
    };
  }

  /**
   * Get user's current balance
   * @param {string} userId - User UID
   * @returns {Promise<number>} Current balance
   */
  async getBalance(userId) {
    try {
      const userData = await databaseManager.getUser(userId);
      return userData?.coins || 0;
    } catch (error) {
      console.error(`❌ Failed to get balance for user ${userId}:`, error);
      throw new Error('Failed to retrieve balance');
    }
  }

  /**
   * Create deposit request
   * @param {string} userId - User UID
   * @param {number} amount - Deposit amount
   * @param {string} method - Payment method
   * @param {string} transactionId - External transaction ID
   * @returns {Promise<string>} Transaction ID
   */
  async createDepositRequest(userId, amount, method, transactionId) {
    // Validate inputs
    if (!userId || amount === undefined || amount === null || !method || !transactionId) {
      throw new Error('Missing required parameters for deposit request');
    }

    if (amount <= 0) {
      throw new Error('Deposit amount must be greater than 0');
    }

    if (!Object.values(this.paymentMethods).includes(method)) {
      throw new Error('Invalid payment method');
    }

    try {
      // Check if transaction ID already exists to prevent duplicates
      const existingTransactions = await databaseManager.queryCollection('transactions', [
        { type: 'where', field: 'details.transactionId', operator: '==', value: transactionId }
      ]);

      if (existingTransactions.length > 0) {
        throw new Error('Transaction ID already exists');
      }

      // Create transaction record
      const transactionData = {
        userId,
        type: this.transactionTypes.DEPOSIT,
        amount,
        status: this.transactionStatus.PENDING,
        method,
        details: {
          transactionId,
          adminNotes: ''
        },
        processedBy: null,
        createdAt: serverTimestamp(),
        processedAt: null
      };

      const txnId = await databaseManager.createTransaction(transactionData);

      console.log(`✅ Deposit request created: ${txnId} for user ${userId}`);
      return txnId;

    } catch (error) {
      console.error(`❌ Failed to create deposit request for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Create withdrawal request
   * @param {string} userId - User UID
   * @param {number} amount - Withdrawal amount
   * @param {string} method - Payment method
   * @param {string} account - Account details
   * @returns {Promise<string>} Transaction ID
   */
  async createWithdrawalRequest(userId, amount, method, account) {
    // Validate inputs
    if (!userId || amount === undefined || amount === null || !method || !account) {
      throw new Error('Missing required parameters for withdrawal request');
    }

    if (amount <= 0) {
      throw new Error('Withdrawal amount must be greater than 0');
    }

    if (!Object.values(this.paymentMethods).includes(method)) {
      throw new Error('Invalid payment method');
    }

    try {
      // Check user balance
      const currentBalance = await this.getBalance(userId);
      if (currentBalance < amount) {
        throw new Error('Insufficient balance for withdrawal');
      }

      // Create transaction record
      const transactionData = {
        userId,
        type: this.transactionTypes.WITHDRAWAL,
        amount,
        status: this.transactionStatus.PENDING,
        method,
        details: {
          accountNumber: account,
          adminNotes: ''
        },
        processedBy: null,
        createdAt: serverTimestamp(),
        processedAt: null
      };

      const txnId = await databaseManager.createTransaction(transactionData);

      console.log(`✅ Withdrawal request created: ${txnId} for user ${userId}`);
      return txnId;

    } catch (error) {
      console.error(`❌ Failed to create withdrawal request for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Process deposit request (Admin function)
   * @param {string} requestId - Transaction ID
   * @param {string} adminId - Admin UID
   * @param {boolean} approve - Whether to approve or reject
   * @param {string} adminNotes - Admin notes
   * @returns {Promise<void>}
   */
  async processDeposit(requestId, adminId, approve = true, adminNotes = '') {
    if (!requestId || !adminId) {
      throw new Error('Missing required parameters for deposit processing');
    }

    try {
      // Use Firestore transaction to ensure atomicity
      await databaseManager.runTransaction(async (transaction) => {
        // Get transaction document
        const txnRef = doc(db, 'transactions', requestId);
        const txnDoc = await transaction.get(txnRef);

        if (!txnDoc.exists()) {
          throw new Error('Transaction not found');
        }

        const txnData = txnDoc.data();

        // Validate transaction
        if (txnData.type !== this.transactionTypes.DEPOSIT) {
          throw new Error('Invalid transaction type for deposit processing');
        }

        if (txnData.status !== this.transactionStatus.PENDING) {
          throw new Error('Transaction is not in pending status');
        }

        if (approve) {
          // Get user document
          const userRef = doc(db, 'users', txnData.userId);
          const userDoc = await transaction.get(userRef);

          if (!userDoc.exists()) {
            throw new Error('User not found');
          }

          // Update user balance
          transaction.update(userRef, {
            coins: increment(txnData.amount),
            updatedAt: serverTimestamp()
          });

          // Update transaction status to completed
          transaction.update(txnRef, {
            status: this.transactionStatus.COMPLETED,
            processedBy: adminId,
            processedAt: serverTimestamp(),
            'details.adminNotes': adminNotes
          });

          quotaManager.trackWrite(2); // User update + transaction update
        } else {
          // Reject the deposit
          transaction.update(txnRef, {
            status: this.transactionStatus.FAILED,
            processedBy: adminId,
            processedAt: serverTimestamp(),
            'details.adminNotes': adminNotes || 'Deposit rejected by admin'
          });

          quotaManager.trackWrite(1); // Transaction update only
        }
      });

      console.log(`✅ Deposit ${approve ? 'approved' : 'rejected'}: ${requestId} by admin ${adminId}`);

    } catch (error) {
      console.error(`❌ Failed to process deposit ${requestId}:`, error);
      throw error;
    }
  }

  /**
   * Process withdrawal request (Admin function)
   * @param {string} requestId - Transaction ID
   * @param {string} adminId - Admin UID
   * @param {boolean} approve - Whether to approve or reject
   * @param {string} adminNotes - Admin notes
   * @returns {Promise<void>}
   */
  async processWithdrawal(requestId, adminId, approve = true, adminNotes = '') {
    if (!requestId || !adminId) {
      throw new Error('Missing required parameters for withdrawal processing');
    }

    try {
      // Use Firestore transaction to ensure atomicity
      await databaseManager.runTransaction(async (transaction) => {
        // Get transaction document
        const txnRef = doc(db, 'transactions', requestId);
        const txnDoc = await transaction.get(txnRef);

        if (!txnDoc.exists()) {
          throw new Error('Transaction not found');
        }

        const txnData = txnDoc.data();

        // Validate transaction
        if (txnData.type !== this.transactionTypes.WITHDRAWAL) {
          throw new Error('Invalid transaction type for withdrawal processing');
        }

        if (txnData.status !== this.transactionStatus.PENDING) {
          throw new Error('Transaction is not in pending status');
        }

        if (approve) {
          // Get user document
          const userRef = doc(db, 'users', txnData.userId);
          const userDoc = await transaction.get(userRef);

          if (!userDoc.exists()) {
            throw new Error('User not found');
          }

          const userData = userDoc.data();

          // Verify user still has sufficient balance
          if (userData.coins < txnData.amount) {
            throw new Error('Insufficient balance for withdrawal');
          }

          // Update user balance
          transaction.update(userRef, {
            coins: increment(-txnData.amount),
            updatedAt: serverTimestamp()
          });

          // Update transaction status to completed
          transaction.update(txnRef, {
            status: this.transactionStatus.COMPLETED,
            processedBy: adminId,
            processedAt: serverTimestamp(),
            'details.adminNotes': adminNotes
          });

          quotaManager.trackWrite(2); // User update + transaction update
        } else {
          // Reject the withdrawal
          transaction.update(txnRef, {
            status: this.transactionStatus.FAILED,
            processedBy: adminId,
            processedAt: serverTimestamp(),
            'details.adminNotes': adminNotes || 'Withdrawal rejected by admin'
          });

          quotaManager.trackWrite(1); // Transaction update only
        }
      });

      console.log(`✅ Withdrawal ${approve ? 'approved' : 'rejected'}: ${requestId} by admin ${adminId}`);

    } catch (error) {
      console.error(`❌ Failed to process withdrawal ${requestId}:`, error);
      throw error;
    }
  }

  /**
   * Process tournament fee payment
   * @param {string} userId - User UID
   * @param {number} amount - Tournament fee
   * @param {string} tournamentId - Tournament ID
   * @returns {Promise<string>} Transaction ID
   */
  async processTournamentFee(userId, amount, tournamentId) {
    if (!userId || !amount || !tournamentId) {
      throw new Error('Missing required parameters for tournament fee');
    }

    if (amount <= 0) {
      throw new Error('Tournament fee must be greater than 0');
    }

    try {
      let transactionId;

      // Use Firestore transaction to ensure atomicity
      await databaseManager.runTransaction(async (transaction) => {
        // Get user document
        const userRef = doc(db, 'users', userId);
        const userDoc = await transaction.get(userRef);

        if (!userDoc.exists()) {
          throw new Error('User not found');
        }

        const userData = userDoc.data();

        // Check if user has sufficient balance
        if (userData.coins < amount) {
          throw new Error('Insufficient balance for tournament fee');
        }

        // Create transaction record
        const txnData = {
          userId,
          type: this.transactionTypes.TOURNAMENT_FEE,
          amount,
          status: this.transactionStatus.COMPLETED,
          method: 'internal',
          details: {
            tournamentId,
            adminNotes: 'Tournament entry fee'
          },
          processedBy: 'system',
          createdAt: serverTimestamp(),
          processedAt: serverTimestamp()
        };

        // Generate transaction ID
        transactionId = `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const txnRef = doc(db, 'transactions', transactionId);

        // Update user balance
        transaction.update(userRef, {
          coins: increment(-amount),
          updatedAt: serverTimestamp()
        });

        // Create transaction record
        transaction.set(txnRef, {
          id: transactionId,
          ...txnData
        });

        quotaManager.trackWrite(2); // User update + transaction creation
      });

      console.log(`✅ Tournament fee processed: ${transactionId} for user ${userId}`);
      return transactionId;

    } catch (error) {
      console.error(`❌ Failed to process tournament fee for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Process prize distribution
   * @param {string} userId - User UID
   * @param {number} amount - Prize amount
   * @param {string} tournamentId - Tournament ID
   * @returns {Promise<string>} Transaction ID
   */
  async processPrize(userId, amount, tournamentId) {
    if (!userId || amount === undefined || amount === null || !tournamentId) {
      throw new Error('Missing required parameters for prize distribution');
    }

    if (amount <= 0) {
      throw new Error('Prize amount must be greater than 0');
    }

    try {
      let transactionId;

      // Use Firestore transaction to ensure atomicity
      await databaseManager.runTransaction(async (transaction) => {
        // Get user document
        const userRef = doc(db, 'users', userId);
        const userDoc = await transaction.get(userRef);

        if (!userDoc.exists()) {
          throw new Error('User not found');
        }

        // Create transaction record
        const txnData = {
          userId,
          type: this.transactionTypes.PRIZE,
          amount,
          status: this.transactionStatus.COMPLETED,
          method: 'internal',
          details: {
            tournamentId,
            adminNotes: 'Tournament prize'
          },
          processedBy: 'system',
          createdAt: serverTimestamp(),
          processedAt: serverTimestamp()
        };

        // Generate transaction ID
        transactionId = `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const txnRef = doc(db, 'transactions', transactionId);

        // Update user balance
        transaction.update(userRef, {
          coins: increment(amount),
          updatedAt: serverTimestamp()
        });

        // Create transaction record
        transaction.set(txnRef, {
          id: transactionId,
          ...txnData
        });

        quotaManager.trackWrite(2); // User update + transaction creation
      });

      console.log(`✅ Prize distributed: ${transactionId} for user ${userId}`);
      return transactionId;

    } catch (error) {
      console.error(`❌ Failed to process prize for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Get user's transaction history
   * @param {string} userId - User UID
   * @param {number} limit - Number of transactions to retrieve
   * @returns {Promise<Array>} Transaction history
   */
  async getTransactionHistory(userId, limit = 50) {
    if (!userId) {
      throw new Error('User ID is required');
    }

    try {
      const transactions = await databaseManager.getUserTransactions(userId, limit);
      return transactions;
    } catch (error) {
      console.error(`❌ Failed to get transaction history for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Get all pending transactions (Admin function)
   * @param {string} type - Transaction type filter (optional)
   * @returns {Promise<Array>} Pending transactions
   */
  async getPendingTransactions(type = null) {
    try {
      const constraints = [
        { type: 'where', field: 'status', operator: '==', value: this.transactionStatus.PENDING },
        { type: 'orderBy', field: 'createdAt', direction: 'asc' }
      ];

      if (type && Object.values(this.transactionTypes).includes(type)) {
        constraints.unshift({ type: 'where', field: 'type', operator: '==', value: type });
      }

      const transactions = await databaseManager.queryCollection('transactions', constraints);
      return transactions;
    } catch (error) {
      console.error('❌ Failed to get pending transactions:', error);
      throw error;
    }
  }

  /**
   * Setup real-time listener for user balance changes
   * @param {string} userId - User UID
   * @param {Function} callback - Callback function
   * @returns {Function} Unsubscribe function
   */
  onBalanceChanged(userId, callback) {
    if (!userId || typeof callback !== 'function') {
      throw new Error('User ID and callback function are required');
    }

    return databaseManager.onUserChanged(userId, (userData) => {
      if (userData) {
        callback(userData.coins || 0);
      }
    });
  }

  /**
   * Setup real-time listener for transaction changes
   * @param {string} userId - User UID (optional, for user-specific transactions)
   * @param {Function} callback - Callback function
   * @returns {Function} Unsubscribe function
   */
  onTransactionsChanged(userId, callback) {
    if (typeof userId === 'function') {
      // If userId is actually the callback, listen to all transactions
      callback = userId;
      userId = null;
    }

    if (typeof callback !== 'function') {
      throw new Error('Callback function is required');
    }

    return databaseManager.onTransactionsChanged(callback, userId);
  }

  /**
   * Get transaction statistics
   * @param {string} userId - User UID (optional, for user-specific stats)
   * @returns {Promise<Object>} Transaction statistics
   */
  async getTransactionStats(userId = null) {
    try {
      const constraints = [];

      if (userId) {
        constraints.push({ type: 'where', field: 'userId', operator: '==', value: userId });
      }

      const transactions = await databaseManager.queryCollection('transactions', constraints, false);

      const stats = {
        total: transactions.length,
        pending: 0,
        completed: 0,
        failed: 0,
        totalDeposits: 0,
        totalWithdrawals: 0,
        totalFees: 0,
        totalPrizes: 0
      };

      transactions.forEach(txn => {
        // Count by status
        stats[txn.status] = (stats[txn.status] || 0) + 1;

        // Sum by type (only completed transactions)
        if (txn.status === this.transactionStatus.COMPLETED) {
          switch (txn.type) {
            case this.transactionTypes.DEPOSIT:
              stats.totalDeposits += txn.amount;
              break;
            case this.transactionTypes.WITHDRAWAL:
              stats.totalWithdrawals += txn.amount;
              break;
            case this.transactionTypes.TOURNAMENT_FEE:
              stats.totalFees += txn.amount;
              break;
            case this.transactionTypes.PRIZE:
              stats.totalPrizes += txn.amount;
              break;
          }
        }
      });

      return stats;
    } catch (error) {
      console.error('❌ Failed to get transaction statistics:', error);
      throw error;
    }
  }

  /**
   * Validate transaction data
   * @param {Object} transactionData - Transaction data to validate
   * @returns {boolean} Validation result
   */
  validateTransactionData(transactionData) {
    const required = ['userId', 'type', 'amount', 'status'];

    for (const field of required) {
      if (!transactionData[field]) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    if (!Object.values(this.transactionTypes).includes(transactionData.type)) {
      throw new Error('Invalid transaction type');
    }

    if (!Object.values(this.transactionStatus).includes(transactionData.status)) {
      throw new Error('Invalid transaction status');
    }

    if (typeof transactionData.amount !== 'number' || transactionData.amount <= 0) {
      throw new Error('Amount must be a positive number');
    }

    return true;
  }

  /**
   * Alias for processDeposit(id, adminId, true)
   * Used by AdminIntegration
   */
  async approveDeposit(requestId, adminNotes = '') {
    const adminId = auth.currentUser?.uid || 'system-admin';
    return this.processDeposit(requestId, adminId, true, adminNotes);
  }

  /**
   * Alias for processWithdrawal(id, adminId, true)
   * Used by AdminIntegration
   */
  async completeWithdrawal(requestId, adminNotes = '') {
    const adminId = auth.currentUser?.uid || 'system-admin';
    return this.processWithdrawal(requestId, adminId, true, adminNotes);
  }
}

// Create and export singleton instance
const walletService = new WalletService();
export default walletService;