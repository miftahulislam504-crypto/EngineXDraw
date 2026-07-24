'use client';

import { create } from 'zustand';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth';
import { auth } from './firebase-client';

/** Keys into the `auth` translation namespace — the store picks WHICH
 * error occurred, but doesn't hardcode English text, so any locale can
 * render it. See Translations['auth'] for the matching string keys. */
export type AuthErrorKey =
  | 'errorWrongCredentials'
  | 'errorEmailInUse'
  | 'errorWeakPassword'
  | 'errorGeneric';

interface AuthState {
  user: User | null;
  isLoading: boolean;
  errorKey: AuthErrorKey | null;
  signIn: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,
  errorKey: null,

  signIn: async (email, password) => {
    set({ errorKey: null });
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      set({ errorKey: authErrorKeyFor(err) });
      throw err;
    }
  },

  register: async (name, email, password) => {
    set({ errorKey: null });
    try {
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(credential.user, { displayName: name });
    } catch (err) {
      set({ errorKey: authErrorKeyFor(err) });
      throw err;
    }
  },

  signOut: async () => {
    await firebaseSignOut(auth);
  },

  clearError: () => set({ errorKey: null }),
}));

// Wire up the Firebase listener once, outside the store creator, so it
// isn't re-subscribed on every render.
onAuthStateChanged(auth, (user) => {
  useAuthStore.setState({ user, isLoading: false });
});

function authErrorKeyFor(err: unknown): AuthErrorKey {
  const code = (err as { code?: string })?.code ?? '';
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'errorWrongCredentials';
    case 'auth/email-already-in-use':
      return 'errorEmailInUse';
    case 'auth/weak-password':
      return 'errorWeakPassword';
    default:
      return 'errorGeneric';
  }
}
