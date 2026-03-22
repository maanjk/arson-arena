// TournamentManager Tests
// Tests for tournament lifecycle management functionality

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import tournamentManager from '../tournament-manager.js';
import databaseManager from '../database-manager.js';

// Mock Firebase functions
vi.mock('firebase/firestore', () => ({
  serverTimestamp: () => ({ _methodName: 'serverTimestamp' }),
  arrayUnion: (value) => ({ _methodName: 'arrayUnion', _elements: [value] }),
  arrayRemove: (value) => ({ _methodName: 'arrayRemove', _elements: [value] }),
  increment: (value) => ({ _methodName: 'increment', _operand: value })
}));

// Mock database manager
vi.mock('../database-manager.js', () => ({
  default: {
    setDocument: vi.fn(),
    getCachedDoc: vi.fn(),
    updateTournament: vi.fn(),
    updateUser: vi.fn(),
    createTransaction: vi.fn(),
    queryCollection: vi.fn(),
    setupRealtimeListener: vi.fn()
  }
}));

// Mock firebase config
vi.mock('../firebase-config.js', () => ({
  quotaManager: {
    canPerformOperation: vi.fn(() => true),
    trackRead: vi.fn(),
    trackWrite: vi.fn()
  },
  withRetry: vi.fn((fn) => fn())
}));

describe('TournamentManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    tournamentManager.cleanup();
  });

  describe('createTournament', () => {
    it('should create a tournament with valid data', async () => {
      const tournamentData = {
        title: 'Test Tournament',
        game: 'PUBG Mobile',
        type: 'solo',
        startTime: new Date(Date.now() + 3600000).toISOString(), // 1 hour from now
        createdBy: 'admin123',
        entryFee: 100
      };

      databaseManager.setDocument.mockResolvedValue();

      const tournamentId = await tournamentManager.createTournament(tournamentData);

      expect(tournamentId).toMatch(/^tournament_\d+_[a-z0-9]{6}$/);
      expect(databaseManager.setDocument).toHaveBeenCalledWith(
        `tournaments/${tournamentId}`,
        expect.objectContaining({
          id: tournamentId,
          title: 'Test Tournament',
          game: 'PUBG Mobile',
          type: 'solo',
          entryFee: 100,
          status: 'pending',
          currentParticipants: 0,
          participants: [],
          createdBy: 'admin123'
        })
      );
    });

    it('should throw error for missing required fields', async () => {
      const invalidData = {
        title: 'Test Tournament'
        // Missing required fields
      };

      await expect(tournamentManager.createTournament(invalidData))
        .rejects.toThrow('Missing required fields');
    });

    it('should throw error for invalid tournament type', async () => {
      const invalidData = {
        title: 'Test Tournament',
        game: 'PUBG Mobile',
        type: 'invalid',
        startTime: new Date(Date.now() + 3600000).toISOString(),
        createdBy: 'admin123'
      };

      await expect(tournamentManager.createTournament(invalidData))
        .rejects.toThrow('Invalid tournament type');
    });

    it('should throw error for past start time', async () => {
      const invalidData = {
        title: 'Test Tournament',
        game: 'PUBG Mobile',
        type: 'solo',
        startTime: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
        createdBy: 'admin123'
      };

      await expect(tournamentManager.createTournament(invalidData))
        .rejects.toThrow('Tournament start time must be in the future');
    });
  });

  describe('joinTournament', () => {
    const mockTournament = {
      id: 'tournament123',
      title: 'Test Tournament',
      game: 'PUBG Mobile',
      type: 'solo',
      status: 'pending',
      entryFee: 100,
      maxParticipants: 50,
      currentParticipants: 10,
      participants: ['user1', 'user2'],
      participantDetails: {
        user1: { userId: 'user1', username: 'Player1' },
        user2: { userId: 'user2', username: 'Player2' }
      }
    };

    const mockUser = {
      uid: 'user123',
      username: 'TestPlayer',
      avatar: 'avatar1',
      coins: 500,
      gameUids: { pubgmobile: 'pubg123' }
    };

    it('should successfully join tournament', async () => {
      databaseManager.getCachedDoc
        .mockResolvedValueOnce(mockTournament)
        .mockResolvedValueOnce(mockUser);
      databaseManager.updateTournament.mockResolvedValue();
      databaseManager.updateUser.mockResolvedValue();
      databaseManager.createTransaction.mockResolvedValue();

      const result = await tournamentManager.joinTournament(
        'tournament123',
        'user123',
        mockUser
      );

      expect(result).toBe(true);
      expect(databaseManager.updateTournament).toHaveBeenCalledWith(
        'tournament123',
        expect.objectContaining({
          participants: ['user1', 'user2', 'user123'],
          currentParticipants: 3,
          participantDetails: expect.objectContaining({
            user123: expect.objectContaining({
              userId: 'user123',
              username: 'TestPlayer',
              status: 'registered'
            })
          })
        })
      );
    });

    it('should throw error if tournament not found', async () => {
      databaseManager.getCachedDoc.mockResolvedValue(null);

      await expect(tournamentManager.joinTournament('invalid', 'user123', mockUser))
        .rejects.toThrow('Tournament not found');
    });

    it('should throw error if user already joined', async () => {
      const tournamentWithUser = {
        ...mockTournament,
        participants: ['user1', 'user2', 'user123']
      };

      databaseManager.getCachedDoc
        .mockResolvedValueOnce(tournamentWithUser)
        .mockResolvedValueOnce(mockUser);

      await expect(tournamentManager.joinTournament('tournament123', 'user123', mockUser))
        .rejects.toThrow('User already joined this tournament');
    });

    it('should throw error if tournament is full', async () => {
      const fullTournament = {
        ...mockTournament,
        currentParticipants: 50,
        maxParticipants: 50
      };

      databaseManager.getCachedDoc
        .mockResolvedValueOnce(fullTournament)
        .mockResolvedValueOnce(mockUser);

      await expect(tournamentManager.joinTournament('tournament123', 'user123', mockUser))
        .rejects.toThrow('Tournament is full');
    });

    it('should throw error if insufficient coins', async () => {
      const poorUser = { ...mockUser, coins: 50 };

      databaseManager.getCachedDoc
        .mockResolvedValueOnce(mockTournament)
        .mockResolvedValueOnce(poorUser);

      await expect(tournamentManager.joinTournament('tournament123', 'user123', mockUser))
        .rejects.toThrow('Insufficient coins to join tournament');
    });
  });

  describe('leaveTournament', () => {
    const mockTournament = {
      id: 'tournament123',
      title: 'Test Tournament',
      status: 'pending',
      entryFee: 100,
      participants: ['user1', 'user2', 'user123'],
      participantDetails: {
        user1: { userId: 'user1', username: 'Player1' },
        user2: { userId: 'user2', username: 'Player2' },
        user123: { userId: 'user123', username: 'TestPlayer' }
      }
    };

    const mockUser = {
      uid: 'user123',
      coins: 400
    };

    it('should successfully leave tournament with refund', async () => {
      databaseManager.getCachedDoc
        .mockResolvedValueOnce(mockTournament)
        .mockResolvedValueOnce(mockUser);
      databaseManager.updateTournament.mockResolvedValue();
      databaseManager.updateUser.mockResolvedValue();
      databaseManager.createTransaction.mockResolvedValue();

      const result = await tournamentManager.leaveTournament('tournament123', 'user123');

      expect(result).toBe(true);
      expect(databaseManager.updateTournament).toHaveBeenCalledWith(
        'tournament123',
        expect.objectContaining({
          participants: ['user1', 'user2'],
          currentParticipants: 2,
          participantDetails: expect.not.objectContaining({
            user123: expect.anything()
          })
        })
      );
      expect(databaseManager.updateUser).toHaveBeenCalledWith('user123', {
        coins: 500 // 400 + 100 refund
      });
    });

    it('should throw error if user not in tournament', async () => {
      const tournamentWithoutUser = {
        ...mockTournament,
        participants: ['user1', 'user2']
      };

      databaseManager.getCachedDoc.mockResolvedValue(tournamentWithoutUser);

      await expect(tournamentManager.leaveTournament('tournament123', 'user123'))
        .rejects.toThrow('User is not in this tournament');
    });

    it('should throw error if tournament is active', async () => {
      const activeTournament = {
        ...mockTournament,
        status: 'active'
      };

      databaseManager.getCachedDoc.mockResolvedValue(activeTournament);

      await expect(tournamentManager.leaveTournament('tournament123', 'user123'))
        .rejects.toThrow('Cannot leave an active tournament');
    });
  });

  describe('updateTournamentStatus', () => {
    it('should update tournament status to active', async () => {
      databaseManager.updateTournament.mockResolvedValue();

      await tournamentManager.updateTournamentStatus('tournament123', 'active');

      expect(databaseManager.updateTournament).toHaveBeenCalledWith(
        'tournament123',
        expect.objectContaining({
          status: 'active',
          actualStartTime: expect.objectContaining({ _methodName: 'serverTimestamp' })
        })
      );
    });

    it('should update tournament status to completed', async () => {
      databaseManager.updateTournament.mockResolvedValue();

      await tournamentManager.updateTournamentStatus('tournament123', 'completed');

      expect(databaseManager.updateTournament).toHaveBeenCalledWith(
        'tournament123',
        expect.objectContaining({
          status: 'completed',
          completedAt: expect.objectContaining({ _methodName: 'serverTimestamp' })
        })
      );
    });

    it('should throw error for invalid status', async () => {
      await expect(tournamentManager.updateTournamentStatus('tournament123', 'invalid'))
        .rejects.toThrow('Invalid status: invalid');
    });
  });

  describe('processMatchResults', () => {
    const mockTournament = {
      id: 'tournament123',
      title: 'Test Tournament',
      entryFee: 100,
      currentParticipants: 4,
      participantDetails: {
        user1: { userId: 'user1', username: 'Player1' },
        user2: { userId: 'user2', username: 'Player2' },
        user3: { userId: 'user3', username: 'Player3' },
        user4: { userId: 'user4', username: 'Player4' }
      }
    };

    const mockResults = [
      { userId: 'user1', username: 'Player1', kills: 10 },
      { userId: 'user2', username: 'Player2', kills: 8 },
      { userId: 'user3', username: 'Player3', kills: 5 },
      { userId: 'user4', username: 'Player4', kills: 2 }
    ];

    it('should process match results and distribute prizes', async () => {
      databaseManager.getCachedDoc
        .mockResolvedValueOnce(mockTournament)
        .mockResolvedValueOnce({ coins: 500 }) // user1
        .mockResolvedValueOnce({ coins: 300 }); // user2
      
      databaseManager.updateTournament.mockResolvedValue();
      databaseManager.updateUser.mockResolvedValue();
      databaseManager.createTransaction.mockResolvedValue();

      await tournamentManager.processMatchResults('tournament123', mockResults);

      expect(databaseManager.updateTournament).toHaveBeenCalledWith(
        'tournament123',
        expect.objectContaining({
          results: mockResults,
          status: 'completed',
          participantDetails: expect.objectContaining({
            user1: expect.objectContaining({
              status: 'winner',
              finalRank: 1,
              kills: 10
            }),
            user2: expect.objectContaining({
              status: 'eliminated',
              finalRank: 2,
              kills: 8
            })
          })
        })
      );

      // Check prize distribution (80% to winner, 20% to runner-up)
      const totalPrize = 100 * 4; // 400 coins
      const winnerPrize = Math.floor(totalPrize * 0.8); // 320 coins
      const runnerUpPrize = Math.floor(totalPrize * 0.2); // 80 coins

      expect(databaseManager.updateUser).toHaveBeenCalledWith('user1', {
        coins: 500 + winnerPrize
      });
      expect(databaseManager.updateUser).toHaveBeenCalledWith('user2', {
        coins: 300 + runnerUpPrize
      });
    });

    it('should throw error for invalid results format', async () => {
      const invalidResults = [
        { username: 'Player1' } // Missing userId
      ];

      await expect(tournamentManager.processMatchResults('tournament123', invalidResults))
        .rejects.toThrow('Invalid result at position 0: missing userId or username');
    });

    it('should throw error for empty results', async () => {
      await expect(tournamentManager.processMatchResults('tournament123', []))
        .rejects.toThrow('Results must be a non-empty array');
    });
  });

  describe('getTournaments', () => {
    it('should get tournaments with filters', async () => {
      const mockTournaments = [
        { id: 'tournament1', status: 'pending', game: 'PUBG Mobile' },
        { id: 'tournament2', status: 'active', game: 'PUBG Mobile' }
      ];

      databaseManager.queryCollection.mockResolvedValue(mockTournaments);

      const result = await tournamentManager.getTournaments({
        status: 'pending',
        game: 'PUBG Mobile',
        limit: 10
      });

      expect(result).toEqual(mockTournaments);
      expect(databaseManager.queryCollection).toHaveBeenCalledWith(
        'tournaments',
        expect.arrayContaining([
          { type: 'where', field: 'status', operator: '==', value: 'pending' },
          { type: 'where', field: 'game', operator: '==', value: 'PUBG Mobile' },
          { type: 'orderBy', field: 'createdAt', direction: 'desc' },
          { type: 'limit', value: 10 }
        ])
      );
    });
  });

  describe('updateRoomDetails', () => {
    it('should update room details', async () => {
      const roomDetails = {
        roomId: 'ROOM123',
        password: 'pass123',
        server: 'Asia'
      };

      databaseManager.updateTournament.mockResolvedValue();

      await tournamentManager.updateRoomDetails('tournament123', roomDetails);

      expect(databaseManager.updateTournament).toHaveBeenCalledWith(
        'tournament123',
        expect.objectContaining({
          roomDetails: {
            roomId: 'ROOM123',
            password: 'pass123',
            server: 'Asia'
          }
        })
      );
    });
  });

  describe('getParticipants', () => {
    it('should get tournament participants', async () => {
      const mockTournament = {
        participants: ['user1', 'user2'],
        participantDetails: {
          user1: { userId: 'user1', username: 'Player1', joinedAt: new Date('2024-01-01') },
          user2: { userId: 'user2', username: 'Player2', joinedAt: new Date('2024-01-02') }
        }
      };

      databaseManager.getCachedDoc.mockResolvedValue(mockTournament);

      const participants = await tournamentManager.getParticipants('tournament123');

      expect(participants).toHaveLength(2);
      expect(participants[0].username).toBe('Player1');
      expect(participants[1].username).toBe('Player2');
    });
  });

  describe('real-time listeners', () => {
    it('should setup tournament listener', () => {
      const mockCallback = vi.fn();
      const mockUnsubscribe = vi.fn();
      
      databaseManager.setupRealtimeListener.mockReturnValue(mockUnsubscribe);

      const unsubscribe = tournamentManager.onTournamentUpdated('tournament123', mockCallback);

      expect(databaseManager.setupRealtimeListener).toHaveBeenCalledWith(
        'tournaments/tournament123',
        mockCallback
      );
      expect(unsubscribe).toBe(mockUnsubscribe);
    });

    it('should setup tournaments list listener', () => {
      const mockCallback = vi.fn();
      const mockUnsubscribe = vi.fn();
      
      databaseManager.setupRealtimeListener.mockReturnValue(mockUnsubscribe);

      const unsubscribe = tournamentManager.onTournamentsUpdated(mockCallback, {
        status: 'pending',
        limit: 25
      });

      expect(databaseManager.setupRealtimeListener).toHaveBeenCalledWith(
        'tournaments',
        mockCallback,
        expect.arrayContaining([
          { type: 'where', field: 'status', operator: '==', value: 'pending' },
          { type: 'orderBy', field: 'createdAt', direction: 'desc' },
          { type: 'limit', value: 25 }
        ])
      );
    });
  });
});