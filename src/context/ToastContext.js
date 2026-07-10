import React, { createContext, useContext, useState, useCallback } from 'react';

const ToastCtx = createContext({ showToast: () => {} });

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const showToast = useCallback(({ title, message, type = 'success' }) => {
    const id = Date.now() + Math.random();
    setToasts(p => [...p, { id, title, message, type }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 3500);
  }, []);

  const dismiss = useCallback(id => setToasts(p => p.filter(t => t.id !== id)), []);

  return (
    <ToastCtx.Provider value={{ showToast }}>
      {children}
      {/* Toast container — fixed top-right */}
      <div style={{
        position: 'fixed', top: 20, right: 20, zIndex: 9999,
        display: 'flex', flexDirection: 'column', gap: 10,
        pointerEvents: 'none',
      }}>
        {toasts.map(t => (
          <div key={t.id} style={{
            background: 'var(--bg-card)',
            border: `1px solid ${t.type === 'error' ? 'rgba(240,86,110,.4)' : 'rgba(59,130,246,.35)'}`,
            borderLeft: `3px solid ${t.type === 'error' ? 'var(--loss)' : 'var(--accent)'}`,
            borderRadius: 10,
            padding: '12px 16px',
            minWidth: 240, maxWidth: 320,
            boxShadow: '0 8px 32px rgba(0,0,0,.5)',
            display: 'flex', alignItems: 'flex-start', gap: 12,
            pointerEvents: 'all',
            animation: 'toastIn .2s ease',
          }}>
            <div style={{
              width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
              background: t.type === 'error' ? 'var(--loss-dim)' : 'var(--accent-dim)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, marginTop: 1,
            }}>
              {t.type === 'error' ? '✕' : '✓'}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)', marginBottom: 2 }}>{t.title}</div>
              {t.message && <div style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.message}</div>}
            </div>
            <button onClick={() => dismiss(t.id)} style={{
              background: 'none', border: 'none', color: 'var(--text-muted)',
              cursor: 'pointer', fontSize: 14, padding: 0, lineHeight: 1, flexShrink: 0,
            }}>✕</button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);
