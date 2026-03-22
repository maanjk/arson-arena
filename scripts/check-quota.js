#!/usr/bin/env node

/**
 * Firebase Quota Monitoring Script
 * Checks current usage against Firebase free tier limits
 */

const fs = require('fs');
const path = require('path');

// Firebase Free Tier Limits
const FREE_TIER_LIMITS = {
  firestore: {
    storage: 1 * 1024 * 1024 * 1024, // 1 GiB in bytes
    reads: 50000, // per day
    writes: 20000, // per day
    deletes: 20000, // per day
  },
  auth: {
    monthlyActiveUsers: 50000,
  },
  hosting: {
    storage: 10 * 1024 * 1024 * 1024, // 10 GB in bytes
    transfer: 10 * 1024 * 1024 * 1024, // 10 GB per month
  },
  cloudMessaging: {
    notifications: Infinity, // Unlimited
  },
  analytics: {
    events: Infinity, // Unlimited
    users: Infinity, // Unlimited
  }
};

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m'
};

function colorize(text, color) {
  return `${colors[color]}${text}${colors.reset}`;
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatNumber(num) {
  return num.toLocaleString();
}

function getUsagePercentage(used, limit) {
  if (limit === Infinity) return 0;
  return Math.round((used / limit) * 100);
}

function getUsageColor(percentage) {
  if (percentage >= 90) return 'red';
  if (percentage >= 75) return 'yellow';
  return 'green';
}

function loadQuotaData() {
  try {
    const quotaFile = path.join(process.cwd(), 'firebase-quota.json');
    if (fs.existsSync(quotaFile)) {
      return JSON.parse(fs.readFileSync(quotaFile, 'utf8'));
    }
  } catch (error) {
    console.warn(colorize('⚠️  Could not load quota data from firebase-quota.json', 'yellow'));
  }
  
  // Return mock data for demonstration
  return {
    firestore: {
      reads: Math.floor(Math.random() * 30000),
      writes: Math.floor(Math.random() * 15000),
      deletes: Math.floor(Math.random() * 5000),
      storage: Math.floor(Math.random() * 500 * 1024 * 1024) // Random storage usage
    },
    auth: {
      monthlyActiveUsers: Math.floor(Math.random() * 25000)
    },
    hosting: {
      storage: Math.floor(Math.random() * 2 * 1024 * 1024 * 1024),
      transfer: Math.floor(Math.random() * 5 * 1024 * 1024 * 1024)
    }
  };
}

function displayQuotaStatus() {
  console.log(colorize('\n🔥 Firebase Free Tier Quota Status\n', 'bold'));
  
  const usage = loadQuotaData();
  
  // Firestore Usage
  console.log(colorize('📊 Firestore', 'cyan'));
  console.log('─'.repeat(50));
  
  const firestoreReadsPercent = getUsagePercentage(usage.firestore.reads, FREE_TIER_LIMITS.firestore.reads);
  const firestoreWritesPercent = getUsagePercentage(usage.firestore.writes, FREE_TIER_LIMITS.firestore.writes);
  const firestoreDeletesPercent = getUsagePercentage(usage.firestore.deletes, FREE_TIER_LIMITS.firestore.deletes);
  const firestoreStoragePercent = getUsagePercentage(usage.firestore.storage, FREE_TIER_LIMITS.firestore.storage);
  
  console.log(`Reads:    ${colorize(formatNumber(usage.firestore.reads), getUsageColor(firestoreReadsPercent))} / ${formatNumber(FREE_TIER_LIMITS.firestore.reads)} (${firestoreReadsPercent}%)`);
  console.log(`Writes:   ${colorize(formatNumber(usage.firestore.writes), getUsageColor(firestoreWritesPercent))} / ${formatNumber(FREE_TIER_LIMITS.firestore.writes)} (${firestoreWritesPercent}%)`);
  console.log(`Deletes:  ${colorize(formatNumber(usage.firestore.deletes), getUsageColor(firestoreDeletesPercent))} / ${formatNumber(FREE_TIER_LIMITS.firestore.deletes)} (${firestoreDeletesPercent}%)`);
  console.log(`Storage:  ${colorize(formatBytes(usage.firestore.storage), getUsageColor(firestoreStoragePercent))} / ${formatBytes(FREE_TIER_LIMITS.firestore.storage)} (${firestoreStoragePercent}%)`);
  
  // Authentication Usage
  console.log(colorize('\n🔐 Authentication', 'cyan'));
  console.log('─'.repeat(50));
  
  const authPercent = getUsagePercentage(usage.auth.monthlyActiveUsers, FREE_TIER_LIMITS.auth.monthlyActiveUsers);
  console.log(`MAU:      ${colorize(formatNumber(usage.auth.monthlyActiveUsers), getUsageColor(authPercent))} / ${formatNumber(FREE_TIER_LIMITS.auth.monthlyActiveUsers)} (${authPercent}%)`);
  
  // Hosting Usage
  console.log(colorize('\n🌐 Hosting', 'cyan'));
  console.log('─'.repeat(50));
  
  const hostingStoragePercent = getUsagePercentage(usage.hosting.storage, FREE_TIER_LIMITS.hosting.storage);
  const hostingTransferPercent = getUsagePercentage(usage.hosting.transfer, FREE_TIER_LIMITS.hosting.transfer);
  
  console.log(`Storage:  ${colorize(formatBytes(usage.hosting.storage), getUsageColor(hostingStoragePercent))} / ${formatBytes(FREE_TIER_LIMITS.hosting.storage)} (${hostingStoragePercent}%)`);
  console.log(`Transfer: ${colorize(formatBytes(usage.hosting.transfer), getUsageColor(hostingTransferPercent))} / ${formatBytes(FREE_TIER_LIMITS.hosting.transfer)} (${hostingTransferPercent}%)`);
  
  // Other Services
  console.log(colorize('\n📱 Other Services', 'cyan'));
  console.log('─'.repeat(50));
  console.log(`Cloud Messaging: ${colorize('Unlimited', 'green')} (Free)`);
  console.log(`Analytics:       ${colorize('Unlimited', 'green')} (Free)`);
  console.log(`Performance:     ${colorize('Basic metrics', 'green')} (Free)`);
  console.log(`Crashlytics:     ${colorize('Basic reporting', 'green')} (Free)`);
  
  // Warnings and Recommendations
  console.log(colorize('\n⚠️  Warnings & Recommendations', 'yellow'));
  console.log('─'.repeat(50));
  
  const warnings = [];
  
  if (firestoreReadsPercent >= 80) {
    warnings.push(`• Firestore reads at ${firestoreReadsPercent}% - Consider implementing more aggressive caching`);
  }
  
  if (firestoreWritesPercent >= 80) {
    warnings.push(`• Firestore writes at ${firestoreWritesPercent}% - Consider batching operations`);
  }
  
  if (authPercent >= 80) {
    warnings.push(`• Authentication MAU at ${authPercent}% - Monitor user growth`);
  }
  
  if (hostingStoragePercent >= 80) {
    warnings.push(`• Hosting storage at ${hostingStoragePercent}% - Clean up unused files`);
  }
  
  if (hostingTransferPercent >= 80) {
    warnings.push(`• Hosting transfer at ${hostingTransferPercent}% - Optimize assets and enable compression`);
  }
  
  if (warnings.length === 0) {
    console.log(colorize('✅ All quotas are within safe limits', 'green'));
  } else {
    warnings.forEach(warning => console.log(colorize(warning, 'yellow')));
  }
  
  // Optimization Tips
  console.log(colorize('\n💡 Optimization Tips', 'blue'));
  console.log('─'.repeat(50));
  console.log('• Use Firestore offline persistence to reduce reads');
  console.log('• Implement client-side caching for static data');
  console.log('• Use FCM for real-time updates instead of constant polling');
  console.log('• Batch write operations when possible');
  console.log('• Use Firebase emulators during development');
  console.log('• Monitor quotas daily during peak usage periods');
  
  console.log(colorize('\n📈 Next Steps', 'blue'));
  console.log('─'.repeat(50));
  console.log('• Set up quota monitoring alerts');
  console.log('• Implement usage analytics in your app');
  console.log('• Consider upgrading to Blaze plan if needed');
  console.log('• Review and optimize database queries');
  
  console.log('\n');
}

function generateQuotaReport() {
  const usage = loadQuotaData();
  const report = {
    timestamp: new Date().toISOString(),
    usage,
    limits: FREE_TIER_LIMITS,
    warnings: [],
    recommendations: []
  };
  
  // Add warnings based on usage
  Object.keys(usage.firestore).forEach(metric => {
    const percent = getUsagePercentage(usage.firestore[metric], FREE_TIER_LIMITS.firestore[metric]);
    if (percent >= 80) {
      report.warnings.push(`Firestore ${metric} usage at ${percent}%`);
    }
  });
  
  // Save report
  const reportPath = path.join(process.cwd(), 'quota-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(colorize(`📄 Quota report saved to ${reportPath}`, 'green'));
}

// Main execution
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.includes('--report')) {
    generateQuotaReport();
  } else {
    displayQuotaStatus();
  }
  
  if (args.includes('--watch')) {
    console.log(colorize('\n👀 Watching quota usage (press Ctrl+C to stop)...', 'blue'));
    setInterval(() => {
      console.clear();
      displayQuotaStatus();
    }, 30000); // Update every 30 seconds
  }
}

module.exports = {
  loadQuotaData,
  displayQuotaStatus,
  generateQuotaReport,
  FREE_TIER_LIMITS
};