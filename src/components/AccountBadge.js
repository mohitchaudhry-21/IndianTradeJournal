import React from 'react';
import { useJournal } from '../context/JournalContext';

/**
 * Shows the active account name as a blue pill next to a page title.
 * Renders nothing when "All Accounts" is selected.
 */
export default function AccountBadge() {
  const { accounts, activeAccountId, setActiveAccountId } = useJournal();
  if (!activeAccountId) return null;
  const acc = accounts.find(a => a.id === activeAccountId);
  if (!acc) return null;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{
        fontSize: 12, background: 'var(--accent-dim)', color: 'var(--accent)',
        padding: '3px 12px', borderRadius: 20, fontWeight: 600,
        border: '1px solid rgba(59,130,246,0.25)',
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: acc.color || 'var(--accent)', display: 'inline-block' }} />
        {acc.name}
      </span>
      <button
        onClick={() => setActiveAccountId('')}
        title="Show all accounts"
        style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: '2px' }}
      >×</button>
    </div>
  );
}
