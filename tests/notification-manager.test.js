import { vi, describe, it, expect, beforeEach, beforeAll } from 'vitest';

// Mock Firebase Modules
vi.mock('../firebase-config.js', () => ({
    messaging: { _mock: true },
    auth: {
        currentUser: { uid: 'test-user-123' },
        onAuthStateChanged: vi.fn()
    },
    db: { _mock: true }
}));

vi.mock('firebase/messaging', () => ({
    getToken: vi.fn(() => Promise.resolve('mock-token')),
    onMessage: vi.fn(),
    deleteToken: vi.fn()
}));

vi.mock('firebase/firestore', () => ({
    doc: vi.fn(),
    updateDoc: vi.fn(),
    getDoc: vi.fn(() => Promise.resolve({ exists: () => false })),
    setDoc: vi.fn(),
    deleteDoc: vi.fn(),
    collection: vi.fn(),
    query: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    onSnapshot: vi.fn(),
    serverTimestamp: vi.fn(() => new Date()),
    arrayUnion: vi.fn(),
    arrayRemove: vi.fn()
}));

// Mock Notification class
class MockNotification {
    constructor(title, options) {
        this.title = title;
        this.options = options;
        MockNotification.instances.push(this);
    }
    static instances = [];
    static permission = 'granted';
    static requestPermission = vi.fn().mockResolvedValue('granted');

    close = vi.fn();
}

vi.stubGlobal('Notification', MockNotification);

// Delay import until after mocks
let notificationManager;

describe('NotificationManager', () => {
    beforeAll(async () => {
        // Mock navigator.serviceWorker properly
        if (!global.navigator.serviceWorker) {
            Object.defineProperty(global.navigator, 'serviceWorker', {
                value: {
                    register: vi.fn().mockResolvedValue({ scope: '/' })
                },
                configurable: true
            });
        }

        // Mock DOM elements
        document.body.innerHTML = `
      <div id="announcement-overlay" class="hidden"></div>
      <div id="announcement-modal"></div>
      <div id="notification-banner" class="hidden"></div>
    `;

        // Import the manager
        const module = await import('../notification-manager.js');
        notificationManager = module.default;
    });

    beforeEach(() => {
        vi.clearAllMocks();
        MockNotification.instances = [];
        if (notificationManager) {
            notificationManager.notificationHistory = [];
            notificationManager.userPreferences.tournaments = true; // reset
            document.getElementById('announcement-overlay').classList.add('hidden');
        }
    });

    it('should initialize successfully', async () => {
        const initialized = await notificationManager.init();
        expect(initialized).toBe(true);
    });

    it('should send a local notification for tournament joins', async () => {
        const tournament = { id: 't1', title: 'Test Tournament' };
        const user = { username: 'Player1' };

        await notificationManager.handleTournamentParticipantChange('t1', tournament, 'joined', user);

        expect(MockNotification.instances.length).toBe(1);
        expect(MockNotification.instances[0].title).toBe('Tournament Update');
    });

    it('should handle room details notifications', async () => {
        const tournament = { id: 't1', title: 'Test Tournament' };
        const roomDetails = { roomId: '123', password: 'abc' };

        await notificationManager.handleTournamentRoomDetailsAdded('t1', tournament, roomDetails);

        expect(MockNotification.instances.length).toBe(1);
        expect(MockNotification.instances[0].title).toBe('Match Ready');
        expect(MockNotification.instances[0].options.data.roomId).toBe('123');
    });

    it('should respect user preferences for notifications', async () => {
        notificationManager.userPreferences.tournaments = false;
        const tournament = { id: 't1', title: 'Test Tournament' };

        await notificationManager.handleTournamentStatusChange('t1', tournament, 'pending', 'active');

        expect(MockNotification.instances.length).toBe(0);
    });
});
