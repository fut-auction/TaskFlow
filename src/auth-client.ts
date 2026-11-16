import { GUEST_ID } from './session';
import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signOut, type Auth } from 'firebase/auth';
let auth: Auth | null = null;
let setup: Promise<Auth> | null = null;
export function configureAuth(): Promise<Auth> {
  if (!setup)
    setup = (async () => {
      const response = await fetch('/api/config');
      const config = await response.json();
      if (!response.ok || !config.firebase)
        throw new Error(
          config.error || 'Cloud sign-in is not configured. You can keep using the local workspace.',
        );
      auth = getAuth(initializeApp(config.firebase));
      if (config.authEmulator)
        connectAuthEmulator(auth, `http://${config.authEmulator}`, { disableWarnings: true });
      return auth;
    })().catch((error) => {
      setup = null;
      throw error;
    });
  return setup;
}
export const getClientAuth = () => auth;
export async function authHeaders(expectedUid?: string): Promise<Record<string, string>> {
  if (expectedUid === GUEST_ID) return {};
  if (!auth?.currentUser || (expectedUid && auth.currentUser.uid !== expectedUid))
    throw new Error('Sign in to continue.');
  return { Authorization: `Bearer ${await auth.currentUser.getIdToken()}` };
}
export const logout = () => (auth ? signOut(auth) : Promise.resolve());
