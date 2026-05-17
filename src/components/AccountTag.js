import React from 'react';
import { useJournal } from '../context/JournalContext';

/**
 * Shows a small coloured account pill only when viewing All Accounts.
 * Pass accountId — renders nothing if a specific account is filtered.
 */
export default function AccountTag({ accountId, style = {} }) {
  const { accounts, activeAccountId } = useJournal();
  if (activeAccountId) return null;           // specific account selected — no tag needed
  if (!accountId) return null;
  const acc = accounts.find(a => a.id === accountId);
  if (!acc) return null;

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontSize: 10, fontWeight: 600, letterSpacing: '0.04em',
      padding: '2px 7px', borderRadius: 10,
      background: (acc.color || '#3B82F6') + '22',
      color: acc.color || '#3B82F6',
      border: `1px solid ${acc.color || '#3B82F6'}44`,
      whiteSpace: 'nowrap',
      ...style,
    }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: acc.color || '#3B82F6', flexShrink: 0 }} />
      {acc.name}
    </span>
  );
}
