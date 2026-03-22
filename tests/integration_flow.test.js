
import { describe, it, expect, beforeAll } from 'vitest';
import authManager from '../auth-manager.js';
import databaseManager from '../database-manager.js';
import tournamentManager from '../tournament-manager.js';
import walletService from '../wallet-service.js';
import { db, auth } from '../firebase-config.js';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';

describe('End-to-End Firebase Integration Flow', () => {
    const testEmail = `tester-${Date.now()}@arson.com`;
    const testPassword = 'Password123!';
    const testUsername = 'IntegrationTester';
    let userUid = '';

    it('Step 1: User Registration', async () => {
        console.log('📝 Registering user:', testEmail);
        const { user, userData } = await authManager.signUp(testEmail, testPassword, testUsername);
        userUid = user.uid;

        expect(userUid).toBeDefined();
        expect(userData.username).toBe(testUsername);

        // Verify Firestore
        const userDoc = await getDoc(doc(db, 'users', userUid));
        expect(userDoc.exists()).toBe(true);
        expect(userDoc.data().email).toBe(testEmail);
        console.log('✅ Registration saved in Firestore');
    });

    it('Step 2: Save Game UID', async () => {
        console.log('🎮 Saving PUBG UID for user:', userUid);
        const pubgUid = 'PUBG-999-E2E';

        // Using the same logic as app-integration.js/saveUid
        await authManager.updateProfile({
            gameUids: {
                pubg: pubgUid,
                freefire: ''
            }
        });

        // Verify Firestore
        const userDoc = await getDoc(doc(db, 'users', userUid));
        expect(userDoc.data().gameUids.pubg).toBe(pubgUid);
        console.log('✅ Game UID saved in Firestore');
    });

    it('Step 3: Deposit & Admin Approval', async () => {
        console.log('💰 Simulating deposit and approval');
        const depositAmount = 1000;
        const tid = 'TID-Integration-Test';

        const txnId = await walletService.createDepositRequest(userUid, depositAmount, 'easypaisa', tid);
        expect(txnId).toBeDefined();

        // Verify Pending Transaction
        const txnDoc = await getDoc(doc(db, 'transactions', txnId));
        expect(txnDoc.data().status).toBe('pending');
        expect(txnDoc.data().amount).toBe(depositAmount);

        // Simulate Admin Approval
        await walletService.processDeposit(txnId, 'admin-123', true, 'Test Approval');

        // Verify Balance Update
        const userDoc = await getDoc(doc(db, 'users', userUid));
        expect(userDoc.data().coins).toBe(depositAmount);

        // Verify Transaction Status
        const txnDocUpdated = await getDoc(doc(db, 'transactions', txnId));
        expect(txnDocUpdated.data().status).toBe('completed');
        console.log('✅ Deposit and Approval persisted correctly');
    });

    it('Step 4: Create & Join Tournament', async () => {
        console.log('🏆 Joining tournament');

        // 4.1 Create a dummy tournament
        const tId = `t-test-${Date.now()}`;
        const tournamentData = {
            title: 'E2E Test Tournament',
            game: 'PUBG Mobile',
            type: 'solo',
            entryFee: 100,
            prizePool: '500 Coins',
            startTime: new Date(Date.now() + 86400000).toISOString(),
            createdBy: 'admin-123'
        };

        // We use setDoc directly to avoid validation logic in createTournament if needed, 
        // but tournamentManager.createTournament is better.
        // However, createTournament generates its own ID, let's just use it.
        const createdId = await tournamentManager.createTournament(tournamentData);

        // 4.2 Join the tournament
        const userInfo = {
            username: testUsername,
            gameUids: {
                pubgmobile: 'PUBG-999-E2E'
            }
        };

        await tournamentManager.joinTournament(createdId, userUid, userInfo);

        // Verify Tournament Document
        const tDoc = await getDoc(doc(db, 'tournaments', createdId));
        expect(tDoc.data().participants).toContain(userUid);
        expect(tDoc.data().currentParticipants).toBe(1);

        // Verify User Document
        const userDoc = await getDoc(doc(db, 'users', userUid));
        expect(userDoc.data().coins).toBe(900); // 1000 - 100 fee

        console.log('✅ Tournament joining persisted and balance deducted');
    });
});
