import { initializeApp, getApps } from 'firebase/app';
import { browserLocalPersistence, getAuth, GoogleAuthProvider, setPersistence } from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Keep users signed in across tab switches, reloads, and browser restarts until explicit sign-out
void setPersistence(auth, browserLocalPersistence).catch(() => {
  // ignore persistence errors in restricted browser modes
});

export const googleAuthProvider = new GoogleAuthProvider();
googleAuthProvider.setCustomParameters({ prompt: 'select_account' });
