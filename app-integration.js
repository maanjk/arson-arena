// App Integration Module - Connects Firebase services to the UI
// Patches the existing index.html functions to persist data to Firestore.

import authManager from './auth-manager.js';
import databaseManager from './database-manager.js';
import tournamentManager from './tournament-manager.js';
import walletService from './wallet-service.js';
import notificationManager from './notification-manager.js';
import { quotaManager } from './firebase-config.js';
import { doc, updateDoc, setDoc, serverTimestamp, increment } from 'firebase/firestore';
import { db } from './firebase-config.js';

class AppIntegration {
  constructor() {
    this.currentUser = null;    // Firebase auth user
    this.firestoreUser = null;  // Firestore user document
    this.listeners = [];

    // Merge with existing Firebase object if it exists (from firebase-init.js)
    window.Firebase = {
      ...(window.Firebase || {}),
      authManager,
      databaseManager,
      tournamentManager,
      walletService,
      notificationManager,
      quotaManager
    };

    // Wait for DOM inline script to finish defining window functions,
    // then patch them to also write to Firebase.
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.init());
    } else {
      this.init();
    }
  }

  // Helper to ensure input is a valid email for Firebase Auth
  ensureEmail(input) {
    if (!input) return '';
    if (input.includes('@')) return input.toLowerCase();
    // For "username-only" UX, we append a virtual domain
    return `${input.toLowerCase().replace(/[^a-z0-0]/g, '')}@arson-arena.com`;
  }

  async init() {
    try {
      console.log('🚀 [AppIntegration] Initializing Firebase integration...');

      // Wait for Firebase Auth to determine login state
      await authManager.waitForAuth();

      // Listen to auth changes and sync UI
      authManager.onAuthStateChanged((user) => {
        this.handleAuthStateChange(user);
      });

      // Initialize notification system (non-blocking)
      notificationManager.init().catch(e => console.warn('Notifications init failed:', e));

      // Patch window functions AFTER DOM script has run
      this.patchWindowFunctions();

      console.log('✅ [AppIntegration] Ready');

      window.dispatchEvent(new CustomEvent('firebase-ready', { detail: { success: true } }));

    } catch (error) {
      console.error('❌ [AppIntegration] Init failed:', error);
    }
  }

  // ─── AUTH STATE ────────────────────────────────────────────────────────────

  async handleAuthStateChange(user) {
    this.currentUser = user;

    if (user) {
      console.log('👤 Firebase user signed in:', user.email);

      // Initialize local state for logged in user immediately
      if (window.state) {
        console.log('📦 [AppIntegration] window.state found, syncing user...');
        window.state.user.loggedIn = true;
        window.state.user.firebaseUid = user.uid;
        window.state.user.name = user.displayName || user.email.split('@')[0];
        window.state.user.email = user.email;

        if (window.updateUserUI) {
          console.log('🎨 [AppIntegration] Calling window.updateUserUI...');
          window.updateUserUI();
        } else {
          console.warn('⚠️ [AppIntegration] window.updateUserUI NOT FOUND');
        }

        // Auto-redirect to dashboard if on landing page
        if (window.switchView) {
          const currentView = document.querySelector('.app-view.active')?.id;
          if (currentView === 'view-landing' || !currentView) {
            console.log('🚀 [AppIntegration] Auto-redirecting to dashboard...');
            window.switchView('dashboard');
          }
        }
      } else {
        console.warn('⚠️ [AppIntegration] window.state NOT FOUND');
      }

      try {
        const userData = await databaseManager.getUser(user.uid);
        this.firestoreUser = userData;

        if (userData && window.state) {
          console.log('📄 [AppIntegration] Firestore user data found, syncing...', userData);

          // If referral code is missing, generate one
          let refCode = userData.referralCode;
          if (!refCode) {
            refCode = (userData.username || userData.email.split('@')[0]).toUpperCase() + Math.floor(Math.random() * 1000);
            updateDoc(doc(db, 'users', user.uid), { referralCode: refCode });
          }

          // Sync Firestore data into the app state object
          window.state.user = {
            ...window.state.user,
            loggedIn: true,
            name: userData.username || window.state.user.name,
            coins: userData.coins ?? window.state.user.coins,
            xp: userData.xp ?? window.state.user.xp,
            level: userData.level ?? window.state.user.level,
            refCode: refCode,
            isAdmin: userData.isAdmin || false,
            uids: {
              pubg: userData.gameUids?.pubg || window.state.user.uids?.pubg || '',
              ff: userData.gameUids?.freefire || window.state.user.uids?.ff || ''
            },
            joinedIds: userData.joinedTournaments || window.state.user.joinedIds || []
          };

          // Show admin link if applicable
          const adminLink = document.getElementById('nav-admin-link');
          if (adminLink) {
            if (userData.isAdmin) adminLink.classList.remove('hidden');
            else adminLink.classList.add('hidden');
          }

          if (window.updateUserUI) {
            console.log('🎨 [AppIntegration] Calling window.updateUserUI after Firestore sync...');
            window.updateUserUI();
          }
          if (window.updateBalanceUI) window.updateBalanceUI();
          if (window.checkUidsState) window.checkUidsState();
          if (window.checkDailyReward) window.checkDailyReward();
        } else {
          console.log('ℹ️ [AppIntegration] No Firestore user data or window.state missing', { hasUserData: !!userData, hasState: !!window.state });
        }
      } catch (err) {
        console.warn('⚠️ Could not load Firestore user data:', err.message);
      }

      // Set up real-time listeners
      this.setupRealtimeListeners(user.uid);

    } else {
      console.log('👤 Firebase user signed out');
      this.firestoreUser = null;
      this.cleanupListeners();

      if (window.state) {
        window.state.user.loggedIn = false;
        if (window.updateUserUI) window.updateUserUI();
      }
    }
  }

  // ─── REAL-TIME LISTENERS ────────────────────────────────────────────────────

  setupRealtimeListeners(userId) {
    this.cleanupListeners();

    // Live balance / profile updates
    const userListener = databaseManager.onUserChanged(userId, (userData) => {
      if (!userData || !window.state?.user?.loggedIn) return;
      this.firestoreUser = userData;
      window.state.user.coins = userData.coins ?? window.state.user.coins;
      window.state.user.xp = userData.xp ?? window.state.user.xp;
      window.state.user.level = userData.level ?? window.state.user.level;
      window.state.user.uids = {
        pubg: userData.gameUids?.pubg || '',
        ff: userData.gameUids?.freefire || ''
      };
      if (window.updateBalanceUI) window.updateBalanceUI();
      if (window.updateXPUI) window.updateXPUI();
      if (window.checkUidsState) window.checkUidsState();
    });
    this.listeners.push(userListener);

    // Live tournament updates
    const tournamentListener = databaseManager.onTournamentsChanged((tournaments) => {
      if (!window.state) return;
      // Merge live Firestore data with the local state format
      const firestoreTournaments = tournaments.map(t => ({
        id: t.id,
        title: t.title,
        game: t.game,
        map: t.map || 'Erangel',
        type: t.type,
        fee: t.entryFee || 0,
        prize: t.prizePool || 'TBD',
        players: t.currentParticipants || 0,
        max: t.maxParticipants || 100,
        date: t.startTime ? new Date(t.startTime.toDate()).toLocaleString() : 'TBD',
        xpReward: 50,
        participants: t.participants || [],
        img: t.imageUrl || 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=800',
        status: t.status || 'pending',
        roomId: t.roomDetails?.roomId || '',
        roomPass: t.roomDetails?.password || ''
      }));

      if (firestoreTournaments.length > 0) {
        window.state.tournaments = firestoreTournaments;
        if (window.renderTournaments) window.renderTournaments();
      }
    });
    this.listeners.push(tournamentListener);

    // Live transaction history
    const txListener = databaseManager.onTransactionsChanged((transactions) => {
      if (!window.state?.user?.loggedIn || !transactions) return;
      window.state.user.transactions = transactions.map(t => ({
        desc: t.details?.tournamentTitle || t.details?.description || t.type,
        amount: t.amount > 0 ? `+${t.amount}` : `${t.amount}`,
        date: t.createdAt ? new Date(t.createdAt.toDate()).toLocaleString() : 'Just now'
      }));
      if (window.renderTransactions) window.renderTransactions();
    }, userId);
    this.listeners.push(txListener);

    // Live leaderboard (all users)
    const usersListener = databaseManager.setupRealtimeListener('users', (users) => {
      if (!window.state || !users) return;
      console.log('🏆 [AppIntegration] Leaderboard data updated');
      window.state.users = users.map(u => ({
        name: u.username,
        coins: u.coins || 0,
        xp: u.xp || 0,
        level: u.level || 1,
        avatar: u.avatar || 'default',
        uids: u.gameUids || { pubg: '', ff: '' }
      }));
      if (window.renderLeaderboard) window.renderLeaderboard();
    }, [{ type: 'orderBy', field: 'xp', direction: 'desc' }, { type: 'limit', value: 100 }]);
    this.listeners.push(usersListener);
  }

  cleanupListeners() {
    this.listeners.forEach(unsub => { if (typeof unsub === 'function') unsub(); });
    this.listeners = [];
  }

  // ─── PATCH WINDOW FUNCTIONS ─────────────────────────────────────────────────

  patchWindowFunctions() {
    // ── saveUserProgress ─────────────────────────────────────────────────────
    window.saveUserProgress = async () => {
      if (!this.currentUser) return;
      try {
        await updateDoc(doc(db, 'users', this.currentUser.uid), {
          coins: window.state.user.coins,
          xp: window.state.user.xp,
          level: window.state.user.level,
          lastLogin: window.state.user.lastLogin || serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        quotaManager.trackWrite(1);
      } catch (err) {
        console.error('❌ saveUserProgress failed:', err);
      }
    };

    // ── handleAuth ──────────────────────────────────────────────────────────
    const _handleAuth = window.handleAuth?.bind(window);
    window.handleAuth = async (e) => {
      e.preventDefault();
      const loginStr = document.getElementById('auth-username')?.value?.trim();
      const password = document.querySelector('#auth-modal input[type="password"]')?.value;
      const referralCode = document.getElementById('auth-referral')?.value?.trim();

      if (!loginStr || !password) {
        window.showToast?.('Please enter email and password', 'error');
        return;
      }

      this.setLoading(true);
      const email = this.ensureEmail(loginStr);
      const username = loginStr.includes('@') ? loginStr.split('@')[0] : loginStr;

      try {
        console.log(`🔐 Attempting Firebase Auth for: ${email}`);

        try {
          // 1. Try to sign in first
          await authManager.signIn(email, password);
          window.showToast?.('Welcome back! 🎮', 'success');
        } catch (signInErr) {
          // 2. If user doesn't exist, try to sign up
          if (signInErr.message.includes('auth/user-not-found') ||
            signInErr.message.toLowerCase().includes('no account found') ||
            signInErr.code === 'auth/user-not-found' ||
            signInErr.code === 'auth/invalid-credential') {

            console.log('🌟 Creating new account...');
            try {
              await authManager.signUp(email, password, username, referralCode);
              window.showToast?.('Account created! Welcome to the Arena 🔥', 'success');
            } catch (signUpErr) {
              // If the email ALREADY EXISTS but the user typed wrong password:
              if (signUpErr.code === 'auth/email-already-in-use') {
                throw new Error('Incorrect password for this username. Please try again.');
              }
              throw signUpErr;
            }
          } else {
            // Re-throw if it's a real error like wrong-password
            throw signInErr;
          }
        }

        document.getElementById('auth-modal')?.classList.add('hidden');
        if (window.updateUserUI) window.updateUserUI();
        window.switchView?.('dashboard');
      } catch (err) {
        console.error('❌ Firebase Auth failed:', err);
        window.showToast?.(err.message, 'error');

        // FALLBACK: If Firebase specifically fails to connect, allow local-only login for demo.
        // But if it's a known auth error like "wrong password", don't fall back!
        const isAuthError = err.message.includes('password') || err.message.includes('account');
        if (!isAuthError && _handleAuth) {
          console.warn('⚠️ Falling back to LocalStorage auth...');
          try { _handleAuth(e); } catch (f) { console.error(f); }
        }
      } finally {
        this.setLoading(false);
      }
    };

    // ── handleLogout ─────────────────────────────────────────────────────────
    window.handleLogout = async () => {
      this.setLoading(true);
      try {
        await authManager.signOut();
        window.state.user = { loggedIn: false, name: '', coins: 0, xp: 0, level: 1, transactions: [], refCode: '', joinedIds: [], lastLogin: null, uids: { pubg: '', ff: '' } };
        window.switchView?.('landing');
        document.getElementById('nav-guest')?.classList.remove('hidden');
        document.getElementById('nav-user')?.classList.add('hidden');
        window.showToast?.('Signed out successfully', 'success');
      } catch (err) {
        window.showToast?.(err.message, 'error');
      } finally {
        this.setLoading(false);
      }
    };

    // ── saveUid ──────────────────────────────────────────────────────────────
    const _saveUid = window.saveUid?.bind(window);
    window.saveUid = async (game) => {
      const btn = document.getElementById(game === 'pubg' ? 'btn-save-pubg' : 'btn-save-ff');
      const inputId = game === 'pubg' ? 'uid-pubg' : 'uid-ff';
      const input = document.getElementById(inputId);
      const val = input?.value?.trim();

      // EDIT TOGGLE: If button says EDIT, it means the field is locked. Unlock it.
      if (btn && btn.innerText === 'EDIT') {
        input.disabled = false;
        input.focus();
        btn.innerText = 'SAVE';
        btn.classList.add('bg-ios-green', 'text-black');
        btn.classList.remove('bg-white/10', 'text-white');
        return;
      }

      if (!val || val.length < 5) {
        window.showToast?.('Invalid UID – must be at least 5 characters', 'error');
        return;
      }

      if (!this.currentUser) {
        // Not logged in with Firebase – use local mode
        if (_saveUid) { _saveUid(game); return; }
        return;
      }

      this.setLoading(true);
      try {
        const currentUid = game === 'pubg' ? window.state.user.uids.pubg : window.state.user.uids.ff;

        // Don't charge if saving the EXACT same value
        if (currentUid === val) {
          window.showToast?.('UID is already saved', 'info');
          if (window.checkUidsState) window.checkUidsState();
          this.setLoading(false);
          return;
        }

        const isChanging = !!currentUid;
        const cost = isChanging ? 100 : 0;

        if (cost > 0 && (window.state.user.coins < cost)) {
          window.showToast?.(`Need ${cost} Coins to change UID!`, 'error');
          this.setLoading(false);
          return;
        }

        // Build the partial update
        const gameKey = game === 'pubg' ? 'pubg' : 'freefire';
        const updates = {
          [`gameUids.${gameKey}`]: val,
          updatedAt: serverTimestamp()
        };

        if (cost > 0) {
          updates['coins'] = (this.firestoreUser?.coins || window.state.user.coins) - cost;
        }

        // CRITICAL: use updateDoc for dot-notation nested updates!
        await updateDoc(doc(db, 'users', this.currentUser.uid), updates);
        quotaManager.trackWrite(1);

        // Record fee transaction in Firestore
        if (cost > 0) {
          await databaseManager.createTransaction({
            userId: this.currentUser.uid,
            type: 'uid_change',
            amount: -cost,
            status: 'completed',
            details: { description: `${game.toUpperCase()} UID Change` }
          });
          window.state.user.coins -= cost;
          if (window.updateBalanceUI) window.updateBalanceUI();
        }

        // Update local state
        window.state.user.uids[game] = val;
        if (window.checkUidsState) window.checkUidsState();
        window.showToast?.(`${game.toUpperCase()} UID saved ✅`, 'success');

      } catch (err) {
        console.error('❌ saveUid failed:', err);
        window.showToast?.(err.message, 'error');
      } finally {
        this.setLoading(false);
      }
    };

    // ── confirmJoin ──────────────────────────────────────────────────────────
    const _confirmJoin = window.confirmJoin?.bind(window);
    window.confirmJoin = async () => {
      const t = window.state?.tournaments?.find(x => String(x.id) === String(window.state.currentTournamentId));
      if (!t) { window.showToast?.('Tournament not found', 'error'); return; }

      // UID check
      const needsPUBG = t.game === 'PUBG Mobile' && !window.state.user.uids?.pubg;
      const needsFF = t.game === 'FreeFire' && !window.state.user.uids?.ff;
      if (needsPUBG || needsFF) {
        document.getElementById('uid-warning')?.classList.remove('hidden');
        window.showToast?.(`Set your ${t.game} UID in Profile first!`, 'error');
        return;
      }

      const joinedIds = Array.isArray(window.state.user.joinedIds) ? window.state.user.joinedIds : [];
      if (joinedIds.includes(t.id)) return;

      if (window.state.user.coins < t.fee) {
        window.showToast?.('Insufficient Balance!', 'error');
        return;
      }

      if (!this.currentUser) {
        // Local-only mode
        if (_confirmJoin) { _confirmJoin(); return; }
        return;
      }

      this.setLoading(true);
      try {
        const userInfo = {
          username: window.state.user.name,
          avatar: '',
          gameUids: {
            pubgmobile: window.state.user.uids?.pubg || '',
            freefire: window.state.user.uids?.ff || ''
          }
        };

        await tournamentManager.joinTournament(t.id, this.currentUser.uid, userInfo);

        // XP reward - update locally and in Firestore
        const newXP = (this.firestoreUser?.xp || window.state.user.xp || 0) + (t.xpReward || 50);
        let newLevel = window.state.user.level;
        let leveledUp = false;
        let totalXPNeeded = 0;
        for (let i = 1; i <= newLevel; i++) totalXPNeeded += (100 + (i * 50));
        if (newXP >= totalXPNeeded) { newLevel++; leveledUp = true; }

        await setDoc(doc(db, 'users', this.currentUser.uid), {
          xp: newXP,
          level: newLevel,
          joinedTournaments: [...(this.firestoreUser?.joinedTournaments || []), t.id]
        }, { merge: true });
        quotaManager.trackWrite(1);


        // Update local state
        window.state.user.coins -= t.fee;
        window.state.user.xp = newXP;
        window.state.user.level = newLevel;
        const joinedIds = Array.isArray(window.state.user.joinedIds) ? window.state.user.joinedIds : [];
        window.state.user.joinedIds = [...joinedIds, t.id];
        t.players = (t.players || 0) + 1;

        if (window.updateBalanceUI) window.updateBalanceUI();
        if (window.updateXPUI) window.updateXPUI();
        if (window.renderTournaments) window.renderTournaments();
        if (window.openTournamentModal) window.openTournamentModal(t.id);

        let msg = `Joined ${t.title}! +${t.xpReward || 50} XP 🎮`;
        if (leveledUp) msg += ` Level Up! Now Level ${newLevel} 🚀`;
        window.showToast?.(msg, 'success');

      } catch (err) {
        console.error('❌ confirmJoin failed:', err);
        const errorMsg = err.message || 'An unknown error occurred';
        window.showToast?.(`Error: ${errorMsg}`, 'error');
      } finally {
        this.setLoading(false);
      }
    };

    // ── handleDeposit ─────────────────────────────────────────────────────────
    const _handleDeposit = window.handleDeposit?.bind(window);
    window.handleDeposit = async (e) => {
      e.preventDefault();
      if (!this.currentUser) {
        window.showToast?.('Please sign in first', 'error');
        return;
      }

      const amount = parseFloat(document.getElementById('deposit-amount')?.value);
      const method = document.getElementById('deposit-method')?.value;
      const transactionId = document.getElementById('deposit-trx')?.value?.trim();

      if (!amount || !method || !transactionId) {
        window.showToast?.('Please fill in all fields', 'error');
        return;
      }

      this.setLoading(true);
      try {
        await walletService.createDepositRequest(this.currentUser.uid, amount, method, transactionId);
        document.getElementById('modal-deposit')?.classList.add('hidden');
        e.target.reset();
        window.showToast?.('Deposit request submitted! Admin will verify shortly. ✅', 'success');
      } catch (err) {
        window.showToast?.(err.message, 'error');
      } finally {
        this.setLoading(false);
      }
    };

    // ── handleWithdraw ────────────────────────────────────────────────────────
    const _handleWithdraw = window.handleWithdraw?.bind(window);
    window.handleWithdraw = async (e) => {
      e.preventDefault();
      if (!this.currentUser) {
        window.showToast?.('Please sign in first', 'error');
        return;
      }

      const amount = parseFloat(document.getElementById('withdraw-amount')?.value);
      const method = document.getElementById('withdraw-method')?.value;
      const accountNumber = document.getElementById('withdraw-number')?.value?.trim();

      if (!amount || !method || !accountNumber) {
        window.showToast?.('Please fill in all fields', 'error');
        return;
      }

      this.setLoading(true);
      try {
        await walletService.createWithdrawalRequest(this.currentUser.uid, amount, method, accountNumber);
        document.getElementById('modal-withdraw')?.classList.add('hidden');
        e.target.reset();
        window.showToast?.('Withdrawal request submitted! ✅', 'success');
      } catch (err) {
        window.showToast?.(err.message, 'error');
      } finally {
        this.setLoading(false);
      }
    };

    console.log('🔗 [AppIntegration] Window functions patched');
  }

  // ─── UTILITIES ──────────────────────────────────────────────────────────────

  setLoading(active) {
    const overlay = document.getElementById('loading-overlay');
    if (!overlay) return;
    if (active) overlay.classList.add('active');
    else overlay.classList.remove('active');
  }

  isAuthenticated() { return !!this.currentUser; }
  getCurrentUser() { return this.currentUser; }
  getQuotaStatus() { return quotaManager.getQuotaStatus(); }
}

// Create singleton and expose globally
const appIntegration = new AppIntegration();
export default appIntegration;
window.AppIntegration = appIntegration;
