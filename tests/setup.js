// Test setup file
// Global test configuration and mocks

import { vi } from 'vitest';

// Mock global objects that might be used in the application but aren't in JSDOM
// JSDOM provides document, window, localStorage, and navigator.

if (typeof window !== 'undefined') {
  // Ensure we are in "development" mode for Firebase
  Object.defineProperty(window, 'location', {
    value: {
      hostname: 'localhost',
      href: 'http://localhost/',
    },
    writable: true
  });

  window.showToast = vi.fn();
  window.switchView = vi.fn();
  window.openTournamentModal = vi.fn();

  // Mock Firebase global object if needed
  window.Firebase = {
    authManager: {},
    databaseManager: {},
    tournamentManager: {},
    walletService: {},
    notificationManager: {},
    quotaManager: {}
  };
}

// Ensure localStorage is ready
if (typeof localStorage === 'undefined') {
  global.localStorage = {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
  };
}