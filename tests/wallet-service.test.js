// WalletService Tests
// Comprehensive test suite for wallet and transaction management

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import walletService from '../wallet-service.js';

// Mock Firebase dependencies
vi.mock('../firebase-config.js', () => ({
  db: {},
  quotaManager: {
    trackRead: vi.fn(),
    trackWrite: vi.fn(),
    canPerformOperation: vi.fn(() => true)
  },
  withRetry: vi.fn((fn) => fn())
}));

vi.mock('../database-manager.js', () => ({
  default: {
    getUser: vi.fn(),
    createTransaction: vi.fn(),
    getUserTransactions: vi.fn(),
    queryCollection: vi.fn(),
    onUserChanged: vi.fn(),
    onTransactionsChanged: vi.fn(),
    runTransaction: vi.fn()
  }
}));

// Mock Firestore functions
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  getDoc: vi.fn(),
  runTransaction: vi.fn(),
  serverTimestamp: vi.fn(() => ({ seconds: Date.now() / 1000 })),
  increment: vi.fn((value) => ({ increment: value }))
}));

import databaseManager from '../database-manager.js';

describe('WalletService', () => {
  const mockUserId = 'user123';
  const mockAdminId = 'admin123';
  const mockTransactionId = 'txn_123456789';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getBalance', () => {
    test('should return user balance', async () => {
      const mockUserData = { coins: 1000 };
      databaseManager.getUser.mockResolvedValue(mockUserData);

      const balance = await walletService.getBalance(mockUserId);

      expect(balance).toBe(1000);
      expect(databaseManager.getUser).toHaveBeenCalledWith(mockUserId);
    });

    test('should return 0 if user has no coins', async () => {
      const mockUserData = {};
      databaseManager.getUser.mockResolvedValue(mockUserData);

      const balance = await walletService.getBalance(mockUserId);

      expect(balance).toBe(0);
    });

    test('should return 0 if user not found', async () => {
      databaseManager.getUser.mockResolvedValue(null);

      const balance = await walletService.getBalance(mockUserId);

      expect(balance).toBe(0);
    });

    test('should throw error on database failure', async () => {
      databaseManager.getUser.mockRejectedValue(new Error('Database error'));

      await expect(walletService.getBalance(mockUserId)).rejects.toThrow('Failed to retrieve balance');
    });
  });

  describe('createDepositRequest', () => {
    test('should create deposit request successfully', async () => {
      databaseManager.queryCollection.mockResolvedValue([]); // No existing transactions
      databaseManager.createTransaction.mockResolvedValue(mockTransactionId);

      const result = await walletService.createDepositRequest(
        mockUserId, 
        500, 
        'easypaisa', 
        'ext_txn_123'
      );

      expect(result).toBe(mockTransactionId);
      expect(databaseManager.queryCollection).toHaveBeenCalledWith('transactions', [
        { type: 'where', field: 'details.transactionId', operator: '==', value: 'ext_txn_123' }
      ]);
      expect(databaseManager.createTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: mockUserId,
          type: 'deposit',
          amount: 500,
          status: 'pending',
          method: 'easypaisa'
        })
      );
    });

    test('should throw error for missing parameters', async () => {
      await expect(walletService.createDepositRequest()).rejects.toThrow('Missing required parameters');
      await expect(walletService.createDepositRequest(mockUserId)).rejects.toThrow('Missing required parameters');
      await expect(walletService.createDepositRequest(mockUserId, 500)).rejects.toThrow('Missing required parameters');
    });

    test('should throw error for invalid amount', async () => {
      await expect(walletService.createDepositRequest(mockUserId, 0, 'easypaisa', 'ext_123'))
        .rejects.toThrow('Deposit amount must be greater than 0');
      
      await expect(walletService.createDepositRequest(mockUserId, -100, 'easypaisa', 'ext_123'))
        .rejects.toThrow('Deposit amount must be greater than 0');
    });

    test('should throw error for invalid payment method', async () => {
      await expect(walletService.createDepositRequest(mockUserId, 500, 'invalid_method', 'ext_123'))
        .rejects.toThrow('Invalid payment method');
    });

    test('should throw error for duplicate transaction ID', async () => {
      databaseManager.queryCollection.mockResolvedValue([{ id: 'existing_txn' }]);

      await expect(walletService.createDepositRequest(mockUserId, 500, 'easypaisa', 'ext_123'))
        .rejects.toThrow('Transaction ID already exists');
    });
  });

  describe('createWithdrawalRequest', () => {
    test('should create withdrawal request successfully', async () => {
      databaseManager.getUser.mockResolvedValue({ coins: 1000 });
      databaseManager.createTransaction.mockResolvedValue(mockTransactionId);

      const result = await walletService.createWithdrawalRequest(
        mockUserId, 
        500, 
        'easypaisa', 
        '03001234567'
      );

      expect(result).toBe(mockTransactionId);
      expect(databaseManager.getUser).toHaveBeenCalledWith(mockUserId);
      expect(databaseManager.createTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: mockUserId,
          type: 'withdrawal',
          amount: 500,
          status: 'pending',
          method: 'easypaisa'
        })
      );
    });

    test('should throw error for insufficient balance', async () => {
      databaseManager.getUser.mockResolvedValue({ coins: 100 });

      await expect(walletService.createWithdrawalRequest(mockUserId, 500, 'easypaisa', '03001234567'))
        .rejects.toThrow('Insufficient balance for withdrawal');
    });

    test('should throw error for missing parameters', async () => {
      await expect(walletService.createWithdrawalRequest()).rejects.toThrow('Missing required parameters');
    });

    test('should throw error for invalid amount', async () => {
      await expect(walletService.createWithdrawalRequest(mockUserId, 0, 'easypaisa', '03001234567'))
        .rejects.toThrow('Withdrawal amount must be greater than 0');
      
      await expect(walletService.createWithdrawalRequest(mockUserId, -100, 'easypaisa', '03001234567'))
        .rejects.toThrow('Withdrawal amount must be greater than 0');
    });
  });

  describe('processDeposit', () => {
    test('should approve deposit successfully', async () => {
      const mockTransaction = vi.fn();
      const mockTxnDoc = {
        exists: () => true,
        data: () => ({
          type: 'deposit',
          status: 'pending',
          userId: mockUserId,
          amount: 500
        })
      };
      const mockUserDoc = {
        exists: () => true,
        data: () => ({ coins: 1000 })
      };

      mockTransaction.get = vi.fn()
        .mockResolvedValueOnce(mockTxnDoc)
        .mockResolvedValueOnce(mockUserDoc);
      mockTransaction.update = vi.fn();

      databaseManager.runTransaction.mockImplementation(async (callback) => {
        await callback(mockTransaction);
      });

      await walletService.processDeposit(mockTransactionId, mockAdminId, true, 'Approved');

      expect(mockTransaction.update).toHaveBeenCalledTimes(2); // User and transaction updates
      expect(databaseManager.runTransaction).toHaveBeenCalled();
    });

    test('should reject deposit successfully', async () => {
      const mockTransaction = vi.fn();
      const mockTxnDoc = {
        exists: () => true,
        data: () => ({
          type: 'deposit',
          status: 'pending',
          userId: mockUserId,
          amount: 500
        })
      };

      mockTransaction.get = vi.fn().mockResolvedValue(mockTxnDoc);
      mockTransaction.update = vi.fn();

      databaseManager.runTransaction.mockImplementation(async (callback) => {
        await callback(mockTransaction);
      });

      await walletService.processDeposit(mockTransactionId, mockAdminId, false, 'Rejected');

      expect(mockTransaction.update).toHaveBeenCalledTimes(1); // Only transaction update
    });

    test('should throw error for missing parameters', async () => {
      await expect(walletService.processDeposit()).rejects.toThrow('Missing required parameters');
    });

    test('should throw error for non-existent transaction', async () => {
      const mockTransaction = vi.fn();
      const mockTxnDoc = { exists: () => false };

      mockTransaction.get = vi.fn().mockResolvedValue(mockTxnDoc);
      
      databaseManager.runTransaction.mockImplementation(async (callback) => {
        await callback(mockTransaction);
      });

      await expect(walletService.processDeposit(mockTransactionId, mockAdminId))
        .rejects.toThrow('Transaction not found');
    });

    test('should throw error for invalid transaction type', async () => {
      const mockTransaction = vi.fn();
      const mockTxnDoc = {
        exists: () => true,
        data: () => ({
          type: 'withdrawal', // Wrong type
          status: 'pending'
        })
      };

      mockTransaction.get = vi.fn().mockResolvedValue(mockTxnDoc);
      
      databaseManager.runTransaction.mockImplementation(async (callback) => {
        await callback(mockTransaction);
      });

      await expect(walletService.processDeposit(mockTransactionId, mockAdminId))
        .rejects.toThrow('Invalid transaction type for deposit processing');
    });
  });

  describe('processWithdrawal', () => {
    test('should approve withdrawal successfully', async () => {
      const mockTransaction = vi.fn();
      const mockTxnDoc = {
        exists: () => true,
        data: () => ({
          type: 'withdrawal',
          status: 'pending',
          userId: mockUserId,
          amount: 500
        })
      };
      const mockUserDoc = {
        exists: () => true,
        data: () => ({ coins: 1000 })
      };

      mockTransaction.get = vi.fn()
        .mockResolvedValueOnce(mockTxnDoc)
        .mockResolvedValueOnce(mockUserDoc);
      mockTransaction.update = vi.fn();

      databaseManager.runTransaction.mockImplementation(async (callback) => {
        await callback(mockTransaction);
      });

      await walletService.processWithdrawal(mockTransactionId, mockAdminId, true, 'Approved');

      expect(mockTransaction.update).toHaveBeenCalledTimes(2); // User and transaction updates
    });

    test('should throw error for insufficient balance during processing', async () => {
      const mockTransaction = vi.fn();
      const mockTxnDoc = {
        exists: () => true,
        data: () => ({
          type: 'withdrawal',
          status: 'pending',
          userId: mockUserId,
          amount: 500
        })
      };
      const mockUserDoc = {
        exists: () => true,
        data: () => ({ coins: 100 }) // Insufficient balance
      };

      mockTransaction.get = vi.fn()
        .mockResolvedValueOnce(mockTxnDoc)
        .mockResolvedValueOnce(mockUserDoc);

      databaseManager.runTransaction.mockImplementation(async (callback) => {
        await callback(mockTransaction);
      });

      await expect(walletService.processWithdrawal(mockTransactionId, mockAdminId))
        .rejects.toThrow('Insufficient balance for withdrawal');
    });
  });

  describe('processTournamentFee', () => {
    test('should process tournament fee successfully', async () => {
      const mockTransaction = vi.fn();
      const mockUserDoc = {
        exists: () => true,
        data: () => ({ coins: 1000 })
      };

      mockTransaction.get = vi.fn().mockResolvedValue(mockUserDoc);
      mockTransaction.update = vi.fn();
      mockTransaction.set = vi.fn();

      databaseManager.runTransaction.mockImplementation(async (callback) => {
        await callback(mockTransaction);
      });

      const result = await walletService.processTournamentFee(mockUserId, 100, 'tournament123');

      expect(result).toMatch(/^txn_/);
      expect(mockTransaction.update).toHaveBeenCalled(); // User balance update
      expect(mockTransaction.set).toHaveBeenCalled(); // Transaction creation
    });

    test('should throw error for insufficient balance', async () => {
      const mockTransaction = vi.fn();
      const mockUserDoc = {
        exists: () => true,
        data: () => ({ coins: 50 }) // Insufficient balance
      };

      mockTransaction.get = vi.fn().mockResolvedValue(mockUserDoc);

      databaseManager.runTransaction.mockImplementation(async (callback) => {
        await callback(mockTransaction);
      });

      await expect(walletService.processTournamentFee(mockUserId, 100, 'tournament123'))
        .rejects.toThrow('Insufficient balance for tournament fee');
    });
  });

  describe('processPrize', () => {
    test('should process prize successfully', async () => {
      const mockTransaction = vi.fn();
      const mockUserDoc = {
        exists: () => true,
        data: () => ({ coins: 1000 })
      };

      mockTransaction.get = vi.fn().mockResolvedValue(mockUserDoc);
      mockTransaction.update = vi.fn();
      mockTransaction.set = vi.fn();

      databaseManager.runTransaction.mockImplementation(async (callback) => {
        await callback(mockTransaction);
      });

      const result = await walletService.processPrize(mockUserId, 500, 'tournament123');

      expect(result).toMatch(/^txn_/);
      expect(mockTransaction.update).toHaveBeenCalled(); // User balance update
      expect(mockTransaction.set).toHaveBeenCalled(); // Transaction creation
    });

    test('should throw error for missing parameters', async () => {
      await expect(walletService.processPrize()).rejects.toThrow('Missing required parameters');
    });

    test('should throw error for invalid amount', async () => {
      await expect(walletService.processPrize(mockUserId, 0, 'tournament123'))
        .rejects.toThrow('Prize amount must be greater than 0');
      
      await expect(walletService.processPrize(mockUserId, -100, 'tournament123'))
        .rejects.toThrow('Prize amount must be greater than 0');
    });
  });

  describe('getTransactionHistory', () => {
    test('should return transaction history', async () => {
      const mockTransactions = [
        { id: 'txn1', type: 'deposit', amount: 500 },
        { id: 'txn2', type: 'withdrawal', amount: 200 }
      ];
      databaseManager.getUserTransactions.mockResolvedValue(mockTransactions);

      const result = await walletService.getTransactionHistory(mockUserId);

      expect(result).toEqual(mockTransactions);
      expect(databaseManager.getUserTransactions).toHaveBeenCalledWith(mockUserId, 50);
    });

    test('should throw error for missing user ID', async () => {
      await expect(walletService.getTransactionHistory()).rejects.toThrow('User ID is required');
    });
  });

  describe('getPendingTransactions', () => {
    test('should return pending transactions', async () => {
      const mockTransactions = [
        { id: 'txn1', status: 'pending', type: 'deposit' },
        { id: 'txn2', status: 'pending', type: 'withdrawal' }
      ];
      databaseManager.queryCollection.mockResolvedValue(mockTransactions);

      const result = await walletService.getPendingTransactions();

      expect(result).toEqual(mockTransactions);
      expect(databaseManager.queryCollection).toHaveBeenCalledWith('transactions', [
        { type: 'where', field: 'status', operator: '==', value: 'pending' },
        { type: 'orderBy', field: 'createdAt', direction: 'asc' }
      ]);
    });

    test('should filter by transaction type', async () => {
      const mockTransactions = [{ id: 'txn1', status: 'pending', type: 'deposit' }];
      databaseManager.queryCollection.mockResolvedValue(mockTransactions);

      const result = await walletService.getPendingTransactions('deposit');

      expect(result).toEqual(mockTransactions);
      expect(databaseManager.queryCollection).toHaveBeenCalledWith('transactions', [
        { type: 'where', field: 'type', operator: '==', value: 'deposit' },
        { type: 'where', field: 'status', operator: '==', value: 'pending' },
        { type: 'orderBy', field: 'createdAt', direction: 'asc' }
      ]);
    });
  });

  describe('onBalanceChanged', () => {
    test('should setup balance change listener', () => {
      const mockCallback = vi.fn();
      const mockUnsubscribe = vi.fn();
      databaseManager.onUserChanged.mockReturnValue(mockUnsubscribe);

      const unsubscribe = walletService.onBalanceChanged(mockUserId, mockCallback);

      expect(unsubscribe).toBe(mockUnsubscribe);
      expect(databaseManager.onUserChanged).toHaveBeenCalledWith(mockUserId, expect.any(Function));
    });

    test('should throw error for missing parameters', () => {
      expect(() => walletService.onBalanceChanged()).toThrow('User ID and callback function are required');
      expect(() => walletService.onBalanceChanged(mockUserId)).toThrow('User ID and callback function are required');
    });
  });

  describe('getTransactionStats', () => {
    test('should return transaction statistics', async () => {
      const mockTransactions = [
        { status: 'completed', type: 'deposit', amount: 500 },
        { status: 'completed', type: 'withdrawal', amount: 200 },
        { status: 'pending', type: 'deposit', amount: 300 },
        { status: 'failed', type: 'withdrawal', amount: 100 }
      ];
      databaseManager.queryCollection.mockResolvedValue(mockTransactions);

      const result = await walletService.getTransactionStats();

      expect(result).toEqual({
        total: 4,
        pending: 1,
        completed: 2,
        failed: 1,
        totalDeposits: 500,
        totalWithdrawals: 200,
        totalFees: 0,
        totalPrizes: 0
      });
    });
  });

  describe('validateTransactionData', () => {
    test('should validate correct transaction data', () => {
      const validData = {
        userId: mockUserId,
        type: 'deposit',
        amount: 500,
        status: 'pending'
      };

      expect(() => walletService.validateTransactionData(validData)).not.toThrow();
    });

    test('should throw error for missing required fields', () => {
      const invalidData = {
        userId: mockUserId,
        type: 'deposit'
        // Missing amount and status
      };

      expect(() => walletService.validateTransactionData(invalidData)).toThrow('Missing required field');
    });

    test('should throw error for invalid transaction type', () => {
      const invalidData = {
        userId: mockUserId,
        type: 'invalid_type',
        amount: 500,
        status: 'pending'
      };

      expect(() => walletService.validateTransactionData(invalidData)).toThrow('Invalid transaction type');
    });

    test('should throw error for invalid amount', () => {
      const invalidData = {
        userId: mockUserId,
        type: 'deposit',
        amount: -100,
        status: 'pending'
      };

      expect(() => walletService.validateTransactionData(invalidData)).toThrow('Amount must be a positive number');
    });
  });
});