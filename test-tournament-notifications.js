// Test Tournament Notification System
// Simple test to verify tournament update notifications are working

import notificationManager from './notification-manager.js';
import tournamentMigrationManager from './tournament-migration.js';

class TournamentNotificationTester {
  constructor() {
    this.testResults = [];
  }

  /**
   * Run all tournament notification tests
   */
  async runAllTests() {
    console.log('🧪 Starting Tournament Notification Tests...');
    
    try {
      await this.testTournamentCreatedNotification();
      await this.testTournamentStatusChangeNotification();
      await this.testParticipantJoinedNotification();
      await this.testParticipantLeftNotification();
      await this.testRoomDetailsNotification();
      await this.testMatchStartingNotification();
      await this.testResultsNotification();
      
      this.printTestResults();
      
    } catch (error) {
      console.error('❌ Test suite failed:', error);
    }
  }

  /**
   * Test tournament created notification
   */
  async testTournamentCreatedNotification() {
    try {
      console.log('🧪 Testing tournament created notification...');
      
      const mockTournament = {
        id: 'test_tournament_1',
        title: 'Test PUBG Tournament',
        game: 'PUBG Mobile',
        type: 'Solo',
        entryFee: 50,
        prizePool: '500 Coins',
        maxParticipants: 100,
        participants: []
      };

      const result = await notificationManager.sendTournamentUpdateNotification(
        mockTournament.id,
        'tournament_created',
        mockTournament
      );

      this.testResults.push({
        test: 'Tournament Created Notification',
        passed: result === true,
        message: result ? 'Notification sent successfully' : 'Failed to send notification'
      });

    } catch (error) {
      this.testResults.push({
        test: 'Tournament Created Notification',
        passed: false,
        message: `Error: ${error.message}`
      });
    }
  }

  /**
   * Test tournament status change notification
   */
  async testTournamentStatusChangeNotification() {
    try {
      console.log('🧪 Testing tournament status change notification...');
      
      const mockTournament = {
        id: 'test_tournament_2',
        title: 'Test FreeFire Tournament',
        game: 'FreeFire',
        type: 'Squad',
        participants: ['user1', 'user2', 'user3']
      };

      const result = await notificationManager.handleTournamentStatusChange(
        mockTournament.id,
        mockTournament,
        'pending',
        'active'
      );

      this.testResults.push({
        test: 'Tournament Status Change Notification',
        passed: result === true,
        message: result ? 'Status change notification sent' : 'Failed to send status change notification'
      });

    } catch (error) {
      this.testResults.push({
        test: 'Tournament Status Change Notification',
        passed: false,
        message: `Error: ${error.message}`
      });
    }
  }

  /**
   * Test participant joined notification
   */
  async testParticipantJoinedNotification() {
    try {
      console.log('🧪 Testing participant joined notification...');
      
      const mockTournament = {
        id: 'test_tournament_3',
        title: 'Test Tournament',
        game: 'PUBG Mobile',
        participants: ['user1', 'user2'],
        currentParticipants: 2
      };

      const result = await notificationManager.handleTournamentParticipantChange(
        mockTournament.id,
        mockTournament,
        'joined',
        { userId: 'user3', username: 'TestPlayer' }
      );

      this.testResults.push({
        test: 'Participant Joined Notification',
        passed: result === true,
        message: result ? 'Participant joined notification sent' : 'Failed to send participant notification'
      });

    } catch (error) {
      this.testResults.push({
        test: 'Participant Joined Notification',
        passed: false,
        message: `Error: ${error.message}`
      });
    }
  }

  /**
   * Test participant left notification
   */
  async testParticipantLeftNotification() {
    try {
      console.log('🧪 Testing participant left notification...');
      
      const mockTournament = {
        id: 'test_tournament_4',
        title: 'Test Tournament',
        game: 'PUBG Mobile',
        participants: ['user1', 'user2'],
        currentParticipants: 2
      };

      const result = await notificationManager.handleTournamentParticipantChange(
        mockTournament.id,
        mockTournament,
        'left',
        { userId: 'user3', username: 'TestPlayer' }
      );

      this.testResults.push({
        test: 'Participant Left Notification',
        passed: result === true,
        message: result ? 'Participant left notification sent' : 'Failed to send participant left notification'
      });

    } catch (error) {
      this.testResults.push({
        test: 'Participant Left Notification',
        passed: false,
        message: `Error: ${error.message}`
      });
    }
  }

  /**
   * Test room details notification
   */
  async testRoomDetailsNotification() {
    try {
      console.log('🧪 Testing room details notification...');
      
      const mockTournament = {
        id: 'test_tournament_5',
        title: 'Test Tournament',
        game: 'PUBG Mobile',
        participants: ['user1', 'user2', 'user3']
      };

      const mockRoomDetails = {
        roomId: '123456',
        password: 'test123',
        server: 'Asia'
      };

      const result = await notificationManager.handleTournamentRoomDetailsAdded(
        mockTournament.id,
        mockTournament,
        mockRoomDetails
      );

      this.testResults.push({
        test: 'Room Details Notification',
        passed: result === true,
        message: result ? 'Room details notification sent' : 'Failed to send room details notification'
      });

    } catch (error) {
      this.testResults.push({
        test: 'Room Details Notification',
        passed: false,
        message: `Error: ${error.message}`
      });
    }
  }

  /**
   * Test match starting notification
   */
  async testMatchStartingNotification() {
    try {
      console.log('🧪 Testing match starting notification...');
      
      const mockTournament = {
        id: 'test_tournament_6',
        title: 'Test Tournament',
        game: 'PUBG Mobile',
        participants: ['user1', 'user2', 'user3'],
        roomDetails: { roomId: '123456' }
      };

      const result = await notificationManager.scheduleMatchStartingNotification(
        mockTournament.id,
        mockTournament,
        5
      );

      this.testResults.push({
        test: 'Match Starting Notification',
        passed: result === true,
        message: result ? 'Match starting notification scheduled' : 'Failed to schedule match starting notification'
      });

    } catch (error) {
      this.testResults.push({
        test: 'Match Starting Notification',
        passed: false,
        message: `Error: ${error.message}`
      });
    }
  }

  /**
   * Test results notification
   */
  async testResultsNotification() {
    try {
      console.log('🧪 Testing results notification...');
      
      const mockTournament = {
        id: 'test_tournament_7',
        title: 'Test Tournament',
        game: 'PUBG Mobile',
        participants: ['user1', 'user2', 'user3']
      };

      const mockResults = [
        { userId: 'user1', position: 1, prize: 300 },
        { userId: 'user2', position: 2, prize: 150 },
        { userId: 'user3', position: 3, prize: 50 }
      ];

      // Test individual participant notification
      const result = await notificationManager.notifyTournamentParticipants(
        ['user1'],
        'tournament_results_posted',
        mockTournament,
        {
          winnerName: 'TestWinner',
          userPosition: 1,
          prizeWon: 300
        }
      );

      this.testResults.push({
        test: 'Results Notification',
        passed: result === true,
        message: result ? 'Results notification sent' : 'Failed to send results notification'
      });

    } catch (error) {
      this.testResults.push({
        test: 'Results Notification',
        passed: false,
        message: `Error: ${error.message}`
      });
    }
  }

  /**
   * Test notification data building
   */
  testNotificationDataBuilding() {
    try {
      console.log('🧪 Testing notification data building...');
      
      const mockTournament = {
        id: 'test_tournament_8',
        title: 'Test Tournament',
        game: 'PUBG Mobile',
        type: 'Solo',
        entryFee: 50,
        prizePool: '500 Coins',
        maxParticipants: 100
      };

      const notificationData = notificationManager.buildTournamentNotificationData(
        'tournament_created',
        mockTournament
      );

      const isValid = notificationData && 
                     notificationData.notification && 
                     notificationData.notification.title && 
                     notificationData.notification.body &&
                     notificationData.data &&
                     notificationData.data.type === 'tournament_created';

      this.testResults.push({
        test: 'Notification Data Building',
        passed: isValid,
        message: isValid ? 'Notification data built correctly' : 'Invalid notification data structure'
      });

    } catch (error) {
      this.testResults.push({
        test: 'Notification Data Building',
        passed: false,
        message: `Error: ${error.message}`
      });
    }
  }

  /**
   * Print test results
   */
  printTestResults() {
    console.log('\n📊 Tournament Notification Test Results:');
    console.log('=' .repeat(50));
    
    let passed = 0;
    let failed = 0;

    this.testResults.forEach(result => {
      const status = result.passed ? '✅ PASS' : '❌ FAIL';
      console.log(`${status} ${result.test}: ${result.message}`);
      
      if (result.passed) {
        passed++;
      } else {
        failed++;
      }
    });

    console.log('=' .repeat(50));
    console.log(`📈 Summary: ${passed} passed, ${failed} failed, ${passed + failed} total`);
    
    if (failed === 0) {
      console.log('🎉 All tournament notification tests passed!');
    } else {
      console.log('⚠️ Some tests failed. Please review the implementation.');
    }
  }

  /**
   * Test integration with tournament migration manager
   */
  async testTournamentMigrationIntegration() {
    try {
      console.log('🧪 Testing tournament migration integration...');
      
      // Test that tournament migration manager has notification methods
      const hasAddParticipant = typeof tournamentMigrationManager.addParticipant === 'function';
      const hasRemoveParticipant = typeof tournamentMigrationManager.removeParticipant === 'function';
      const hasUpdateStatus = typeof tournamentMigrationManager.updateTournamentStatus === 'function';
      const hasAddRoomDetails = typeof tournamentMigrationManager.addRoomDetails === 'function';

      const integrationWorking = hasAddParticipant && hasRemoveParticipant && hasUpdateStatus && hasAddRoomDetails;

      this.testResults.push({
        test: 'Tournament Migration Integration',
        passed: integrationWorking,
        message: integrationWorking ? 'Integration methods available' : 'Missing integration methods'
      });

    } catch (error) {
      this.testResults.push({
        test: 'Tournament Migration Integration',
        passed: false,
        message: `Error: ${error.message}`
      });
    }
  }
}

// Export for use in other files
export default TournamentNotificationTester;

// Auto-run tests if this file is loaded directly
if (typeof window !== 'undefined') {
  window.TournamentNotificationTester = TournamentNotificationTester;
  
  // Add to global Firebase object for debugging
  if (window.Firebase) {
    window.Firebase.TournamentNotificationTester = TournamentNotificationTester;
  }
}