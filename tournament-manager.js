// TournamentManager - Tournament Lifecycle Management Service
// Handles tournament creation, participant management, and status tracking

import { serverTimestamp, arrayUnion, arrayRemove, increment } from 'firebase/firestore';
import databaseManager from './database-manager.js';
import { quotaManager, withRetry } from './firebase-config.js';

class TournamentManager {
  constructor() {
    this.activeListeners = new Map();
    this.tournamentCache = new Map();
    this.participantLimits = {
      solo: 100,
      duo: 50,
      squad: 25
    };
  }

  /**
   * Create a new tournament
   * @param {Object} tournamentData - Tournament configuration
   * @returns {Promise<string>} Tournament ID
   */
  async createTournament(tournamentData) {
    try {
      // Validate tournament data
      this.validateTournamentData(tournamentData);

      const tournamentId = `tournament_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

      const tournament = {
        id: tournamentId,
        title: tournamentData.title,
        game: tournamentData.game,
        map: tournamentData.map || 'Erangel',
        type: tournamentData.type, // solo, duo, squad
        entryFee: tournamentData.entryFee || 0,
        prizePool: tournamentData.prizePool || 'TBD',
        maxParticipants: tournamentData.maxParticipants || this.participantLimits[tournamentData.type],
        currentParticipants: 0,
        status: 'pending', // pending, active, completed, cancelled
        startTime: tournamentData.startTime,
        participants: [],
        roomDetails: {
          roomId: '',
          password: '',
          server: tournamentData.server || 'Asia'
        },
        results: [],
        createdBy: tournamentData.createdBy,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };

      // Add optional fields only if they exist
      if (tournamentData.endTime) tournament.endTime = tournamentData.endTime;
      if (tournamentData.imageUrl) tournament.imageUrl = tournamentData.imageUrl;


      await databaseManager.setDocument(`tournaments/${tournamentId}`, tournament);

      console.log(`✅ Tournament created: ${tournamentId}`);
      return tournamentId;

    } catch (error) {
      console.error('❌ Failed to create tournament:', error);
      throw new Error(`Tournament creation failed: ${error.message}`);
    }
  }

  /**
   * Validate tournament data
   * @param {Object} tournamentData - Tournament data to validate
   */
  validateTournamentData(tournamentData) {
    const required = ['title', 'game', 'type', 'startTime', 'createdBy'];
    const missing = required.filter(field => !tournamentData[field]);

    if (missing.length > 0) {
      throw new Error(`Missing required fields: ${missing.join(', ')}`);
    }

    if (!['solo', 'duo', 'squad'].includes(tournamentData.type)) {
      throw new Error('Invalid tournament type. Must be solo, duo, or squad');
    }

    if (!['PUBG Mobile', 'FreeFire'].includes(tournamentData.game)) {
      throw new Error('Invalid game. Must be PUBG Mobile or FreeFire');
    }

    if (new Date(tournamentData.startTime) <= new Date()) {
      throw new Error('Tournament start time must be in the future');
    }

    if (tournamentData.entryFee && tournamentData.entryFee < 0) {
      throw new Error('Entry fee cannot be negative');
    }
  }

  /**
   * Join a tournament
   * @param {string} tournamentId - Tournament ID
   * @param {string} userId - User ID
   * @param {Object} userInfo - User information
   * @returns {Promise<boolean>} Success status
   */
  async joinTournament(tournamentId, userId, userInfo) {
    try {
      // Read tournament and user data
      const tournament = await databaseManager.getCachedDoc(`tournaments/${tournamentId}`);
      const user = await databaseManager.getCachedDoc(`users/${userId}`);

      if (!tournament) throw new Error('Tournament not found');
      if (!user) throw new Error('User not found');

      // Validations
      if (tournament.status && tournament.status !== 'pending' && tournament.status !== 'active') {
        throw new Error('Tournament is not accepting participants');
      }

      if (tournament.participants?.includes(userId)) {
        throw new Error('User already joined this tournament');
      }

      const maxP = tournament.maxParticipants || 100;
      if ((tournament.currentParticipants || 0) >= maxP) {
        throw new Error('Tournament is full');
      }

      const fee = tournament.entryFee || 0;
      if (user.coins < fee) {
        throw new Error('Insufficient coins to join tournament');
      }

      // Build updated participants list
      const updatedParticipants = [...(tournament.participants || []), userId];
      const participantData = {
        userId,
        username: userInfo.username,
        gameUid: userInfo.gameUids?.pubgmobile || userInfo.gameUids?.freefire || '',
        joinedAt: serverTimestamp(),
        status: 'registered'
      };

      await databaseManager.updateTournament(tournamentId, {
        participants: updatedParticipants,
        currentParticipants: updatedParticipants.length,
        participantDetails: {
          ...(tournament.participantDetails || {}),
          [userId]: participantData
        },
        updatedAt: serverTimestamp()
      });

      // Deduct coins and record transaction if fee > 0
      if (fee > 0) {
        await databaseManager.updateUser(userId, {
          coins: user.coins - fee,
          updatedAt: serverTimestamp()
        });

        await databaseManager.createTransaction({
          userId,
          type: 'tournament_fee',
          amount: -fee,
          status: 'completed',
          details: {
            tournamentId,
            tournamentTitle: tournament.title || 'Tournament'
          }
        });
      }

      console.log(`✅ User ${userId} joined tournament ${tournamentId}`);
      return true;

    } catch (error) {
      console.error(`❌ Failed to join tournament ${tournamentId}:`, error);
      throw new Error(error.message || 'Failed to join tournament');
    }
  }

  /**
   * Leave a tournament
   * @param {string} tournamentId - Tournament ID
   * @param {string} userId - User ID
   * @returns {Promise<boolean>} Success status
   */
  async leaveTournament(tournamentId, userId) {
    try {
      // Get tournament and user data
      const tournament = await databaseManager.getCachedDoc(`tournaments/${tournamentId}`);
      const user = await databaseManager.getCachedDoc(`users/${userId}`);

      if (!tournament) {
        throw new Error('Tournament not found');
      }

      if (tournament.status === 'active') {
        throw new Error('Cannot leave an active tournament');
      }

      if (!tournament.participants || !tournament.participants.includes(userId)) {
        throw new Error('User is not in this tournament');
      }

      // Remove participant from tournament
      const updatedParticipants = tournament.participants.filter(id => id !== userId);
      const updatedParticipantDetails = { ...tournament.participantDetails };
      delete updatedParticipantDetails[userId];

      await databaseManager.updateTournament(tournamentId, {
        participants: updatedParticipants,
        currentParticipants: updatedParticipants.length,
        participantDetails: updatedParticipantDetails
      });

      // Refund entry fee if tournament hasn't started
      if (tournament.entryFee > 0 && tournament.status === 'pending' && user) {
        await databaseManager.updateUser(userId, {
          coins: user.coins + tournament.entryFee
        });

        // Create refund transaction record
        const transactionData = {
          userId: userId,
          type: 'tournament_refund',
          amount: tournament.entryFee,
          status: 'completed',
          details: {
            tournamentId: tournamentId,
            tournamentTitle: tournament.title,
            reason: 'Left tournament before start'
          }
        };

        await databaseManager.createTransaction(transactionData);
      }

      console.log(`✅ User ${userId} left tournament ${tournamentId}`);
      return true;

    } catch (error) {
      console.error(`❌ Failed to leave tournament ${tournamentId}:`, error);
      throw new Error(`Failed to leave tournament: ${error.message}`);
    }
  }

  /**
   * Update tournament status
   * @param {string} tournamentId - Tournament ID
   * @param {string} status - New status
   * @param {Object} additionalData - Additional data to update
   * @returns {Promise<void>}
   */
  async updateTournamentStatus(tournamentId, status, additionalData = {}) {
    try {
      const validStatuses = ['pending', 'active', 'completed', 'cancelled'];
      if (!validStatuses.includes(status)) {
        throw new Error(`Invalid status: ${status}`);
      }

      const updateData = {
        status,
        updatedAt: serverTimestamp(),
        ...additionalData
      };

      // Add status-specific data
      if (status === 'active') {
        updateData.actualStartTime = serverTimestamp();
      } else if (status === 'completed') {
        updateData.completedAt = serverTimestamp();
      } else if (status === 'cancelled') {
        updateData.cancelledAt = serverTimestamp();
        // Handle refunds for cancelled tournaments
        await this.handleTournamentCancellation(tournamentId);
      }

      await databaseManager.updateTournament(tournamentId, updateData);

      console.log(`✅ Tournament ${tournamentId} status updated to: ${status}`);

    } catch (error) {
      console.error(`❌ Failed to update tournament status:`, error);
      throw new Error(`Status update failed: ${error.message}`);
    }
  }

  /**
   * Handle tournament cancellation and refunds
   * @param {string} tournamentId - Tournament ID
   */
  async handleTournamentCancellation(tournamentId) {
    try {
      const tournament = await databaseManager.getCachedDoc(`tournaments/${tournamentId}`);

      if (!tournament || tournament.entryFee === 0 || !tournament.participants) {
        return; // No refunds needed
      }

      // Process refunds for all participants
      const refundPromises = tournament.participants.map(async (userId) => {
        try {
          // Get current user data
          const user = await databaseManager.getCachedDoc(`users/${userId}`);
          if (!user) {
            console.warn(`User ${userId} not found for refund`);
            return;
          }

          // Refund entry fee
          await databaseManager.updateUser(userId, {
            coins: user.coins + tournament.entryFee
          });

          // Create refund transaction record
          const transactionData = {
            userId: userId,
            type: 'tournament_refund',
            amount: tournament.entryFee,
            status: 'completed',
            details: {
              tournamentId: tournamentId,
              tournamentTitle: tournament.title,
              reason: 'Tournament cancelled'
            }
          };

          await databaseManager.createTransaction(transactionData);
          console.log(`✅ Refunded ${tournament.entryFee} coins to user ${userId}`);
        } catch (error) {
          console.error(`❌ Failed to refund user ${userId}:`, error);
        }
      });

      await Promise.all(refundPromises);
      console.log(`✅ All refunds processed for tournament ${tournamentId}`);

    } catch (error) {
      console.error(`❌ Failed to handle tournament cancellation:`, error);
    }
  }

  /**
   * Process match results
   * @param {string} tournamentId - Tournament ID
   * @param {Array} results - Match results
   * @returns {Promise<void>}
   */
  async processMatchResults(tournamentId, results) {
    try {
      // Validate results format
      this.validateMatchResults(results);

      const tournament = await databaseManager.getCachedDoc(`tournaments/${tournamentId}`);
      if (!tournament) {
        throw new Error('Tournament not found');
      }

      // Update tournament with results and completion status
      const updatedParticipantDetails = { ...tournament.participantDetails };

      // Update participant statuses based on results
      results.forEach((result, index) => {
        const status = index === 0 ? 'winner' : 'eliminated';
        if (updatedParticipantDetails[result.userId]) {
          updatedParticipantDetails[result.userId].status = status;
          updatedParticipantDetails[result.userId].finalRank = index + 1;
          updatedParticipantDetails[result.userId].kills = result.kills || 0;
        }
      });

      await databaseManager.updateTournament(tournamentId, {
        results: results,
        status: 'completed',
        completedAt: serverTimestamp(),
        participantDetails: updatedParticipantDetails
      });

      // Process prize distribution
      await this.distributePrizes(tournamentId, tournament, results);

      console.log(`✅ Match results processed for tournament ${tournamentId}`);

    } catch (error) {
      console.error(`❌ Failed to process match results:`, error);
      throw new Error(`Results processing failed: ${error.message}`);
    }
  }

  /**
   * Validate match results format
   * @param {Array} results - Results to validate
   */
  validateMatchResults(results) {
    if (!Array.isArray(results) || results.length === 0) {
      throw new Error('Results must be a non-empty array');
    }

    results.forEach((result, index) => {
      if (!result.userId || !result.username) {
        throw new Error(`Invalid result at position ${index}: missing userId or username`);
      }

      if (typeof result.kills !== 'undefined' && result.kills < 0) {
        throw new Error(`Invalid kills count for ${result.username}`);
      }
    });
  }

  /**
   * Distribute prizes to winners
   * @param {string} tournamentId - Tournament ID
   * @param {Object} tournament - Tournament data
   * @param {Array} results - Match results
   */
  async distributePrizes(tournamentId, tournament, results) {
    // Simple prize distribution: winner takes 80%, runner-up takes 20%
    const totalPrizePool = tournament.entryFee * tournament.currentParticipants;

    if (totalPrizePool === 0) {
      return; // No prizes to distribute
    }

    const prizes = {
      1: Math.floor(totalPrizePool * 0.8), // 80% to winner
      2: Math.floor(totalPrizePool * 0.2)  // 20% to runner-up
    };

    // Process prize distribution for top 2 winners
    const prizePromises = results.slice(0, 2).map(async (result, index) => {
      const rank = index + 1;
      const prizeAmount = prizes[rank];

      if (prizeAmount > 0) {
        try {
          // Get current user data
          const user = await databaseManager.getCachedDoc(`users/${result.userId}`);
          if (!user) {
            console.warn(`User ${result.userId} not found for prize distribution`);
            return;
          }

          // Award prize to user
          await databaseManager.updateUser(result.userId, {
            coins: user.coins + prizeAmount
          });

          // Create prize transaction record
          const transactionData = {
            userId: result.userId,
            type: 'prize',
            amount: prizeAmount,
            status: 'completed',
            details: {
              tournamentId: tournamentId,
              tournamentTitle: tournament.title,
              rank: rank,
              totalParticipants: tournament.currentParticipants
            }
          };

          await databaseManager.createTransaction(transactionData);
          console.log(`✅ Awarded ${prizeAmount} coins to ${result.username} (Rank ${rank})`);
        } catch (error) {
          console.error(`❌ Failed to award prize to user ${result.userId}:`, error);
        }
      }
    });

    await Promise.all(prizePromises);
    console.log(`✅ Prize distribution completed for tournament ${tournamentId}`);
  }

  /**
   * Get tournament details
   * @param {string} tournamentId - Tournament ID
   * @returns {Promise<Object>} Tournament data
   */
  async getTournament(tournamentId) {
    try {
      return await databaseManager.getCachedDoc(`tournaments/${tournamentId}`);
    } catch (error) {
      console.error(`❌ Failed to get tournament ${tournamentId}:`, error);
      throw error;
    }
  }

  /**
   * Get tournaments with filters
   * @param {Object} filters - Filter options
   * @returns {Promise<Array>} Tournament list
   */
  async getTournaments(filters = {}) {
    try {
      const { status, game, limit = 50 } = filters;

      const constraints = [
        { type: 'orderBy', field: 'createdAt', direction: 'desc' },
        { type: 'limit', value: limit }
      ];

      if (status) {
        constraints.unshift({ type: 'where', field: 'status', operator: '==', value: status });
      }

      if (game) {
        constraints.unshift({ type: 'where', field: 'game', operator: '==', value: game });
      }

      return await databaseManager.queryCollection('tournaments', constraints);
    } catch (error) {
      console.error('❌ Failed to get tournaments:', error);
      throw error;
    }
  }

  /**
   * Setup real-time tournament listener
   * @param {string} tournamentId - Tournament ID
   * @param {Function} callback - Callback function
   * @returns {Function} Unsubscribe function
   */
  onTournamentUpdated(tournamentId, callback) {
    try {
      const unsubscribe = databaseManager.setupRealtimeListener(
        `tournaments/${tournamentId}`,
        callback
      );

      this.activeListeners.set(tournamentId, unsubscribe);
      return unsubscribe;
    } catch (error) {
      console.error(`❌ Failed to setup tournament listener:`, error);
      throw error;
    }
  }

  /**
   * Setup real-time tournaments list listener
   * @param {Function} callback - Callback function
   * @param {Object} filters - Filter options
   * @returns {Function} Unsubscribe function
   */
  onTournamentsUpdated(callback, filters = {}) {
    try {
      const { status, limit = 50 } = filters;

      const constraints = [
        { type: 'orderBy', field: 'createdAt', direction: 'desc' },
        { type: 'limit', value: limit }
      ];

      if (status) {
        constraints.unshift({ type: 'where', field: 'status', operator: '==', value: status });
      }

      return databaseManager.setupRealtimeListener('tournaments', callback, constraints);
    } catch (error) {
      console.error('❌ Failed to setup tournaments listener:', error);
      throw error;
    }
  }

  /**
   * Update room details for tournament
   * @param {string} tournamentId - Tournament ID
   * @param {Object} roomDetails - Room details
   * @returns {Promise<void>}
   */
  async updateRoomDetails(tournamentId, roomDetails) {
    try {
      const updateData = {
        roomDetails: {
          roomId: roomDetails.roomId || '',
          password: roomDetails.password || '',
          server: roomDetails.server || 'Asia'
        },
        updatedAt: serverTimestamp()
      };

      await databaseManager.updateTournament(tournamentId, updateData);
      console.log(`✅ Room details updated for tournament ${tournamentId}`);
    } catch (error) {
      console.error(`❌ Failed to update room details:`, error);
      throw error;
    }
  }

  /**
   * Get participant details for tournament
   * @param {string} tournamentId - Tournament ID
   * @returns {Promise<Array>} Participant list
   */
  async getParticipants(tournamentId) {
    try {
      const tournament = await this.getTournament(tournamentId);
      if (!tournament) {
        throw new Error('Tournament not found');
      }

      const participants = [];
      for (const userId of (tournament.participants || [])) {
        const participantDetail = tournament.participantDetails?.[userId];
        if (participantDetail) {
          participants.push(participantDetail);
        }
      }

      return participants.sort((a, b) =>
        new Date(a.joinedAt?.toDate?.() || a.joinedAt) -
        new Date(b.joinedAt?.toDate?.() || b.joinedAt)
      );
    } catch (error) {
      console.error(`❌ Failed to get participants:`, error);
      throw error;
    }
  }

  /**
   * Update tournament details (Admin)
   * @param {string} id - Tournament ID
   * @param {Object} updates - Update data
   */
  async updateTournament(id, updates) {
    try {
      await databaseManager.updateTournament(id, {
        ...updates,
        updatedAt: serverTimestamp()
      });
      console.log(`✅ Tournament updated: ${id}`);
    } catch (error) {
      console.error(`❌ Failed to update tournament ${id}:`, error);
      throw error;
    }
  }

  /**
   * Delete a tournament (Admin)
   * @param {string} id - Tournament ID
   */
  async deleteTournament(id) {
    try {
      await databaseManager.deleteTournament(id);
      console.log(`✅ Tournament deleted: ${id}`);
    } catch (error) {
      console.error(`❌ Failed to delete tournament ${id}:`, error);
      throw error;
    }
  }

  /**
   * Cleanup all listeners
   */
  cleanup() {
    this.activeListeners.forEach(unsubscribe => unsubscribe());
    this.activeListeners.clear();
    this.tournamentCache.clear();
    console.log('🧹 TournamentManager cleanup completed');
  }
}

// Create and export singleton instance
const tournamentManager = new TournamentManager();
export default tournamentManager;