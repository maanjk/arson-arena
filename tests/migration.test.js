import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock Firebase Config and Messaging early to prevent initialization errors in transitive imports
vi.mock('../firebase-config.js', () => ({
    auth: { currentUser: { uid: 'admin' } },
    db: {},
    messaging: null,
    analytics: null,
    withRetry: vi.fn(fn => fn())
}));

vi.mock('firebase/messaging', () => ({
    getMessaging: vi.fn(),
    getToken: vi.fn(),
    onMessage: vi.fn()
}));

import migrationOrchestrator from '../migration-orchestrator.js';
import userMigrationManager from '../user-migration.js';
import tournamentMigrationManager from '../tournament-migration.js';
import transactionMigrationManager from '../transaction-migration.js';

// Mock Migration Managers
vi.mock('../user-migration.js', () => ({
    default: {
        migrateAllUsers: vi.fn(),
        getMigrationStatus: vi.fn()
    }
}));

vi.mock('../tournament-migration.js', () => ({
    default: {
        migrateAllTournaments: vi.fn(),
        getLocalStorageTournaments: vi.fn(() => [])
    }
}));

vi.mock('../transaction-migration.js', () => ({
    default: {
        migrateAllTransactions: vi.fn(),
        processReferralBonuses: vi.fn(),
        getTransactionMigrationStatus: vi.fn()
    }
}));

describe('MigrationOrchestrator', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        migrationOrchestrator.isMigrating = false;
        migrationOrchestrator.userMapping = {};
    });

    it('should run a full migration successfully', async () => {
        userMigrationManager.migrateAllUsers.mockResolvedValue({
            total: 2,
            successful: 2,
            failed: 0,
            backupKey: 'backup_123',
            results: [
                { username: 'user1', uid: 'uid1' },
                { username: 'user2', uid: 'uid2' }
            ]
        });

        tournamentMigrationManager.migrateAllTournaments.mockResolvedValue({
            total: 1,
            successful: 1,
            failed: 0
        });

        transactionMigrationManager.migrateAllTransactions.mockResolvedValue({
            total: 5,
            successful: 5,
            failed: 0,
            skipped: 0
        });

        transactionMigrationManager.processReferralBonuses.mockResolvedValue({
            total: 1,
            processed: 1
        });

        const summary = await migrationOrchestrator.runFullMigration(false);

        expect(summary.users.successful).toBe(2);
        expect(summary.tournaments.successful).toBe(1);
        expect(summary.transactions.successful).toBe(5);
    });

    it('should report platform status correctly', async () => {
        userMigrationManager.getMigrationStatus.mockReturnValue({ hasLocalData: true, totalLocalUsers: 10 });
        transactionMigrationManager.getTransactionMigrationStatus.mockReturnValue({ hasLocalData: false, totalTransactions: 0 });

        const status = await migrationOrchestrator.checkPlatformStatus();

        expect(status.hasLegacyData).toBe(true);
        expect(status.details.users).toBe(10);
    });
});
