#!/usr/bin/env node

/**
 * Setup Verification Script
 * Checks if Firebase is properly configured and the project is ready to run
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  bold: '\x1b[1m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function check(message, passed) {
  const icon = passed ? '✅' : '❌';
  const color = passed ? 'green' : 'red';
  log(`${icon} ${message}`, color);
  return passed;
}

async function verifySetup() {
  log('\n🔍 ARSON Arena Firebase Setup Verification\n', 'bold');
  
  let allPassed = true;
  
  // Check 1: Firebase config file exists and has real values
  log('\n📋 Checking Firebase Configuration...', 'blue');
  try {
    const firebaseConfigPath = path.join(__dirname, 'firebase-config.js');
    const configContent = fs.readFileSync(firebaseConfigPath, 'utf8');
    
    const hasPlaceholder = configContent.includes('your-api-key-here') ||
                          configContent.includes('your-project-id');
    
    allPassed &= check(
      'Firebase config file exists',
      fs.existsSync(firebaseConfigPath)
    );
    
    allPassed &= check(
      'Firebase config has been updated (not using placeholder values)',
      !hasPlaceholder
    );
    
    if (hasPlaceholder) {
      log('\n⚠️  WARNING: You need to update firebase-config.js with your actual Firebase project credentials', 'yellow');
      log('   Get your credentials from: https://console.firebase.google.com', 'yellow');
    }
  } catch (error) {
    allPassed &= check('Firebase config file readable', false);
  }
  
  // Check 2: Required files exist
  log('\n📁 Checking Required Files...', 'blue');
  const requiredFiles = [
    'index.html',
    'admin.html',
    'firebase-init.js',
    'firebase-config.js',
    'firestore.rules',
    'firestore.indexes.json',
    'firebase.json',
    'manifest.json',
    'firebase-messaging-sw.js',
    'app-integration.js',
    'auth-manager.js',
    'database-manager.js',
    'tournament-manager.js',
    'wallet-service.js',
    'notification-manager.js'
  ];
  
  for (const file of requiredFiles) {
    const exists = fs.existsSync(path.join(__dirname, file));
    allPassed &= check(`File: ${file}`, exists);
  }
  
  // Check 3: Package.json scripts
  log('\n📦 Checking Package Configuration...', 'blue');
  try {
    const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
    
    allPassed &= check(
      'package.json has dev script',
      packageJson.scripts && packageJson.scripts.dev
    );
    
    allPassed &= check(
      'package.json has deploy script',
      packageJson.scripts && packageJson.scripts.deploy
    );
    
    allPassed &= check(
      'Firebase SDK dependency present',
      packageJson.dependencies && packageJson.dependencies.firebase
    );
  } catch (error) {
    allPassed &= check('package.json readable', false);
  }
  
  // Check 4: Firebase CLI
  log('\n🔧 Checking Firebase CLI...', 'blue');
  try {
    const { execSync } = await import('child_process');
    const version = execSync('firebase --version', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    allPassed &= check(`Firebase CLI installed (v${version.trim()})`, true);
  } catch (error) {
    allPassed &= check('Firebase CLI installed', false);
    log('\n⚠️  WARNING: Firebase CLI not found. Install with: npm install -g firebase-tools', 'yellow');
  }
  
  // Check 5: Node modules
  log('\n📚 Checking Dependencies...', 'blue');
  const nodeModulesExists = fs.existsSync(path.join(__dirname, 'node_modules'));
  allPassed &= check('node_modules directory exists', nodeModulesExists);
  
  if (!nodeModulesExists) {
    log('\n⚠️  WARNING: Run "npm install" to install dependencies', 'yellow');
  }
  
  // Check 6: Firestore rules
  log('\n🔒 Checking Security Rules...', 'blue');
  try {
    const rulesPath = path.join(__dirname, 'firestore.rules');
    const rulesContent = fs.readFileSync(rulesPath, 'utf8');
    
    allPassed &= check(
      'Firestore rules have authentication checks',
      rulesContent.includes('isAuthenticated()')
    );
    
    allPassed &= check(
      'Firestore rules have admin checks',
      rulesContent.includes('isAdmin()')
    );
  } catch (error) {
    allPassed &= check('Firestore rules readable', false);
  }
  
  // Summary
  log('\n' + '='.repeat(60), 'bold');
  if (allPassed) {
    log('\n✨ All checks passed! Your project is ready.', 'green');
    log('\nNext steps:', 'bold');
    log('1. Run: npm run dev     (Start development server)');
    log('2. Open: http://localhost:5000');
    log('3. Run: npm run deploy  (When ready to deploy)');
  } else {
    log('\n⚠️  Some checks failed. Please fix the issues above.', 'yellow');
    log('\nSetup instructions:', 'bold');
    log('1. Create Firebase project at: https://console.firebase.google.com');
    log('2. Enable Auth, Firestore, and Hosting');
    log('3. Update firebase-config.js with your credentials');
    log('4. Run: npm install');
    log('5. Run: firebase login');
    log('6. Run: npm run dev');
  }
  log('='.repeat(60) + '\n', 'bold');
  
  process.exit(allPassed ? 0 : 1);
}

verifySetup().catch(error => {
  console.error('❌ Verification failed:', error.message);
  process.exit(1);
});
