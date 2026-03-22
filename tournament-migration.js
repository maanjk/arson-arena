// Tournament Data Migration Utilities
// Converts localStorage tournament data to Firestore schema with validation and real-time updates

import databaseManager from './database-manager.js';
import { quotaManager } from './firebase-config.js';
import { serverTimestamp } from 'firebase/firestore';
import notificationManager from './notification-manager.js';

class TournamentMigrationManager {
  constructor() {
    this.backupData = new Map();
    this.migrationLog = [];
    this.validationRules = this.setupValidationRules();
    this.statusMapping = this.setupStatusMapping();
  }

  /**
   * Setup validation rules for tournament data
   * @returns {Object} Validation rules
   */
  setupValidationRules() {
    return {
      title: {
        required: true,
        type: 'string',
        minLength: 5,
        maxLength: 100,
        message: 'Title must be 5-100 characters'
      },
      game: {
        required: true,
        type: 'string',
        enum: ['PUBG Mobile', 'FreeFire', 'PUBG', 'Free Fire'],
        message: 'Game must be PUBG Mobile or FreeFire'
      },
      map: {
        required: true,
        type: 'string',
        maxLength: 50,
        message: 'Map name must be valid'
      },
      type: {
        required: true,
        type: 'string',
        enum: ['Solo', 'Duo', 'Squad'],
        message: 'Type must be Solo, Duo, or Squad'
      },
      entryFee: {
        required: true,
        type: 'number',
        min: 0,
        max: 10000,
        message: 'Entry fee must be between 0 and 10,000'
      },
      prizePool: {
        required: true,
        type: 'string',
        maxLength: 200,
        message: 'Prize pool description must be valid'
      },
      maxParticipants: {
        required: true,
        type: 'number',
        min: 2,
        max: 1000,
        message: 'Max participants must be between 2 and 1,000'
      },
      participants: {
        required: false,
        type: 'array',
        message: 'Participants must be an array'
      },
      status: {
        required: false,
        type: 'string',
        enum: ['pending', 'active', 'completed', 'cancelled'],
        message: 'Status must be pending, active, completed, or cancelled'
      }
    };
  }

  /**
   * Setup status mapping from localStorage to Firestore
   * @returns {Object} Status mapping
   */
  setupStatusMapping() {
    return {
      // Default mapping for tournaments without explicit status
      default: 'pending',
      
      // Map based on date/time context
      past: 'completed',
      current: 'active',
      future: 'pending',
      
      // Explicit status mapping
      'pending': 'pending',
      'active': 'active',
      'live': 'active',
      'ongoing': 'active',
      'completed': 'completed',
      'finished': 'completed',
      'ended': 'completed',
      'cancelled': 'cancelled',
      'canceled': 'cancelled'
    };
  }

  /**
   * Get localStorage tournament data
   * @returns {Array} Array of tournament objects from localStorage
   */
  getLocalStorageTournaments() {
    try {
      const tournaments = JSON.parse(localStorage.getItem('battlesaas_tournaments') || '[]');
      console.log(`📋 Found ${tournaments.length} tournaments in localStorage`);
      return tournaments;
    } catch (error) {
      console.error('❌ Failed to parse localStorage tournaments:', error);
      return [];
    }
  }

  /**
   * Validate tournament data against schema
   * @param {Object} tournamentData - Tournament data to validate
   * @returns {Object} Validation result
   */
  validateTournamentData(tournamentData) {
    const errors = [];
    const warnings = [];

    for (const [field, rules] of Object.entries(this.validationRules)) {
      const value = tournamentData[field];

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

      if (rules.type === 'array' && !Array.isArray(value)) {
        errors.push(`${field} must be an array`);
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

      // Array validations
      if (rules.type === 'array' && Array.isArray(value)) {
        if (rules.maxItems && value.length > rules.maxItems) {
          warnings.push(`${field} has more than ${rules.maxItems} items`);
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
   * Parse date string to timestamp
   * @param {string} dateString - Date string from localStorage
   * @returns {Date} Parsed date
   */
  parseDateString(dateString) {
    if (!dateString) return new Date();

    try {
      // Handle common date formats from localStorage
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);

      if (dateString.toLowerCase().includes('today')) {
        // Extract time if present
        const timeMatch = dateString.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
        if (timeMatch) {
          let hours = parseInt(timeMatch[1]);
          const minutes = parseInt(timeMatch[2]);
          const ampm = timeMatch[3].toUpperCase();
          
          if (ampm === 'PM' && hours !== 12) hours += 12;
          if (ampm === 'AM' && hours === 12) hours = 0;
          
          return new Date(today.getFullYear(), today.getMonth(), today.getDate(), hours, minutes);
        }
        return today;
      }

      if (dateString.toLowerCase().includes('tomorrow')) {
        // Extract time if present
        const timeMatch = dateString.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
        if (timeMatch) {
          let hours = parseInt(timeMatch[1]);
          const minutes = parseInt(timeMatch[2]);
          const ampm = timeMatch[3].toUpperCase();
          
          if (ampm === 'PM' && hours !== 12) hours += 12;
          if (ampm === 'AM' && hours === 12) hours = 0;
          
          return new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), hours, minutes);
        }
        return tomorrow;
      }

      // Try to parse as regular date
      const parsed = new Date(dateString);
      return isNaN(parsed.getTime()) ? new Date() : parsed;

    } catch (error) {
      console.warn(`Failed to parse date: ${dateString}`, error);
      return new Date();
    }
  }

  /**
   * Determine tournament status based on date and context
   * @param {Object} tournament - Tournament data
   * @returns {string} Tournament status
   */
  determineTournamentStatus(tournament) {
    // If status is explicitly set, use mapping
    if (tournament.status && this.statusMapping[tournament.status.toLowerCase()]) {
      return this.statusMapping[tournament.status.toLowerCase()];
    }

    // Determine status based on date
    const startTime = this.parseDateString(tournament.date);
    const now = new Date();
    const timeDiff = startTime.getTime() - now.getTime();
    const hoursDiff = timeDiff / (1000 * 60 * 60);

    if (hoursDiff < -2) {
      // Tournament ended more than 2 hours ago
      return 'completed';
    } else if (hoursDiff < 0) {
      // Tournament is currently running
      return 'active';
    } else {
      // Tournament is in the future
      return 'pending';
    }
  }

  /**
   * Sanitize tournament data for Firestore
   * @param {Object} tournamentData - Raw tournament data
   * @returns {Object} Sanitized tournament data
   */
  sanitizeTournamentData(tournamentData) {
    const startTime = this.parseDateString(tournamentData.date);
    const endTime = new Date(startTime.getTime() + 2 * 60 * 60 * 1000); // Default 2 hours duration

    const sanitized = {
      // Generate ID if not present
      id: tournamentData.id ? `tournament_${tournamentData.id}` : `tournament_${Date.now()}`,
      
      // Required fields
      title: (tournamentData.title || '').toString().trim(),
      game: this.normalizeGameName(tournamentData.game || ''),
      map: (tournamentData.map || '').toString().trim(),
      type: this.normalizeType(tournamentData.type || 'Solo'),
      entryFee: Math.max(0, Math.min(10000, parseInt(tournamentData.fee || tournamentData.entryFee) || 0)),
      prizePool: (tournamentData.prize || tournamentData.prizePool || '').toString().trim(),
      
      // Participant management
      maxParticipants: Math.max(2, Math.min(1000, parseInt(tournamentData.max || tournamentData.maxParticipants) || 100)),
      currentParticipants: parseInt(tournamentData.players || tournamentData.currentParticipants) || 0,
      participants: Array.isArray(tournamentData.participants) ? [...tournamentData.participants] : [],
      
      // Status and timing
      status: this.determineTournamentStatus(tournamentData),
      startTime: startTime,
      endTime: endTime,
      
      // Optional fields
      xpReward: parseInt(tournamentData.xpReward) || 0,
      image: tournamentData.img || tournamentData.image || '',
      
      // Room details (initially empty)
      roomDetails: {
        roomId: '',
        password: '',
        server: ''
      },
      
      // Results (initially empty)
      results: [],
      
      // Admin info (will be set during migration)
      createdBy: 'system', // Will be updated with actual admin UID
      
      // Timestamps
      createdAt: tournamentData.createdAt || new Date(),
      updatedAt: new Date()
    };

    // Clean up empty strings
    Object.keys(sanitized).forEach(key => {
      if (typeof sanitized[key] === 'string' && sanitized[key] === '') {
        sanitized[key] = null;
      }
    });

    return sanitized;
  }

  /**
   * Normalize game name
   * @param {string} gameName - Raw game name
   * @returns {string} Normalized game name
   */
  normalizeGameName(gameName) {
    const normalized = gameName.toLowerCase().trim();
    
    if (normalized.includes('pubg')) {
      return 'PUBG Mobile';
    } else if (normalized.includes('free') || normalized.includes('fire')) {
      return 'FreeFire';
    }
    
    return 'PUBG Mobile'; // Default
  }

  /**
   * Normalize tournament type
   * @param {string} type - Raw type
   * @returns {string} Normalized type
   */
  normalizeType(type) {
    const normalized = type.toLowerCase().trim();
    
    if (normalized.includes('solo')) return 'Solo';
    if (normalized.includes('duo')) return 'Duo';
    if (normalized.includes('squad')) return 'Squad';
    
    return 'Solo'; // Default
  }

  /**
   * Create backup of tournament data
   * @returns {Object} Backup data
   */
  createTournamentBackup() {
    try {
      const backup = {
        timestamp: new Date().toISOString(),
        tournaments: this.getLocalStorageTournaments()
      };

      const backupKey = `tournament_backup_${Date.now()}`;
      this.backupData.set(backupKey, backup);
      localStorage.setItem(backupKey, JSON.stringify(backup));

      console.log(`✅ Tournament backup created: ${backupKey}`);
      return { backupKey, backup };
    } catch (error) {
      console.error('❌ Failed to create tournament backup:', error);
      throw new Error('Tournament backup creation failed');
    }
  }

  /**
   * Migrate single tournament to Firestore
   * @param {Object} localTournament - Local tournament data
   * @returns {Promise<Object>} Migration result
   */
  async migrateSingleTournament(localTournament) {
    const migrationResult = {
      success: false,
      id: localTournament.id,
      title: localTournament.title,
      errors: [],
      warnings: []
    };

    try {
      // Sanitize data
      const sanitizedData = this.sanitizeTournamentData(localTournament);
      
      // Validate data
      const validation = this.validateTournamentData(sanitizedData);
      migrationResult.warnings = validation.warnings;

      if (!validation.isValid) {
        migrationResult.errors = validation.errors;
        console.error(`❌ Validation failed for tournament ${sanitizedData.title}:`, validation.errors);
        return migrationResult;
      }

      // Check if tournament already exists in Firestore
      const existingTournament = await databaseManager.getCachedDoc(`tournaments/${sanitizedData.id}`);
      if (existingTournament) {
        console.log(`⚠️ Tournament ${sanitizedData.title} already exists in Firestore`);
        migrationResult.warnings.push('Tournament already exists in Firestore');
        migrationResult.success = true;
        return migrationResult;
      }

      // Create tournament in Firestore
      await databaseManager.setDocument(`tournaments/${sanitizedData.id}`, sanitizedData);

      migrationResult.success = true;
      console.log(`✅ Tournament ${sanitizedData.title} migrated successfully`);

    } catch (error) {
      console.error(`❌ Failed to migrate tournament ${localTournament.title}:`, error);
      migrationResult.errors.push(error.message);
    }

    return migrationResult;
  }

  /**
   * Migrate all tournaments from localStorage to Firestore
   * @param {boolean} dryRun - Perform validation only without actual migration
   * @returns {Promise<Object>} Migration summary
   */
  async migrateAllTournaments(dryRun = false) {
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
        const backup = this.createTournamentBackup();
        summary.backupKey = backup.backupKey;
      }

      // Get localStorage tournaments
      const localTournaments = this.getLocalStorageTournaments();
      summary.total = localTournaments.length;

      if (localTournaments.length === 0) {
        console.log('📋 No tournaments found in localStorage');
        return summary;
      }

      console.log(`🚀 Starting ${dryRun ? 'validation' : 'migration'} of ${localTournaments.length} tournaments`);

      // Process each tournament
      for (const localTournament of localTournaments) {
        try {
          if (dryRun) {
            // Validation only
            const sanitizedData = this.sanitizeTournamentData(localTournament);
            const validation = this.validateTournamentData(sanitizedData);
            
            const result = {
              id: localTournament.id,
              title: localTournament.title,
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
            const result = await this.migrateSingleTournament(localTournament);
            summary.results.push(result);
            
            if (result.success) {
              summary.successful++;
            } else {
              summary.failed++;
            }
          }

        } catch (error) {
          console.error(`❌ Error processing tournament ${localTournament.title}:`, error);
          summary.failed++;
          summary.results.push({
            id: localTournament.id,
            title: localTournament.title || 'Unknown',
            success: false,
            errors: [error.message]
          });
        }
      }

      // Log summary
      console.log(`📊 Tournament ${dryRun ? 'Validation' : 'Migration'} Summary:`, {
        total: summary.total,
        successful: summary.successful,
        failed: summary.failed,
        skipped: summary.skipped
      });

      return summary;

    } catch (error) {
      console.error(`❌ Tournament ${dryRun ? 'validation' : 'migration'} failed:`, error);
      throw error;
    }
  }

  /**
   * Setup real-time participant tracking for migrated tournaments
   * @param {string} tournamentId - Tournament ID
   * @returns {Function} Unsubscribe function
   */
  setupParticipantTracking(tournamentId) {
    return databaseManager.setupRealtimeListener(
      `tournaments/${tournamentId}`,
      (tournamentData) => {
        if (tournamentData) {
          console.log(`👥 Participant update for ${tournamentData.title}: ${tournamentData.currentParticipants}/${tournamentData.maxParticipants}`);
          
          // Emit custom event for UI updates
          window.dispatchEvent(new CustomEvent('tournamentParticipantUpdate', {
            detail: {
              tournamentId,
              participants: tournamentData.participants,
              currentCount: tournamentData.currentParticipants,
              maxCount: tournamentData.maxParticipants
            }
          }));
        }
      }
    );
  }

  /**
   * Add participant to tournament
   * @param {string} tournamentId - Tournament ID
   * @param {string} userId - User ID
   * @param {string} username - Username
   * @returns {Promise<boolean>} Success status
   */
  async addParticipant(tournamentId, userId, username) {
    try {
      const tournament = await databaseManager.getCachedDoc(`tournaments/${tournamentId}`);
      
      if (!tournament) {
        throw new Error('Tournament not found');
      }

      if (tournament.participants.includes(userId)) {
        console.log(`User ${username} already participating in tournament`);
        return true;
      }

      if (tournament.currentParticipants >= tournament.maxParticipants) {
        throw new Error('Tournament is full');
      }

      // Update tournament with new participant
      const updatedParticipants = [...tournament.participants, userId];
      const updatedTournament = {
        ...tournament,
        participants: updatedParticipants,
        currentParticipants: updatedParticipants.length
      };

      await databaseManager.setDocument(`tournaments/${tournamentId}`, {
        participants: updatedParticipants,
        currentParticipants: updatedParticipants.length
      }, true);

      // Send notification about participant joining
      await notificationManager.handleTournamentParticipantChange(
        tournamentId,
        updatedTournament,
        'joined',
        { userId, username }
      );

      console.log(`✅ Added ${username} to tournament ${tournament.title}`);
      return true;

    } catch (error) {
      console.error(`❌ Failed to add participant to tournament:`, error);
      throw error;
    }
  }

  /**
   * Remove participant from tournament
   * @param {string} tournamentId - Tournament ID
   * @param {string} userId - User ID
   * @param {string} username - Username
   * @returns {Promise<boolean>} Success status
   */
  async removeParticipant(tournamentId, userId, username) {
    try {
      const tournament = await databaseManager.getCachedDoc(`tournaments/${tournamentId}`);
      
      if (!tournament) {
        throw new Error('Tournament not found');
      }

      if (!tournament.participants.includes(userId)) {
        console.log(`User ${username} not participating in tournament`);
        return true;
      }

      // Update tournament without participant
      const updatedParticipants = tournament.participants.filter(id => id !== userId);
      const updatedTournament = {
        ...tournament,
        participants: updatedParticipants,
        currentParticipants: updatedParticipants.length
      };

      await databaseManager.setDocument(`tournaments/${tournamentId}`, {
        participants: updatedParticipants,
        currentParticipants: updatedParticipants.length
      }, true);

      // Send notification about participant leaving
      await notificationManager.handleTournamentParticipantChange(
        tournamentId,
        updatedTournament,
        'left',
        { userId, username }
      );

      console.log(`✅ Removed ${username} from tournament ${tournament.title}`);
      return true;

    } catch (error) {
      console.error(`❌ Failed to remove participant from tournament:`, error);
      throw error;
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
      // Get current tournament data to track status change
      const currentTournament = await databaseManager.getCachedDoc(`tournaments/${tournamentId}`);
      
      if (!currentTournament) {
        throw new Error('Tournament not found');
      }

      const oldStatus = currentTournament.status;
      const updateData = {
        status,
        ...additionalData
      };

      await databaseManager.setDocument(`tournaments/${tournamentId}`, updateData, true);

      // Send notification about status change if status actually changed
      if (oldStatus !== status) {
        const updatedTournament = { ...currentTournament, ...updateData };
        await notificationManager.handleTournamentStatusChange(
          tournamentId,
          updatedTournament,
          oldStatus,
          status
        );
      }

      console.log(`✅ Updated tournament ${tournamentId} status to ${status}`);

    } catch (error) {
      console.error(`❌ Failed to update tournament status:`, error);
      throw error;
    }
  }

  /**
   * Add room details to tournament and notify participants
   * @param {string} tournamentId - Tournament ID
   * @param {Object} roomDetails - Room details (roomId, password, server)
   * @returns {Promise<void>}
   */
  async addRoomDetails(tournamentId, roomDetails) {
    try {
      const tournament = await databaseManager.getCachedDoc(`tournaments/${tournamentId}`);
      
      if (!tournament) {
        throw new Error('Tournament not found');
      }

      const updateData = {
        roomDetails: {
          roomId: roomDetails.roomId || '',
          password: roomDetails.password || '',
          server: roomDetails.server || ''
        }
      };

      await databaseManager.setDocument(`tournaments/${tournamentId}`, updateData, true);

      // Send notification to participants about room details
      const updatedTournament = { ...tournament, ...updateData };
      await notificationManager.handleTournamentRoomDetailsAdded(
        tournamentId,
        updatedTournament,
        roomDetails
      );

      console.log(`✅ Added room details to tournament ${tournament.title}`);

    } catch (error) {
      console.error(`❌ Failed to add room details to tournament:`, error);
      throw error;
    }
  }

  /**
   * Create new tournament and broadcast notification
   * @param {Object} tournamentData - Tournament data
   * @returns {Promise<string>} Tournament ID
   */
  async createTournament(tournamentData) {
    try {
      // Sanitize and validate tournament data
      const sanitizedData = this.sanitizeTournamentData(tournamentData);
      const validation = this.validateTournamentData(sanitizedData);

      if (!validation.isValid) {
        throw new Error(`Tournament validation failed: ${validation.errors.join(', ')}`);
      }

      // Create tournament in Firestore
      await databaseManager.setDocument(`tournaments/${sanitizedData.id}`, sanitizedData);

      // Broadcast notification about new tournament
      await notificationManager.broadcastTournamentNotification(
        'tournament_created',
        sanitizedData
      );

      console.log(`✅ Created tournament ${sanitizedData.title}`);
      return sanitizedData.id;

    } catch (error) {
      console.error(`❌ Failed to create tournament:`, error);
      throw error;
    }
  }

  /**
   * Schedule match starting notifications
   * @param {string} tournamentId - Tournament ID
   * @param {number} minutesUntilStart - Minutes until match starts
   * @returns {Promise<void>}
   */
  async scheduleMatchStartingNotification(tournamentId, minutesUntilStart = 5) {
    try {
      const tournament = await databaseManager.getCachedDoc(`tournaments/${tournamentId}`);
      
      if (!tournament) {
        throw new Error('Tournament not found');
      }

      await notificationManager.scheduleMatchStartingNotification(
        tournamentId,
        tournament,
        minutesUntilStart
      );

      console.log(`✅ Scheduled match starting notification for ${tournament.title}`);

    } catch (error) {
      console.error(`❌ Failed to schedule match starting notification:`, error);
      throw error;
    }
  }

  /**
   * Post tournament results and notify participants
   * @param {string} tournamentId - Tournament ID
   * @param {Array} results - Tournament results
   * @param {string} winnerName - Winner's name
   * @returns {Promise<void>}
   */
  async postTournamentResults(tournamentId, results, winnerName) {
    try {
      const tournament = await databaseManager.getCachedDoc(`tournaments/${tournamentId}`);
      
      if (!tournament) {
        throw new Error('Tournament not found');
      }

      const updateData = {
        results,
        status: 'completed'
      };

      await databaseManager.setDocument(`tournaments/${tournamentId}`, updateData, true);

      // Send results notification to participants
      const updatedTournament = { ...tournament, ...updateData };
      
      // For each participant, send personalized notification
      for (const participantId of tournament.participants) {
        const userPosition = results.findIndex(result => result.userId === participantId) + 1;
        const prizeWon = results.find(result => result.userId === participantId)?.prize || 0;

        await notificationManager.notifyTournamentParticipants(
          [participantId],
          'tournament_results_posted',
          updatedTournament,
          {
            winnerName,
            userPosition: userPosition > 0 ? userPosition : null,
            prizeWon
          }
        );
      }

      console.log(`✅ Posted results for tournament ${tournament.title}`);

    } catch (error) {
      console.error(`❌ Failed to post tournament results:`, error);
      throw error;
    }
  }

  /**
   * Get migration status for tournaments
   * @returns {Object} Migration status
   */
  getTournamentMigrationStatus() {
    const localTournaments = this.getLocalStorageTournaments();
    
    return {
      hasLocalData: localTournaments.length > 0,
      totalLocalTournaments: localTournaments.length,
      backups: this.getAvailableBackups()
    };
  }

  /**
   * Get available tournament backups
   * @returns {Array} Available backup keys
   */
  getAvailableBackups() {
    const backups = [];
    
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('tournament_backup_')) {
        try {
          const backup = JSON.parse(localStorage.getItem(key));
          backups.push({
            key,
            timestamp: backup.timestamp,
            tournamentCount: backup.tournaments?.length || 0
          });
        } catch (error) {
          console.warn(`Invalid tournament backup found: ${key}`);
        }
      }
    }

    return backups.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }

  /**
   * Clean up old tournament backups
   * @param {number} keepCount - Number of backups to keep
   */
  cleanupTournamentBackups(keepCount = 3) {
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
        console.warn(`Failed to delete tournament backup ${backup.key}:`, error);
      }
    });

    console.log(`🧹 Cleaned up ${deleted} old tournament backups`);
  }
}

// Create and export singleton instance
const tournamentMigrationManager = new TournamentMigrationManager();
export default tournamentMigrationManager;