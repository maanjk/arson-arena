// Utility script to promote a user to administrator
// Run this via browser console if you have the uid

import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase-config.js';

export async function promoteToAdmin(uid) {
    try {
        const userRef = doc(db, 'users', uid);
        await setDoc(userRef, {
            isAdmin: true,
            updatedAt: serverTimestamp()
        }, { merge: true });
        console.log(`✅ User ${uid} promoted to admin successfully`);
        return true;
    } catch (error) {
        console.error('❌ Failed to promote user to admin:', error);
        return false;
    }
}

window.promoteToAdmin = promoteToAdmin;
