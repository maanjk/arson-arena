# ARSON Arena - Firebase Gaming Tournament Platform

A competitive gaming tournament platform built with Firebase, featuring real-time updates, secure authentication, and optimized for Firebase Free Tier usage.

## 🚀 Features

- **Real-time Tournament Management** - Live updates using Firebase Firestore
- **Secure Authentication** - Firebase Auth with custom claims for admin roles
- **Push Notifications** - Firebase Cloud Messaging for instant updates
- **Offline Support** - Progressive Web App with offline capabilities
- **Free Tier Optimized** - Built to maximize Firebase free tier limits
- **Mobile-First Design** - Responsive design optimized for mobile gaming

## 🔥 Firebase Services Used

- **Authentication** - User management and admin roles (50K MAU free)
- **Firestore** - Real-time database (1GB storage, 50K reads/day, 20K writes/day)
- **Cloud Messaging** - Push notifications (unlimited free)
- **Hosting** - Web hosting (10GB storage, 10GB transfer/month)
- **Analytics** - User engagement tracking (unlimited free)
- **Performance Monitoring** - Basic performance metrics (free)
- **Crashlytics** - Error tracking and crash reporting (free)

## 📋 Prerequisites

- Node.js 16+ and npm
- Firebase CLI (`npm install -g firebase-tools`)
- A Firebase project (create at [Firebase Console](https://console.firebase.google.com))

## ⚡ Quick Setup

### 1. Firebase Project Setup

1. Create a new Firebase project at [Firebase Console](https://console.firebase.google.com)
2. Enable the following services:
   - Authentication (Email/Password provider)
   - Firestore Database
   - Cloud Messaging
   - Hosting
   - Analytics

### 2. Configuration

1. **Update Firebase Config**
   ```javascript
   // Edit firebase-config.js with your project details
   const firebaseConfig = {
     apiKey: "your-api-key-here",
     authDomain: "your-project-id.firebaseapp.com",
     projectId: "your-project-id",
     storageBucket: "your-project-id.appspot.com",
     messagingSenderId: "123456789",
     appId: "1:123456789:web:abcdef123456",
     measurementId: "G-XXXXXXXXXX"
   };
   ```

2. **Install Dependencies**
   ```bash
   npm install
   ```

3. **Login to Firebase**
   ```bash
   firebase login
   ```

4. **Initialize Firebase (if needed)**
   ```bash
   firebase init
   # Select: Firestore, Hosting, Emulators
   ```

### 3. Development with Emulators

Start the Firebase emulators for local development:

```bash
# Start emulators with UI
npm run dev:ui

# Or start emulators without UI
npm run dev
```

This will start:
- Firestore Emulator on `localhost:8080`
- Auth Emulator on `localhost:9099`
- Hosting on `localhost:5000`
- Emulator UI on `localhost:4000`

### 4. Deploy to Production

```bash
# Deploy to Firebase Hosting
npm run deploy
```

## 📊 Quota Monitoring

Monitor your Firebase usage to stay within free tier limits:

```bash
# Check current quota usage
npm run quota-check

# Generate detailed report
npm run quota-check -- --report

# Watch quota usage in real-time
npm run quota-check -- --watch
```

## 🛠️ Development Scripts

```bash
# Start development server with emulators
npm run dev

# Start with emulator UI
npm run dev:ui

# Deploy to production
npm run deploy

# Serve locally (production build)
npm run serve

# Export emulator data
npm run emulator:export

# Import emulator data
npm run emulator:import

# Check Firebase quota usage
npm run quota-check
```

## 📱 PWA Features

The app includes Progressive Web App features:

- **Offline Support** - Works without internet connection
- **Push Notifications** - Real-time tournament updates
- **App Installation** - Can be installed on mobile devices
- **Background Sync** - Syncs data when connection is restored

## 🔒 Security Features

- **Firestore Security Rules** - Role-based access control
- **Input Validation** - Client and server-side validation
- **Rate Limiting** - Prevents abuse and quota exhaustion
- **Audit Logging** - Comprehensive transaction logging
- **Error Handling** - Graceful error handling and user feedback

## 📈 Free Tier Optimization

The platform is optimized for Firebase free tier:

- **Aggressive Caching** - Minimizes Firestore reads
- **Batch Operations** - Reduces write operations
- **FCM for Real-time** - Uses FCM instead of constant Firestore listeners
- **Emulator Development** - Preserves production quotas during development
- **Quota Monitoring** - Real-time usage tracking and alerts

## 🎮 Usage

### For Players
1. Visit the platform and create an account
2. Set your game UIDs (PUBG Mobile, FreeFire)
3. Join tournaments and compete
4. Manage your wallet and withdraw winnings

### For Admins
1. Access admin panel at `/admin.html`
2. Login with admin credentials
3. Manage tournaments, users, and transactions
4. Process deposits and withdrawals
5. Monitor platform analytics

## 🔧 Configuration Files

- `firebase-config.js` - Firebase initialization and quota management
- `firebase.json` - Firebase project configuration
- `firestore.rules` - Database security rules
- `firestore.indexes.json` - Database indexes for optimal queries
- `firebase-messaging-sw.js` - Service worker for push notifications
- `manifest.json` - PWA configuration

## 📚 Architecture

```
├── firebase-config.js      # Firebase initialization
├── firebase-init.js        # Firebase utilities and auth management
├── firebase-messaging-sw.js # Service worker for notifications
├── firestore.rules         # Database security rules
├── firestore.indexes.json  # Database indexes
├── index.html             # Main user interface
├── admin.html             # Admin panel
├── manifest.json          # PWA configuration
├── scripts/
│   └── check-quota.js     # Quota monitoring script
└── package.json           # Dependencies and scripts
```

## 🚨 Important Notes

1. **Replace Configuration** - Update `firebase-config.js` with your actual Firebase project details
2. **VAPID Key** - Add your VAPID key for push notifications in `firebase-init.js`
3. **Security Rules** - Review and customize `firestore.rules` for your needs
4. **Quota Limits** - Monitor usage regularly to avoid exceeding free tier limits
5. **Admin Setup** - Create admin users with custom claims in Firebase Console

## 📞 Support

For issues and questions:
1. Check Firebase documentation
2. Review console logs for errors
3. Use Firebase emulators for debugging
4. Monitor quota usage with the included script

## 📄 License

MIT License - see LICENSE file for details.

---

**Built with ❤️ for the gaming community**