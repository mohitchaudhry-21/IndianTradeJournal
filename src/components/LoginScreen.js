import React, { useState } from 'react';

const SESSION_KEY = 'od_auth_session';
const PW_KEY      = 'od_pw_hash';

async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

export function isAuthEnabled()  { return !!localStorage.getItem(PW_KEY); }
export function isAuthenticated(){ return sessionStorage.getItem(SESSION_KEY) === 'yes'; }
export function getPasswordHash(){ return localStorage.getItem(PW_KEY) || ''; }

export async function setPassword(newPw) {
  if (!newPw) { localStorage.removeItem(PW_KEY); return; }
  const hash = await sha256(newPw);
  localStorage.setItem(PW_KEY, hash);
}

export function logout() {
  sessionStorage.removeItem(SESSION_KEY);
  window.location.reload();
}

export default function LoginScreen() {
  const [pin,     setPin]     = useState('');
  const [error,   setError]   = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!pin) return;
    setLoading(true); setError('');
    try {
      const hash   = await sha256(pin);
      const stored = localStorage.getItem(PW_KEY);
      if (hash === stored) {
        sessionStorage.setItem(SESSION_KEY, 'yes');
        window.location.reload();
      } else {
        setError('Incorrect PIN. Try again.');
        setPin('');
      }
    } catch { setError('Something went wrong.'); }
    setLoading(false);
  };

  return (
    <div style={{
      minHeight: '100vh', background: '#080A10',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: "'Sora', sans-serif",
    }}>
      <div style={{
        background: '#0D111C', border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 16, padding: '40px 44px', width: 360, textAlign: 'center',
        boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
      }}>
        {/* Logo */}
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>◈</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#E4EBF8', letterSpacing: '-0.3px' }}>OptionsDesk</div>
          <div style={{ fontSize: 13, color: '#4A5670', marginTop: 4 }}>Enter your PIN to continue</div>
        </div>

        <form onSubmit={handleSubmit}>
          <input
            autoFocus
            type="password"
            value={pin}
            onChange={e => setPin(e.target.value)}
            placeholder="Enter PIN or password"
            maxLength={32}
            style={{
              width: '100%', padding: '12px 16px',
              background: '#080A10', border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 8, color: '#E4EBF8', fontFamily: "'Sora',sans-serif",
              fontSize: 15, outline: 'none', marginBottom: 14,
              textAlign: 'center', letterSpacing: pin ? '0.3em' : '0',
              transition: 'border-color .15s',
            }}
            onFocus={e => e.target.style.borderColor = '#3B82F6'}
            onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.12)'}
          />

          {error && (
            <div style={{ color: '#F0566E', fontSize: 13, marginBottom: 14, padding: '8px', background: 'rgba(240,86,110,0.1)', borderRadius: 6 }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !pin}
            style={{
              width: '100%', padding: '12px', background: '#3B82F6',
              border: 'none', borderRadius: 8, color: '#fff',
              fontFamily: "'Sora',sans-serif", fontSize: 14, fontWeight: 600,
              cursor: pin ? 'pointer' : 'not-allowed', opacity: pin ? 1 : 0.5,
              transition: 'all .15s',
            }}
          >
            {loading ? 'Verifying...' : 'Unlock →'}
          </button>
        </form>

        <div style={{ marginTop: 20, fontSize: 11, color: '#4A5670' }}>
          Secured with SHA-256 encryption
        </div>
      </div>
    </div>
  );
}
