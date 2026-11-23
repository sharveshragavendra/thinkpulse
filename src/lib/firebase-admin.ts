import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import firebaseConfig from '../../firebase-applet-config.json' with { type: 'json' };

if (!getApps().length) {
  initializeApp({
    projectId: process.env.FIREBASE_PROJECT_ID?.trim() || firebaseConfig.projectId,
  });
}

export const adminAuth = getAuth();
