import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  type User,
} from 'firebase/auth';
import { useEffect, useState, type ReactNode, type FormEvent } from 'react';
import { configureAuth, getClientAuth } from './auth-client';
import { GUEST_ID } from './session';
export default function AuthGate({
  children,
}: {
  children: (user: Pick<User, 'uid' | 'email'>, onSignIn: () => void) => ReactNode;
}) {
  const [showLogin, setShowLogin] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  useEffect(() => {
    let disposed = false;
    let unsubscribe = () => {};
    void (async () => {
      try {
        const auth = await configureAuth();
        if (disposed) return;
        setConfigured(true);
        unsubscribe = onAuthStateChanged(auth, (value) => {
          setUser(value);
          if (value) setShowLogin(false);
          setReady(true);
        });
      } catch (e) {
        if (!disposed) {
          setError(e instanceof Error ? e.message : 'Sign-in unavailable.');
          setReady(true);
        }
      }
    })();
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);
  async function login(mode: 'google' | 'email' | 'create') {
    const auth = getClientAuth();
    if (!auth) return;
    setPending(true);
    setError('');
    try {
      if (mode === 'google') await signInWithPopup(auth, new GoogleAuthProvider());
      else if (mode === 'create') await createUserWithEmailAndPassword(auth, email, password);
      else await signInWithEmailAndPassword(auth, email, password);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed.');
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      {children(user || { uid: GUEST_ID, email: null }, () => setShowLogin(true))}
      {showLogin && (
        <div
          className="modal-backdrop topmost"
          role="dialog"
          aria-modal="true"
          aria-label="Optional cloud sign-in"
        >
          <section className="settings-card auth-card">
            <button className="secondary-button" onClick={() => setShowLogin(false)}>
              Continue as guest
            </button>
            <h1>TaskFlow</h1>
            <p>
              Optional cloud account. Guest tasks stay in this browser and are never uploaded
              automatically.
            </p>
            {error && <p role="alert">{error}</p>}
            {!ready && <p role="status">Loading sign-in…</p>}
            {configured && (
              <>
                <button
                  className="primary-button"
                  disabled={pending}
                  onClick={() => void login('google')}
                >
                  Continue with Google
                </button>
                <form
                  onSubmit={(e: FormEvent) => {
                    e.preventDefault();
                    void login('email');
                  }}
                >
                  <label>
                    Email
                    <input
                      aria-label="Email"
                      type="email"
                      autoComplete="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </label>
                  <label>
                    Password
                    <input
                      aria-label="Password"
                      type="password"
                      minLength={8}
                      autoComplete="current-password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </label>
                  <button className="primary-button" disabled={pending}>
                    Sign in
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={pending || !email || password.length < 8}
                    onClick={() => void login('create')}
                  >
                    Create account
                  </button>
                </form>
              </>
            )}
          </section>
        </div>
      )}
    </>
  );
}
