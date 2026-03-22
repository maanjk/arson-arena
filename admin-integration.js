// Admin Integration Module - Connects Firebase services to the Admin UI
// This module bridges the gap between Firebase managers and the admin.html dashboard

import authManager from './auth-manager.js';
import databaseManager from './database-manager.js';
import tournamentManager from './tournament-manager.js';
import notificationManager from './notification-manager.js';
import walletService from './wallet-service.js';
import migrationOrchestrator from './migration-orchestrator.js';
import quotaManagementSystem from './quota-manager.js';
import { db, quotaManager, withRetry } from './firebase-config.js';
import {
  doc,
  runTransaction,
  serverTimestamp,
  increment
} from 'firebase/firestore';

/**
 * AdminIntegration - Main integration class for the admin panel
 */
class AdminIntegration {
  constructor() {
    this.isInitialized = false;
    this.isAdmin = false;
    this.listeners = [];

    // Data cache for real-time updates
    this.state = {
      users: [],
      tournaments: [],
      deposits: [],
      withdrawals: [],
      referrals: [],
      announcements: [],
      status: null,
      migration: null
    };

    // Expose managers globally
    window.AdminFirebase = {
      authManager,
      databaseManager,
      tournamentManager,
      notificationManager,
      walletService,
      quotaManager,
      migrationOrchestrator,
      quotaManagementSystem
    };

    console.log(`🚀 [v1.0.7] Admin Integration starting... (Build: ${new Date().toLocaleTimeString()})`);

    // Setup UI Overrides immediately so global handlers are available
    this.setupUIOverrides();

    this.init();
  }

  /**
   * Initialize the admin integration
   */
  async init() {
    try {
      console.log('🛡️ Initializing ARSON Arena Admin Integration...');

      // Wait for auth initialization
      await authManager.waitForAuth();

      // Setup auth state listener
      authManager.onAuthStateChanged(async (user) => {
        if (user) {
          this.setLoading(true);
          try {
            // Check for admin privileges
            const userData = await databaseManager.getUser(user.uid);
            if (user.email === 'admin@arson.com' || (userData && userData.isAdmin)) {
              this.isAdmin = true;
              this.handleAdminAuthenticated();
            } else {
              this.isAdmin = false;
              console.warn('⚠️ Access denied: Not an administrator');
              if (window.showToast) window.showToast('Access denied: Admin privileges required', 'error');
              await authManager.signOut();
            }
          } finally {
            this.setLoading(false);
          }
        } else {
          this.isAdmin = false;
          this.handleAdminSignedOut();
        }
      });

      // UI Overrides were already setup in constructor

      this.isInitialized = true;
      console.log('✅ Admin integration initialized');
    } catch (error) {
      console.error('❌ Admin integration failed:', error);
    }
  }

  /**
   * Handle successful admin authentication
   */
  handleAdminAuthenticated() {
    console.log('🔓 Admin access granted');

    // Hide login screen, show dashboard
    const loginScreen = document.getElementById('admin-login');
    const dashboard = document.getElementById('admin-dashboard');
    if (loginScreen) loginScreen.classList.add('hidden');
    if (dashboard) dashboard.classList.remove('hidden');

    // Setup real-time listeners for admin collections
    this.setupAdminListeners();

    // Default view
    if (window.switchTab) window.switchTab('users');
  }

  /**
   * Handle admin sign out
   */
  handleAdminSignedOut() {
    this.cleanupListeners();
    const loginScreen = document.getElementById('admin-login');
    const dashboard = document.getElementById('admin-dashboard');
    if (loginScreen) loginScreen.classList.remove('hidden');
    if (dashboard) dashboard.classList.add('hidden');

    // Reset forms if any
    if (window.resetForm) window.resetForm();
    if (window.resetAnnouncementForm) window.resetAnnouncementForm();
  }

  /**
   * Setup real-time listeners for all admin data
   */
  setupAdminListeners() {
    this.cleanupListeners();
    console.log('🔗 Setting up admin real-time listeners...');

    // 1. Immediate Status Update (Most important for the user right now)
    try {
      console.log('📊 Requesting initial system status...');
      this.updateStatus();
    } catch (e) {
      console.error('⚠️ Critical: Initial status update failed:', e);
    }

    // 2. Setup listeners with individual try-catch blocks to prevent one failure from blocking others

    // Users
    try {
      const usersUnsubscribe = databaseManager.onAllUsersChanged((users) => {
        if (!users) return;
        this.state.users = users;
        if (window.renderAdminUsers) window.renderAdminUsers();
      });
      this.listeners.push(usersUnsubscribe);
    } catch (e) { console.error('❌ User listener setup failed:', e); }

    // Tournaments
    try {
      const tournamentsUnsubscribe = databaseManager.onTournamentsChanged((tournaments) => {
        if (!tournaments) return;
        this.state.tournaments = tournaments;
        if (window.renderAdminTournaments) window.renderAdminTournaments();
      });
      this.listeners.push(tournamentsUnsubscribe);
    } catch (e) { console.error('❌ Tournament listener setup failed:', e); }

    // Transactions
    try {
      const txsUnsubscribe = databaseManager.onAllTransactionsChanged((txs) => {
        if (!txs) return;
        this.state.deposits = txs.filter(t => t.type === 'deposit');
        this.state.withdrawals = txs.filter(t => t.type === 'withdrawal');
        if (typeof window.renderAdminDeposits === 'function') window.renderAdminDeposits();
        if (typeof window.renderAdminWithdrawals === 'function') window.renderAdminWithdrawals();
      });
      this.listeners.push(txsUnsubscribe);
    } catch (e) { console.error('❌ Transaction listener setup failed:', e); }

    // Announcements (Suspected of hanging)
    try {
      console.log('📢 Setting up announcement listener...');
      const announcementsUnsubscribe = notificationManager.onAnnouncementsChanged((announcements) => {
        if (!announcements) return;
        this.state.announcements = announcements;
        if (window.renderAdminAnnouncements) window.renderAdminAnnouncements();
      });
      this.listeners.push(announcementsUnsubscribe);
      console.log('✅ Announcement listener setup done');
    } catch (e) { console.error('❌ Announcement listener setup failed:', e); }

    // Status update interval
    const statusInterval = setInterval(() => this.updateStatus(), 30000);
    this.listeners.push(() => clearInterval(statusInterval));

    console.log('🏁 Admin Dashboard fully synchronized.');
  }

  updateStatus() {
    try {
      console.log('📊 Refreshing system status...');
      if (quotaManagementSystem) {
        this.state.status = quotaManagementSystem.generateUsageReport();
        console.log('📊 System status updated:', this.state.status);
      } else {
        throw new Error('Quota system not available');
      }
    } catch (error) {
      console.warn('⚠️ Using fallback status:', error.message);
      // Minimal fallback status so the UI doesn't hang
      this.state.status = {
        timestamp: new Date().toISOString(),
        quotaStatus: {
          reads: { used: 0, limit: 50000, percentage: 0 },
          writes: { used: 0, limit: 20000, percentage: 0 },
          deletes: { used: 0, limit: 20000, percentage: 0 }
        },
        recommendations: [{ action: "Platform is running normally.", impact: "Status system in fallback mode." }],
        fallbacksActive: {},
        optimizationLevel: 'normal'
      };
    } finally {
      if (window.renderSystemStatus) {
        console.log('🎨 Rendering system status UI...');
        window.renderSystemStatus();
      }
    }
  }

  /**
   * Cleanup listeners
   */
  cleanupListeners() {
    this.listeners.forEach(unsubscribe => unsubscribe());
    this.listeners = [];
  }

  /**
   * Set global loading state
   */
  setLoading(active) {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
      if (active) overlay.classList.add('active');
      else overlay.classList.remove('active');
    }
  }

  /**
   * Helper to handle async operations with loading state and error handling
   */
  async handleAsync(fn, successMsg = null, errorMsg = null) {
    this.setLoading(true);
    try {
      const result = await fn();
      if (successMsg && window.showToast) window.showToast(successMsg, 'success');
      return result;
    } catch (error) {
      console.error('❌ Admin operation failed:', error);
      if (window.showToast) window.showToast(errorMsg || error.message, 'error');
      throw error;
    } finally {
      this.setLoading(false);
    }
  }

  /**
   * Override admin.html global functions to use Firebase
   */
  setupUIOverrides() {
    this.overrideAuth();
    this.overrideTournamentLogic();
    this.overrideFinancialLogic();
    this.overrideUserLogic();
    this.overrideAnnouncementLogic();
    this.overrideSystemStatusLogic();
    this.overrideReferralLogic();
    this.overrideLeaderboardLogic();
  }

  overrideAuth() {
    window.handleLogin = async (e) => {
      e.preventDefault();
      const email = document.getElementById('admin-user').value;
      const pass = document.getElementById('admin-pass').value;

      console.log('🔑 Attempting admin login for:', email);

      await this.handleAsync(async () => {
        await authManager.signIn(email, pass);
      });
    };
  }

  overrideUserLogic() {
    window.renderAdminUsers = () => {
      const list = document.getElementById('admin-users-list');
      const search = document.getElementById('search-user')?.value.toLowerCase() || '';
      if (!list) return;

      list.innerHTML = '';
      this.state.users.forEach(u => {
        if (search && !u.username?.toLowerCase().includes(search) && !u.email?.toLowerCase().includes(search)) return;

        const div = document.createElement('div');
        div.className = 'p-4 hover:bg-white/5';
        div.innerHTML = `
          <div class="flex justify-between items-start">
            <div class="flex items-center gap-3">
              <img src="https://api.dicebear.com/7.x/notionists/svg?seed=${u.username || u.email}" class="w-10 h-10 rounded-full bg-white/10">
              <div>
                <p class="font-bold text-white">${u.username || u.email}</p>
                <p class="text-xs text-ios-subtext">Lvl ${u.level || 1} • ${u.xp || 0} XP</p>
                <div class="flex gap-2 mt-1">
                  <span class="text-[10px] px-1.5 py-0.5 rounded bg-ios-blue/20 text-ios-blue font-mono">${u.gameUids?.pubg || 'No PUBG'}</span>
                  <span class="text-[10px] px-1.5 py-0.5 rounded bg-ios-orange/20 text-ios-orange font-mono">${u.gameUids?.freefire || 'No FF'}</span>
                </div>
              </div>
            </div>
            <div class="text-right">
              <p class="font-bold text-ios-green text-lg">${u.coins || 0} Coins</p>
            </div>
          </div>
        `;
        list.appendChild(div);
      });
    };

    window.renderAdminLeaderboard = (type) => {
      const list = document.getElementById('admin-leaderboard-list');
      if (!list) return;

      const tE = document.getElementById('admin-tab-earnings');
      const tX = document.getElementById('admin-tab-xp');

      if (type === 'earnings') {
        tE?.classList.add('bg-white/10', 'text-white'); tE?.classList.remove('text-ios-subtext');
        tX?.classList.remove('bg-white/10', 'text-white'); tX?.classList.add('text-ios-subtext');
      } else {
        tX?.classList.add('bg-white/10', 'text-white'); tX?.classList.remove('text-ios-subtext');
        tE?.classList.remove('bg-white/10', 'text-white'); tE?.classList.add('text-ios-subtext');
      }

      let data = type === 'earnings'
        ? [...this.state.users].sort((a, b) => (b.coins || 0) - (a.coins || 0))
        : [...this.state.users].sort((a, b) => (b.xp || 0) - (a.xp || 0));

      list.innerHTML = '';
      data.forEach((u, i) => {
        const val = type === 'earnings' ? `${u.coins || 0} Coins` : `Lvl ${u.level || 1}`;
        const item = document.createElement('div');
        item.className = 'glass-panel p-4 rounded-xl flex items-center gap-4';
        item.innerHTML = `
          <div class="w-8 h-8 rounded-full bg-ios-orange flex items-center justify-center text-black font-bold text-sm">${i + 1}</div>
          <img src="https://api.dicebear.com/7.x/notionists/svg?seed=${u.username || u.email}" class="w-10 h-10 rounded-full">
          <div class="flex-1">
            <p class="font-bold text-white">${u.username || u.email}</p>
            <p class="text-xs text-ios-subtext">${val}</p>
          </div>
        `;
        list.appendChild(item);
      });
    };
  }

  overrideTournamentLogic() {
    window.renderAdminTournaments = () => {
      const list = document.getElementById('admin-tournaments-list');
      if (!list) return;

      list.innerHTML = '';
      this.state.tournaments.forEach(t => {
        const div = document.createElement('div');
        div.className = 'p-4 flex justify-between items-center hover:bg-white/5 group';
        div.innerHTML = `
          <div class="flex items-center gap-4">
            <img src="${t.imageUrl || 'https://via.placeholder.com/80'}" class="w-12 h-12 rounded-lg object-cover bg-white/10">
            <div>
              <p class="font-bold text-white">${t.title} <span class="text-xs text-ios-orange bg-ios-orange/20 px-2 py-0.5 rounded ml-2">${t.game}</span></p>
              <p class="text-xs text-ios-subtext">${t.startTime ? new Date(t.startTime.toDate()).toLocaleString() : 'TBD'} • ${t.map} • ${t.type}</p>
            </div>
          </div>
          <div class="flex items-center gap-3">
            <div class="text-right">
              <p class="font-bold text-ios-green">${t.prizePool}</p>
              <p class="text-xs text-ios-subtext">${t.currentParticipants || 0}/${t.maxParticipants} Players</p>
            </div>
            <button onclick="editTournament('${t.id}')" class="p-2 bg-white/10 rounded-lg hover:bg-ios-blue transition text-white"><i class="ph-bold ph-pencil"></i></button>
            <button onclick="deleteTournament('${t.id}')" class="p-2 bg-white/10 rounded-lg hover:bg-ios-red transition text-white"><i class="ph-bold ph-trash"></i></button>
          </div>
        `;
        list.appendChild(div);
      });
    };

    window.handleTournamentSubmit = async (e) => {
      e.preventDefault();
      const id = document.getElementById('edit-tournament-id').value;
      const data = {
        title: document.getElementById('t-title').value,
        startTime: new Date(document.getElementById('t-date').value),
        game: document.getElementById('t-game').value,
        map: document.getElementById('t-map').value,
        type: document.getElementById('t-type').value,
        entryFee: parseInt(document.getElementById('t-fee').value),
        prizePool: document.getElementById('t-prize').value,
        imageUrl: document.getElementById('t-img').value
      };

      await this.handleAsync(async () => {
        if (id) {
          await tournamentManager.updateTournament(id, data);
        } else {
          await tournamentManager.createTournament(data);
        }
        if (window.resetForm) window.resetForm();
      }, id ? "Tournament Updated" : "Tournament Created");
    };

    window.editTournament = (id) => {
      const t = this.state.tournaments.find(x => x.id === id);
      if (!t) return;
      document.getElementById('edit-tournament-id').value = t.id;
      document.getElementById('t-title').value = t.title;
      document.getElementById('t-date').value = t.startTime ? new Date(t.startTime.toDate()).toISOString().slice(0, 16) : '';
      document.getElementById('t-game').value = t.game;
      document.getElementById('t-map').value = t.map;
      document.getElementById('t-type').value = t.type;
      document.getElementById('t-fee').value = t.entryFee;
      document.getElementById('t-prize').value = t.prizePool;
      document.getElementById('t-img').value = t.imageUrl || '';
      document.getElementById('t-title').scrollIntoView({ behavior: 'smooth' });
    };

    window.deleteTournament = async (id) => {
      if (!confirm("Delete this tournament?")) return;
      await this.handleAsync(async () => {
        await tournamentManager.deleteTournament(id);
      }, "Deleted");
    };
  }

  overrideFinancialLogic() {
    window.renderAdminDeposits = () => {
      const list = document.getElementById('admin-deposits-list');
      if (!list) return;

      const txs = this.state.deposits;
      list.innerHTML = txs.length ? '' : '<div class="p-8 text-center text-ios-subtext">No deposits yet.</div>';

      txs.forEach(tx => {
        const div = document.createElement('div');
        div.className = `p-4 flex justify-between items-center hover:bg-white/5 ${tx.status === 'pending' ? 'bg-white/5' : ''}`;
        div.innerHTML = `
          <div>
            <p class="font-bold text-white">${tx.userId} <span class="text-xs text-ios-subtext">(${tx.method})</span></p>
            <p class="text-xs text-ios-subtext">${tx.createdAt ? new Date(tx.createdAt.toDate()).toLocaleString() : 'TBD'}</p>
            <p class="text-xs text-ios-subtext font-mono mt-1">TID: ${tx.transactionId}</p>
          </div>
          <div class="flex items-center gap-3">
            <div class="text-right">
              <p class="font-bold text-ios-green text-xl">+${tx.amount} RS</p>
              <p class="text-xs font-bold ${tx.status === 'completed' ? 'text-ios-green' : 'text-ios-orange'}">${tx.status}</p>
            </div>
            ${tx.status === 'pending' ? `<button onclick="processDeposit('${tx.id}')" class="px-3 py-1 bg-ios-green text-black font-bold rounded text-xs hover:bg-green-400">Verify & Credit</button>` : ''}
          </div>
        `;
        list.appendChild(div);
      });
    };

    window.processDeposit = async (id) => {
      await this.handleAsync(async () => {
        await walletService.approveDeposit(id);
      }, "Deposit Approved");
    };

    window.renderAdminWithdrawals = () => {
      const list = document.getElementById('admin-withdrawals-list');
      if (!list) return;

      const txs = this.state.withdrawals;
      list.innerHTML = txs.length ? '' : '<div class="p-8 text-center text-ios-subtext">No withdrawals yet.</div>';

      txs.forEach(tx => {
        const div = document.createElement('div');
        div.className = `p-4 flex justify-between items-center hover:bg-white/5 ${tx.status === 'pending' ? 'bg-white/5' : ''}`;
        div.innerHTML = `
          <div>
            <p class="font-bold text-white">${tx.userId} <span class="text-xs text-ios-subtext">(${tx.method})</span></p>
            <p class="text-xs text-ios-subtext">${tx.createdAt ? new Date(tx.createdAt.toDate()).toLocaleString() : 'TBD'}</p>
            <p class="text-xs text-ios-subtext font-mono mt-1">Acc: ${tx.accountNumber}</p>
          </div>
          <div class="flex items-center gap-3">
            <div class="text-right">
              <p class="font-bold text-white text-xl">${tx.amount} Coins</p>
              <p class="text-xs text-ios-subtext">Fee: ${tx.fee || 10} RS</p>
              <p class="text-xs font-bold ${tx.status === 'completed' ? 'text-ios-green' : 'text-ios-orange'}">${tx.status}</p>
            </div>
            ${tx.status === 'pending' ? `<button onclick="processWithdrawal('${tx.id}')" class="px-3 py-1 bg-ios-orange text-black font-bold rounded text-xs hover:bg-orange-400">Send Payment</button>` : ''}
          </div>
        `;
        list.appendChild(div);
      });
    };

    window.processWithdrawal = async (id) => {
      await this.handleAsync(async () => {
        await walletService.completeWithdrawal(id);
      }, "Payment Processed");
    };
  }

  overrideAnnouncementLogic() {
    window.renderAdminAnnouncements = () => {
      const list = document.getElementById('admin-announcements-list');
      if (!list) return;

      const announcements = this.state.announcements;
      list.innerHTML = announcements.length ? '' : '<div class="p-8 text-center text-ios-subtext">No announcements yet.</div>';

      announcements.forEach(announcement => {
        const div = document.createElement('div');
        div.className = 'p-4 hover:bg-white/5';

        const typeIcons = { info: '📢', success: '✅', warning: '⚠️', error: '🚨' };
        const typeColors = { info: 'text-ios-blue', success: 'text-ios-green', warning: 'text-ios-orange', error: 'text-ios-red' };

        const createdAt = announcement.createdAt ? new Date(announcement.createdAt.toDate()).toLocaleString() : 'TBD';
        const expiresAt = announcement.expiresAt ? new Date(announcement.expiresAt.toDate()).toLocaleString() : 'Never';

        div.innerHTML = `
          <div class="flex justify-between items-start">
            <div class="flex-1">
              <div class="flex items-center gap-2 mb-2">
                <span class="text-lg">${typeIcons[announcement.type]}</span>
                <h3 class="font-bold text-white">${announcement.title}</h3>
                <span class="text-xs px-2 py-1 rounded ${typeColors[announcement.type]} bg-white/10">${announcement.type.toUpperCase()}</span>
                ${announcement.priority === 'high' ? '<span class="text-xs px-2 py-1 rounded bg-ios-red/20 text-ios-red">HIGH</span>' : ''}
              </div>
              <p class="text-sm text-gray-300 mb-2">${announcement.message}</p>
              <div class="flex gap-4 text-xs text-ios-subtext">
                <span>Created: ${createdAt}</span>
                <span>Expires: ${expiresAt}</span>
                ${announcement.persistent ? '<span class="text-ios-orange">Persistent</span>' : ''}
              </div>
            </div>
            <button onclick="deleteAnnouncement('${announcement.id}')" class="p-2 bg-white/10 rounded-lg hover:bg-ios-red transition text-white ml-4">
              <i class="ph-bold ph-trash"></i>
            </button>
          </div>
        `;
        list.appendChild(div);
      });
    };

    window.handleAnnouncementSubmit = async (e) => {
      e.preventDefault();

      const announcementData = {
        title: document.getElementById('announcement-title').value,
        message: document.getElementById('announcement-message').value,
        type: document.getElementById('announcement-type').value,
        priority: document.getElementById('announcement-priority').value,
        persistent: document.getElementById('announcement-persistent').value === 'true',
        actionText: document.getElementById('announcement-action-text').value || null,
        actionUrl: document.getElementById('announcement-action-url').value || null,
        expiresIn: document.getElementById('announcement-expires').value ?
          parseInt(document.getElementById('announcement-expires').value) : null
      };

      await this.handleAsync(async () => {
        await notificationManager.sendSystemAnnouncement(announcementData);
        if (window.resetAnnouncementForm) window.resetAnnouncementForm();
      }, "📢 Announcement sent successfully!");
    };

    window.deleteAnnouncement = async (id) => {
      if (!confirm("Delete this announcement?")) return;
      await this.handleAsync(async () => {
        await notificationManager.deleteAnnouncement(id);
      }, "Announcement deleted");
    };
  }

  overrideReferralLogic() {
    window.renderAdminReferrals = async () => {
      const list = document.getElementById('admin-referrals-list');
      if (!list) return;

      // Pull from transactions where type is referral
      const txs = await databaseManager.queryCollection('transactions', [
        { type: 'where', field: 'type', operator: '==', value: 'referral' },
        { type: 'orderBy', field: 'createdAt', direction: 'desc' }
      ]);

      list.innerHTML = txs.length ? '' : '<div class="p-8 text-center text-ios-subtext">No referral requests.</div>';

      txs.forEach(tx => {
        const div = document.createElement('div');
        div.className = 'p-4 flex justify-between items-center hover:bg-white/5';

        const date = tx.createdAt ? new Date(tx.createdAt.toDate()).toLocaleString() : 'Just now';
        const color = tx.status === 'completed' ? 'text-ios-green' : (tx.status === 'pending' ? 'text-ios-orange' : 'text-ios-red');

        div.innerHTML = `
          <div class="flex items-center gap-4">
            <div class="w-10 h-10 bg-ios-blue/20 rounded-lg flex items-center justify-center text-ios-blue">
              <i class="ph-bold ph-users-three"></i>
            </div>
            <div>
              <p class="font-bold text-white">${tx.details?.referralCode || 'Unknown Code'}</p>
              <p class="text-xs text-ios-subtext">User: ${tx.userId} • ${date}</p>
            </div>
          </div>
          <div class="flex items-center gap-3">
            <span class="text-xs font-bold ${color}">${tx.status.toUpperCase()}</span>
            ${tx.status === 'pending' ? `
              <button onclick="approveReferral('${tx.id}')" class="px-3 py-1 bg-ios-green/20 text-ios-green rounded text-xs font-bold hover:bg-ios-green hover:text-black transition">Approve</button>
            ` : ''}
          </div>
        `;
        list.appendChild(div);
      });
    };

    window.approveReferral = async (id) => {
      await this.handleAsync(async () => {
        // Approval logic: Update status and credit bonus
        await runTransaction(db, async (transaction) => {
          const txRef = doc(db, 'transactions', id);
          const txSnap = await transaction.get(txRef);
          if (!txSnap.exists()) throw new Error('Transaction not found');

          const txData = txSnap.data();
          if (txData.status !== 'pending') throw new Error('Already processed');

          // Update transaction
          transaction.update(txRef, {
            status: 'completed',
            processedAt: serverTimestamp()
          });

          // Credit user
          const userRef = doc(db, 'users', txData.userId);
          transaction.update(userRef, {
            coins: increment(txData.amount || 50)
          });

          // Add transaction to history
          const auditRef = doc(db, 'transactions', id, 'audit', 'approval');
          transaction.set(auditRef, {
            action: 'approved',
            timestamp: serverTimestamp(),
            admin: authManager.currentUser.email
          });
        });
      }, "Referral Approved");
    };
  }

  overrideLeaderboardLogic() {
    window.renderAdminLeaderboard = (type = 'earnings') => {
      const list = document.getElementById('admin-leaderboard-list');
      if (!list) return;

      const tabE = document.getElementById('admin-tab-earnings');
      const tabX = document.getElementById('admin-tab-xp');

      // Update tabs UI
      if (type === 'earnings') {
        tabE?.classList.add('bg-white/10', 'text-white'); tabE?.classList.remove('text-ios-subtext');
        tabX?.classList.remove('bg-white/10', 'text-white'); tabX?.classList.add('text-ios-subtext');
      } else {
        tabX?.classList.add('bg-white/10', 'text-white'); tabX?.classList.remove('text-ios-subtext');
        tabE?.classList.remove('bg-white/10', 'text-white'); tabE?.classList.add('text-ios-subtext');
      }

      list.innerHTML = '';
      const data = [...this.state.users].sort((a, b) => {
        return type === 'earnings' ? (b.coins - a.coins) : (b.xp - a.xp);
      }).slice(0, 50);

      data.forEach((u, i) => {
        const val = type === 'earnings' ? `${u.coins.toFixed(2)} Coins` : `Lvl ${u.level} (${u.xp} XP)`;
        const item = document.createElement('div');
        item.className = 'glass-panel p-3 rounded-xl flex items-center justify-between';
        item.innerHTML = `
          <div class="flex items-center gap-3">
            <span class="text-xs font-bold text-ios-subtext w-4">${i + 1}</span>
            <img src="https://api.dicebear.com/7.x/notionists/svg?seed=${u.username || u.email}" class="w-8 h-8 rounded-full">
            <span class="text-white font-bold">${u.username || u.name || 'Anonymous'}</span>
          </div>
          <span class="font-mono text-ios-green text-sm">${val}</span>
        `;
        list.appendChild(item);
      });
    };
  }

  overrideSystemStatusLogic() {
    window.renderSystemStatus = () => {
      const container = document.getElementById('admin-status-grid');
      if (!container) return;

      // Clear previous content to avoid growth on refresh
      container.innerHTML = '';

      if (!this.state.status) {
        container.innerHTML = `
          <div class="p-8 text-center text-ios-subtext col-span-3">
            <p>🔄 Initializing system connection...</p>
            <p class="text-[10px] mt-2 opacity-50">If this hangs, please try a <b>Hard Refresh (Ctrl + Shift + R)</b></p>
          </div>
        `;
        return;
      }

      const { quotaStatus, recommendations, fallbacksActive, optimizationLevel } = this.state.status;

      // Create cards for Reads, Writes, Deletes
      Object.entries(quotaStatus).forEach(([type, data]) => {
        const color = data.percentage > 90 ? 'text-ios-red' : (data.percentage > 70 ? 'text-ios-orange' : 'text-ios-green');
        const card = document.createElement('div');
        card.className = 'glass-panel p-4 rounded-xl';
        card.innerHTML = `
          <div class="flex justify-between items-start mb-2">
            <h3 class="font-bold text-white capitalize">${type}</h3>
            <span class="text-xs ${color} font-mono">${data.percentage.toFixed(1)}%</span>
          </div>
          <div class="w-full bg-white/5 h-1.5 rounded-full overflow-hidden mb-3">
            <div class="h-full bg-current ${color}" style="width: ${data.percentage}%"></div>
          </div>
          <p class="text-[10px] text-ios-subtext">${data.used.toLocaleString()} / ${data.limit.toLocaleString()}</p>
        `;
        container.innerHTML += card.outerHTML;
      });

      // Optimization Card
      const optLevelColors = { normal: 'text-ios-green', warning: 'text-ios-orange', critical: 'text-ios-red', emergency: 'text-ios-red' };
      const optCard = document.createElement('div');
      optCard.className = 'glass-panel p-4 rounded-xl md:col-span-3';
      optCard.innerHTML = `
        <div class="flex justify-between items-center mb-4">
          <h3 class="font-bold text-white">System Optimization</h3>
          <span class="px-2 py-1 rounded text-[10px] font-bold ${optLevelColors[optimizationLevel] || 'text-white'} bg-white/5 uppercase">
            Level: ${optimizationLevel}
          </span>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <h4 class="text-xs font-bold text-ios-subtext uppercase mb-2">Active Fallbacks</h4>
            <div class="flex flex-wrap gap-2">
              ${Object.entries(fallbacksActive).map(([key, active]) => `
                <span class="px-2 py-1 rounded text-[10px] ${active ? 'bg-ios-orange/20 text-ios-orange' : 'bg-white/5 text-ios-subtext'}">
                  ${key.replace(/([A-Z])/g, ' $1').trim()}
                </span>
              `).join('')}
            </div>
          </div>
          <div>
            <h4 class="text-xs font-bold text-ios-subtext uppercase mb-2">Recommendations</h4>
            <div class="space-y-2">
              ${recommendations.length ? recommendations.map(rec => `
                <div class="text-[10px] border-l-2 border-ios-blue pl-2">
                  <p class="text-white">${rec.action}</p>
                  <p class="text-ios-subtext italic">${rec.impact}</p>
                </div>
              `).join('') : '<p class="text-[10px] text-ios-subtext italic">No recommendations at this time.</p>'}
            </div>
          </div>
        </div>
      `;
      container.innerHTML += optCard.outerHTML;

      // Migration Card
      this.renderMigrationCard();
    };
  }

  async renderMigrationCard() {
    const container = document.getElementById('admin-status-grid');
    if (!container) return;

    const migrationStatus = await migrationOrchestrator.checkPlatformStatus();

    const migrationCard = document.createElement('div');
    migrationCard.className = 'glass-panel p-4 rounded-xl md:col-span-3 border border-ios-blue/20';
    migrationCard.innerHTML = `
      <div class="flex justify-between items-center mb-4">
        <h3 class="font-bold text-white flex items-center gap-2">
          <i class="ph-bold ph-database-transfer text-ios-blue"></i>
          Legacy Data Migration
        </h3>
        ${migrationStatus.hasLegacyData ?
        '<span class="text-[10px] text-ios-orange bg-ios-orange/10 px-2 py-1 rounded">PENDING</span>' :
        '<span class="text-[10px] text-ios-green bg-ios-green/10 px-2 py-1 rounded">MIGRATED</span>'}
      </div>
      
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div class="text-center">
          <p class="text-xs text-ios-subtext">Users</p>
          <p class="text-lg font-bold">${migrationStatus.details.users}</p>
        </div>
        <div class="text-center">
          <p class="text-xs text-ios-subtext">Tournaments</p>
          <p class="text-lg font-bold">${migrationStatus.details.tournaments}</p>
        </div>
        <div class="text-center">
          <p class="text-xs text-ios-subtext">Transactions</p>
          <p class="text-lg font-bold">${migrationStatus.details.transactions}</p>
        </div>
        <div class="text-center">
          <p class="text-xs text-ios-subtext">Referrals</p>
          <p class="text-lg font-bold">${migrationStatus.details.referrals}</p>
        </div>
      </div>

      <div class="flex gap-3">
        <button onclick="handleStartMigration(true)" 
          class="flex-1 py-2 bg-white/5 text-white text-xs font-bold rounded-lg hover:bg-white/10 transition">
          Simulate (Dry Run)
        </button>
        <button onclick="handleStartMigration(false)" 
          ${!migrationStatus.hasLegacyData ? 'disabled' : ''}
          class="flex-1 py-2 bg-ios-blue text-white text-xs font-bold rounded-lg hover:bg-blue-600 transition disabled:opacity-50">
          Run Full Migration
        </button>
      </div>

      <div id="migration-log" class="mt-4 p-3 bg-black/40 rounded-lg text-[10px] font-mono text-ios-subtext max-h-32 overflow-y-auto hidden">
        <p class="text-ios-blue">Migration Output Log:</p>
      </div>
    `;
    container.appendChild(migrationCard);

    // Global handler for migration buttons
    window.handleStartMigration = async (dryRun) => {
      const logContainer = document.getElementById('migration-log');
      logContainer.classList.remove('hidden');
      logContainer.innerHTML += `<p class="mt-1">Starting ${dryRun ? 'DRY RUN' : 'ACTUAL'} migration...</p>`;

      try {
        const summary = await migrationOrchestrator.runFullMigration(dryRun);
        logContainer.innerHTML += `
          <p class="text-ios-green mt-1">SUCCESS: Migration completed.</p>
          <p>Users: ${summary.users.successful}/${summary.users.total}</p>
          <p>Tournaments: ${summary.tournaments.successful}/${summary.tournaments.total}</p>
          <p>Transactions: ${summary.transactions.successful}/${summary.transactions.total}</p>
          ${summary.backupKey ? `<p class="text-ios-blue">Backup: ${summary.backupKey}</p>` : ''}
        `;
        if (window.showToast) window.showToast(`Migration ${dryRun ? 'simulated' : 'completed'} successfully`, 'success');
      } catch (err) {
        logContainer.innerHTML += `<p class="text-ios-red mt-1">ERROR: ${err.message}</p>`;
        if (window.showToast) window.showToast(err.message, 'error');
      }
    };
  }
}

// Create singleton instance
const adminIntegration = new AdminIntegration();

// Also expose globally
window.AdminIntegrationInstance = adminIntegration;

export default adminIntegration;
