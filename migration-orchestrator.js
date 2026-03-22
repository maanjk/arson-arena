// MigrationOrchestrator - Coordinates full platform data migration
// Handles the sequence of migrating users, tournaments, and transactions

import userMigrationManager from './user-migration.js';
import tournamentMigrationManager from './tournament-migration.js';
import transactionMigrationManager from './transaction-migration.js';
import databaseManager from './database-manager.js';

class MigrationOrchestrator {
    constructor() {
        this.isMigrating = false;
        this.migrationSummary = null;
        this.userMapping = {};
    }

    /**
     * Run full migration process
     * @param {boolean} dryRun - Whether to perform a dry run only
     * @returns {Promise<Object>} Migration summary
     */
    async runFullMigration(dryRun = false) {
        if (this.isMigrating) throw new Error('Migration already in progress');

        this.isMigrating = true;
        console.log(`📡 Starting Full Platform Migration [DryRun: ${dryRun}]...`);

        try {
            // 1. Migrate Users
            const userSummary = await userMigrationManager.migrateAllUsers(dryRun);

            // Build user mapping (Username -> UID)
            this.userMapping = {};
            userSummary.results.forEach(res => {
                const username = res.username || res.sanitizedData?.username;
                if (username) {
                    // In dry run, we use a deterministic temp ID if real UID isn't there
                    this.userMapping[username] = res.uid || res.sanitizedData?.uid || `temp_${username.toLowerCase().replace(/\s+/g, '_')}`;
                }
            });

            // 2. Migrate Tournaments
            const tournamentSummary = await tournamentMigrationManager.migrateAllTournaments(dryRun);

            // 3. Migrate Transactions
            const transactionSummary = await transactionMigrationManager.migrateAllTransactions(this.userMapping, dryRun);

            // 4. Process Referral Bonuses
            const referralSummary = dryRun ? { total: 0, processed: 0 } : await transactionMigrationManager.processReferralBonuses(this.userMapping);

            this.migrationSummary = {
                timestamp: new Date().toISOString(),
                dryRun,
                users: {
                    total: userSummary.total,
                    successful: userSummary.successful,
                    failed: userSummary.failed
                },
                tournaments: {
                    total: tournamentSummary.total,
                    successful: tournamentSummary.successful,
                    failed: tournamentSummary.failed
                },
                transactions: {
                    total: transactionSummary.total,
                    successful: transactionSummary.successful,
                    failed: transactionSummary.failed,
                    skipped: transactionSummary.skipped
                },
                referrals: referralSummary,
                backupKey: userSummary.backupKey
            };

            console.log('✅ Full Migration Completed:', this.migrationSummary);

            this.isMigrating = false;
            return this.migrationSummary;

        } catch (error) {
            this.isMigrating = false;
            console.error('❌ Full Migration Failed:', error);
            throw error;
        }
    }

    /**
     * Get current migration status (from localStorage state)
     */
    async checkPlatformStatus() {
        const userStatus = userMigrationManager.getMigrationStatus();
        const tournamentStatus = {
            count: tournamentMigrationManager.getLocalStorageTournaments().length
        };
        const transactionStatus = transactionMigrationManager.getTransactionMigrationStatus();

        return {
            hasLegacyData: userStatus.hasLocalData || tournamentStatus.count > 0 || transactionStatus.hasLocalData,
            details: {
                users: userStatus.totalLocalUsers,
                tournaments: tournamentStatus.count,
                transactions: transactionStatus.totalTransactions,
                referrals: transactionStatus.referralRequests
            }
        };
    }

    /**
     * Safe decommission of localStorage
     * Only run after verification
     */
    async decommissionLocalStorage() {
        const keysToRemove = [
            'battlesaas_users',
            'battlesaas_tournaments',
            'battlesaas_admin_transactions',
            'battlesaas_referral_requests',
            'battlesaas_current_user'
        ];

        keysToRemove.forEach(key => localStorage.removeItem(key));
        console.log('🧹 Legacy localStorage decommissioned');
        return true;
    }
}

const migrationOrchestrator = new MigrationOrchestrator();
if (window.Firebase) window.Firebase.migrationOrchestrator = migrationOrchestrator;
export default migrationOrchestrator;
