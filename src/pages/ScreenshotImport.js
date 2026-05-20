import React, { useState, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useJournal } from '../context/JournalContext';
import { useNavigate } from 'react-router-dom';
import Tesseract from 'tesseract.js';

// ─── Lot sizes ────────────────────────────────────────────────────────────────
const DEFAULT_LOT_SIZES = {
  NIFTY: 65, BANKNIFTY: 15, FINNIFTY: 25,
  MIDCPNIFTY: 75, SENSEX: 20, BANKEX: 15,
};
function getLotSize(inst) {
  for (const [k, v] of Object.entries(DEFAULT_LOT_SIZES))
    if (String(inst).toUpperCase().startsWith(k)) return v;
  return 1;
}

// ─── Strategy detector ────────────────────────────────────────────────────────
function detectStrategy(legs) {
  const sells = legs.filter(t => t.transactionType === 'SELL');
  const buys  = legs.filter(t => t.transactionType === 'BUY');
  const ce_s = sells.filter(t => t.optionType === 'CE');
  const pe_s = sells.filter(t => t.optionType === 'PE');
  const ce_b = buys.filter(t => t.optionType === 'CE');
  const pe_b = buys.filter(t => t.optionType === 'PE');
  if (legs.length === 1) return 'Single Leg';
  if (ce_s.length && pe_s.length && !buys.length)
    return ce_s[0]?.strike === pe_s[0]?.strike ? 'Straddle' : 'Strangle';
  if (pe_s.length && pe_b.length && !ce_s.length) return 'Bull Put Spread';
  if (ce_s.length && ce_b.length && !pe_s.length) return 'Bear Call Spread';
  if (ce_s.length && pe_s.length && ce_b.length && pe_b.length) return 'Iron Condor';
  if (ce_s.length && pe_s.length && (ce_b.length || pe_b.length)) return 'Strangle';
  return 'Custom';
}

// ─── Gemini API ───────────────────────────────────────────────────────────────
const GEMINI_PROMPT = `Extract all option positions from this broker app screenshot.
Return ONLY a raw JSON array (no markdown, no backticks, no explanation).

CRITICAL RULES:
1. "X Lots" means lots=X. NEVER prepend the lot count to any price.
   e.g. "3 Lots ... Buy Rs54.89" → lots:3, avgPrice:54.89 (NOT 354.89)
   e.g. "3 Lots ... Sell Rs105.73" → lots:3 (NOT 3105.73)

2. Each closed position shows both a buy average AND a sell average.
   Compare them to determine direction:
   - Sell avg > Buy avg → transactionType:"SELL", avgPrice=sell avg, exitPremium=buy avg
   - Buy avg > Sell avg → transactionType:"BUY",  avgPrice=buy avg,  exitPremium=sell avg
   e.g. Buy Rs12.05 Sell Rs105.73 → SELL, avgPrice:105.73, exitPremium:12.05
   e.g. Buy Rs54.89 Sell Rs5.30   → BUY,  avgPrice:54.89,  exitPremium:5.30

3. status: "CLOSED" if both buy avg and sell avg present, else "OPEN"

4. Lot sizes (use these, ignore screenshot): NIFTY:65 BANKNIFTY:15 FINNIFTY:25 MIDCPNIFTY:75 SENSEX:20 BANKEX:15

5. expiry format: YYYY-MM-DD

Output each leg as:
{"instrument":"NIFTY","expiry":"2026-05-19","strike":22850,"optionType":"PE","transactionType":"BUY","lots":3,"avgPrice":54.89,"exitPremium":5.30,"lotSize":65,"status":"CLOSED"}

Return [] if no positions found.`;

async function extractWithGemini(imageFile, apiKey) {
  const base64 = await new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload = () => res(reader.result.split(',')[1]);
    reader.onerror = rej;
    reader.readAsDataURL(imageFile);
  });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { inline_data: { mime_type: imageFile.type || 'image/jpeg', data: base64 } },
          { text: GEMINI_PROMPT },
        ]
      }],
      generationConfig: { temperature: 0, maxOutputTokens: 1000 },
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Gemini API error ${res.status}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
  const clean = text.replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}

// ─── Tesseract OCR fallback parser ────────────────────────────────────────────
const MONTHS = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
const INSTRUMENTS = ['BANKNIFTY','MIDCPNIFTY','FINNIFTY','BANKEX','SENSEX','NIFTY'];

// Extract a rupee price from a text segment.
// Handles: "₹54.89", "Rs54.89", and "354.89" where 3 is ₹ misread by OCR.
function parseRupeePrice(seg) {
  if (!seg) return 0;
  // Explicit ₹ or Rs symbol — trust the number as-is
  let m = seg.match(/(?:₹|Rs\.?)\s*(\d+\.?\d*)/i);
  if (m) return parseFloat(m[1]);
  // No symbol — ₹ may have been OCR'd as "3". Strip a leading "3" only when
  // the raw number looks too large to be an option premium on its own.
  m = seg.match(/\b(\d+\.\d{1,2})\b/);
  if (!m) return 0;
  const raw = parseFloat(m[1]);
  // If starts with "3" and removing it gives a plausible smaller premium, strip it
  if (m[1].charAt(0) === '3' && raw > 300) {
    const stripped = parseFloat(m[1].slice(1));
    if (stripped > 0 && stripped < raw / 3) return stripped;
  }
  return raw;
}

function parseOCRText(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const trades = [];
  let cur = null;
  let pendingLots = null;
  let pendingTx   = null;

  const parseExpiry = (day, mon, yr) => {
    const m = String(MONTHS[mon.toLowerCase()]).padStart(2,'0');
    const d = String(parseInt(day)).padStart(2,'0');
    const y = yr || new Date().getFullYear();
    return `${y}-${m}-${d}`;
  };

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    const upper = line.toUpperCase();
    const foundInst = INSTRUMENTS.find(i => upper.includes(i));

    const dateFullM  = line.match(/(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})/i);
    const dateShortM = !dateFullM && line.match(/(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/i);
    const strikePutCall = line.match(/\b(\d{4,6})\s*(PUT|CALL|PE|CE)\b/i);

    // ── Instrument line ───────────────────────────────────────────────────
    if (foundInst && strikePutCall && (dateFullM || dateShortM)) {
      if (cur?.instrument && cur.avgPrice) trades.push(cur);
      const dm = dateFullM || dateShortM;
      const rawType = strikePutCall[2].toUpperCase();
      const optionType = rawType === 'PUT' ? 'PE' : rawType === 'CALL' ? 'CE' : rawType;

      if (pendingLots === null) {
        for (let back = 1; back <= 2; back++) {
          const prevL = lines[lineIdx - back] || '';
          if (/NRML|MIS/i.test(prevL)) {
            const numM = prevL.match(/^(-?\d+)/);
            const hasNeg = prevL.startsWith('-') || /^11/.test(prevL);
            pendingTx   = hasNeg ? 'SELL' : 'BUY';
            pendingLots = numM ? Math.abs(parseInt(numM[1])) : 1;
            if (pendingLots > 50 || pendingLots === 0) pendingLots = 1;
            break;
          }
        }
      }

      cur = {
        instrument: foundInst,
        expiry: parseExpiry(dm[1], dm[2], dm[3]),
        strike: parseInt(strikePutCall[1]),
        optionType,
        lots: pendingLots,
        avgPrice: null,
        lotSize: null,
        transactionType: pendingTx || null,
        _pb: null,
        _ps: null,
      };
      pendingLots = null; pendingTx = null;
      continue;
    }

    // ── Lots line ─────────────────────────────────────────────────────────
    const lotsM = line.match(/(-?\d+)\s*[Ll][Oo][Tt]s?/);
    if (lotsM) {
      const n      = parseInt(lotsM[1]);
      const absN   = Math.abs(n);
      const implTx = n < 0 ? 'SELL' : n > 0 ? 'BUY' : null;
      if (cur && cur.lots === null) {
        cur.lots = absN;
        if (implTx && !cur.transactionType) cur.transactionType = implTx;
      } else if (!cur) {
        pendingLots = absN;
        if (implTx) pendingTx = implTx;
      }
    }

    // ── BUY / SELL label (standalone badge, not price line) ───────────────
    if (cur && !cur.transactionType) {
      const hasBothPrices = /\bBuy[^a-zA-Z]*?\d+\.\d/.test(line) && /\bSell[^a-zA-Z]*?\d+\.\d/.test(line);
      if (!hasBothPrices) {
        if (/\bSELL\b/i.test(line)) cur.transactionType = 'SELL';
        else if (/\bBUY\b/i.test(line)) cur.transactionType = 'BUY';
      }
    }

    if (cur) {
      // ── Avg price (Angel One open positions) ─────────────────────────
      const avgM = line.match(/[Aa][Vv][Gg][^\d]*([\d]+\.?[\d]*)/);
      if (avgM && !cur.avgPrice) cur.avgPrice = parseFloat(avgM[1]);

      // ── Closed: extract Buy and Sell prices independently ─────────────
      // Split the line at the Buy/Sell keywords so numbers never bleed across
      const buyIdx  = line.search(/\bBuy\b/i);
      const sellIdx = line.search(/\bSell\b/i);

      if (buyIdx !== -1) {
        // Segment: from "Buy" up to "Sell" (or end of line)
        const end = sellIdx > buyIdx ? sellIdx : line.length;
        const seg = line.slice(buyIdx + 3, end);  // +3 skips "Buy"
        const p = parseRupeePrice(seg);
        if (p > 0) cur._pb = p;
      }
      if (sellIdx !== -1) {
        // Segment: from "Sell" up to "Buy" (or end of line)
        const end = buyIdx > sellIdx ? buyIdx : line.length;
        const seg = line.slice(sellIdx + 4, end);  // +4 skips "Sell"
        const p = parseRupeePrice(seg);
        if (p > 0) cur._ps = p;
      }

      // Once both prices present → determine direction
      if (cur._pb > 0 && cur._ps > 0 && !cur.isClosed) {
        cur.isClosed = true;
        if (cur._ps > cur._pb) {
          // Sell avg > Buy avg → originally SOLD (sold high, bought back low)
          cur.transactionType = 'SELL';
          cur.avgPrice  = cur._ps;  // entry price
          cur.exitPrice = cur._pb;  // exit price
        } else {
          // Buy avg > Sell avg → originally BOUGHT (bought high, sold lower)
          cur.transactionType = 'BUY';
          cur.avgPrice  = cur._pb;  // entry price
          cur.exitPrice = cur._ps;  // exit price
        }
      }

      // Lot size hint: "(1 Lot = 65)"
      const lsM = line.match(/1\s*[Ll]ot\s*[=:]\s*(\d+)/);
      if (lsM) cur.lotSize = parseInt(lsM[1]);
    }
  }

  if (cur?.instrument && cur.avgPrice) trades.push(cur);

  return trades
    .filter(t => t.instrument && t.strike && t.avgPrice)
    .map(t => ({
      ...t,
      lots:            t.lots || 1,
      transactionType: t.transactionType || null,
      lotSize:         t.lotSize || getLotSize(t.instrument),
      status:          t.isClosed ? 'CLOSED' : 'OPEN',
      exitPremium:     t.exitPrice || undefined,
      exitDate:        t.isClosed ? new Date().toISOString().slice(0,10) : undefined,
    }));
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function ScreenshotImport() {
  const { addTrades, accounts, settings } = useJournal();
  const navigate = useNavigate();
  const fileRef = useRef();

  const [image,     setImage]     = useState(null);
  const [status,    setStatus]    = useState('idle');
  const [progress,  setProgress]  = useState(0);
  const [edited,    setEdited]    = useState([]);
  const [rawText,   setRawText]   = useState('');
  const [errorMsg,  setErrorMsg]  = useState('');
  const [showRaw,   setShowRaw]   = useState(false);
  const [tradeDate, setTradeDate] = useState(new Date().toISOString().slice(0,10));
  const [accountId, setAccountId] = useState(accounts[0]?.id || '');
  const [method,    setMethod]    = useState('');

  const hasGemini = !!settings.geminiKey;

  const handleFile = (file) => {
    if (!file || !file.type.startsWith('image/')) return;
    setImage({ file, url: URL.createObjectURL(file) });
    setStatus('idle'); setEdited([]); setRawText(''); setErrorMsg('');
    setMethod(hasGemini ? 'gemini' : 'ocr');
  };

  const extract = async (forceMethod) => {
    if (!image) return;
    const useMethod = forceMethod || method || (hasGemini ? 'gemini' : 'ocr');
    setStatus('loading'); setProgress(0); setErrorMsg('');

    try {
      let trades = [];

      if (useMethod === 'gemini') {
        setMethod('gemini');
        const raw = await extractWithGemini(image.file, settings.geminiKey);
        setRawText('GEMINI RAW OUTPUT:\n' + JSON.stringify(raw, null, 2));
        setShowRaw(true);
        trades = raw.map(t => ({
          ...t,
          lotSize:     t.lotSize || getLotSize(t.instrument),
          status:      t.status || 'OPEN',
          exitPremium: t.exitPremium || t.exitPrice || undefined,
          exitDate:    t.status === 'CLOSED' ? (t.exitDate || new Date().toISOString().slice(0,10)) : undefined,
        }));
      } else {
        setMethod('ocr');
        const result = await Tesseract.recognize(image.file, 'eng', {
          logger: m => { if (m.status === 'recognizing text') setProgress(Math.round(m.progress * 100)); },
        });
        const text = result.data.text;
        setRawText(text);
        trades = parseOCRText(text);
      }

      if (!trades || trades.length === 0) {
        setErrorMsg(useMethod === 'gemini'
          ? 'No positions found. Make sure the screenshot shows your open positions clearly.'
          : 'No positions found via OCR. Try using Gemini (more accurate) or check the raw text.'
        );
        setStatus('error');
        if (useMethod === 'ocr') setShowRaw(true);
        return;
      }

      setEdited(trades.map(t => ({ ...t, id: uuidv4() })));
      setStatus('preview');
    } catch (e) {
      setErrorMsg((useMethod === 'gemini' ? 'Gemini error: ' : 'OCR error: ') + e.message);
      setStatus('error');
    }
  };

  const updateRow = (id, f, v) => setEdited(p => p.map(t => t.id === id ? { ...t, [f]: v } : t));
  const removeRow = (id) => setEdited(p => p.filter(t => t.id !== id));

  const confirmImport = () => {
    if (!edited.length) return;
    const positionId = uuidv4();
    addTrades(edited.map(t => ({
      positionId, accountId,
      strategyName: detectStrategy(edited),
      instrument:      String(t.instrument).toUpperCase(),
      expiry:          t.expiry,
      strike:          parseFloat(t.strike),
      optionType:      t.optionType,
      transactionType: t.transactionType,
      quantity:        parseInt(t.lots),
      lotSize:         parseInt(t.lotSize) || getLotSize(t.instrument),
      premium:         parseFloat(t.avgPrice),
      exitPremium:     t.status === 'CLOSED' ? parseFloat(t.exitPremium || 0) || undefined : undefined,
      date:            tradeDate,
      exitDate:        t.status === 'CLOSED' ? (t.exitDate || tradeDate) : undefined,
      status:          t.status || 'OPEN',
      source:          'screenshot',
    })));
    setStatus('done');
    setTimeout(() => navigate('/positions'), 1200);
  };

  return (
    <div style={{ maxWidth: 800 }}>
      <div className="page-header">
        <div className="page-title">Screenshot Import</div>
        <div className="page-subtitle">Upload your broker screenshot — AI reads it automatically</div>
      </div>

      {hasGemini ? (
        <div className="alert alert-success" style={{ marginBottom: 20 }}>
          ✓ Gemini API key set — using AI extraction (most accurate, free)
        </div>
      ) : (
        <div className="alert alert-info" style={{ marginBottom: 20 }}>
          Using local OCR. For better accuracy, add your free Gemini key in{' '}
          <strong>Settings → Screenshot Import</strong>.{' '}
          Get it free at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>aistudio.google.com</a> (no card needed).
        </div>
      )}

      {/* Top fields */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Trade Date</label>
            <input className="form-input" type="date" value={tradeDate} onChange={e => setTradeDate(e.target.value)} />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Account</label>
            <select className="form-select" value={accountId} onChange={e => setAccountId(e.target.value)}>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Upload */}
      <div
        onDrop={e => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); }}
        onDragOver={e => e.preventDefault()}
        onClick={() => !image && fileRef.current?.click()}
        style={{
          border: `2px dashed ${image ? 'var(--accent)' : 'var(--border-hover)'}`,
          borderRadius: 12, marginBottom: 20,
          padding: image ? 0 : '48px 20px',
          textAlign: 'center', cursor: image ? 'default' : 'pointer',
          background: image ? 'transparent' : 'var(--bg-card)',
          overflow: 'hidden',
        }}
      >
        {!image ? (
          <>
            <div style={{ fontSize: 36, marginBottom: 12, opacity: 0.4 }}>📷</div>
            <div style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 6 }}>Click or drag your broker screenshot here</div>
            <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>Angel One, Kotak Neo, or any broker</div>
          </>
        ) : (
          <div style={{ position: 'relative' }}>
            <img src={image.url} alt="screenshot" style={{ maxWidth: '100%', maxHeight: 380, objectFit: 'contain', display: 'block' }} />
            <button onClick={e => { e.stopPropagation(); setImage(null); setStatus('idle'); setEdited([]); }}
              style={{ position: 'absolute', top: 10, right: 10, background: 'rgba(0,0,0,0.7)', border: 'none', color: '#fff', borderRadius: '50%', width: 28, height: 28, cursor: 'pointer', fontSize: 16 }}>×</button>
          </div>
        )}
        <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => handleFile(e.target.files[0])} />
      </div>

      {/* Progress */}
      {status === 'loading' && method === 'ocr' && (
        <div className="card" style={{ marginBottom: 20, textAlign: 'center' }}>
          <div style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 12 }}>Reading image with OCR...</div>
          <div style={{ background: 'var(--bg-primary)', borderRadius: 6, height: 8, overflow: 'hidden' }}>
            <div style={{ height: '100%', background: 'var(--accent)', width: `${progress}%`, transition: 'width 0.3s', borderRadius: 6 }} />
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 8 }}>{progress}%</div>
        </div>
      )}
      {status === 'loading' && method === 'gemini' && (
        <div className="alert alert-info" style={{ marginBottom: 20 }}>✨ Gemini is reading your screenshot...</div>
      )}
      {status === 'done' && <div className="alert alert-success" style={{ marginBottom: 16 }}>✓ Imported! Redirecting...</div>}

      {/* Error */}
      {status === 'error' && (
        <div style={{ marginBottom: 16 }}>
          <div className="alert alert-error" style={{ marginBottom: 10 }}>{errorMsg}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {hasGemini && method === 'ocr' && (
              <button className="btn btn-outline btn-sm" onClick={() => extract('gemini')}>Try with Gemini instead</button>
            )}
            {method === 'gemini' && (
              <button className="btn btn-outline btn-sm" onClick={() => extract('ocr')}>Try with local OCR instead</button>
            )}
          </div>
          {rawText && (
            <div style={{ marginTop: 10 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowRaw(p => !p)}>
                {showRaw ? '▲ Hide' : '▼ Show'} raw OCR text
              </button>
              {showRaw && (
                <div style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 8, padding: 14, marginTop: 10, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'pre-wrap', maxHeight: 200, overflowY: 'auto' }}>
                  {rawText}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Extract buttons */}
      {image && !['done','loading'].includes(status) && (
        <div style={{ marginBottom: 20 }}>
          {hasGemini ? (
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button className="btn btn-primary" style={{ padding: '12px 28px', fontSize: 15 }} onClick={() => extract('gemini')}>
                ✨ Extract with Gemini AI
              </button>
              <button className="btn btn-outline" onClick={() => extract('ocr')}>
                Use local OCR instead
              </button>
            </div>
          ) : (
            <div style={{ textAlign: 'center' }}>
              <button className="btn btn-primary" style={{ padding: '12px 36px', fontSize: 15 }} onClick={() => extract('ocr')}>
                🔍 Extract Trades
              </button>
              <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 8 }}>
                Add Gemini key in Settings for better accuracy
              </div>
            </div>
          )}
        </div>
      )}

      {/* Preview table */}
      {status === 'preview' && edited.length > 0 && (
        <div>
          <div className="section-header">
            <div className="section-title">
              Extracted — Review & Edit
              <span style={{ marginLeft: 8, fontSize: 11, color: method === 'gemini' ? 'var(--profit)' : 'var(--accent)', background: 'var(--bg-card2)', padding: '2px 8px', borderRadius: 4 }}>
                via {method === 'gemini' ? '✨ Gemini' : 'OCR'}
              </span>
            </div>
            {rawText && (
              <button className="btn btn-ghost btn-sm" onClick={() => setShowRaw(p => !p)}>{showRaw ? 'Hide' : 'Show'} raw text</button>
            )}
          </div>

          {showRaw && rawText && (
            <div style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 8, padding: 14, marginBottom: 16, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'pre-wrap', maxHeight: 140, overflowY: 'auto' }}>
              {rawText}
            </div>
          )}

          <div className="alert alert-info" style={{ marginBottom: 16 }}>
            Check the values — edit anything wrong before importing.
          </div>

          {edited.map(t => (
            <div key={t.id} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: 14, marginBottom: 10 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 10 }}>
                {[
                  { label: 'Instrument', key: 'instrument', type: 'text' },
                  { label: 'Expiry',     key: 'expiry',     type: 'date' },
                  { label: 'Strike',     key: 'strike',     type: 'number' },
                  { label: 'Option',     key: 'optionType', type: 'select', opts: ['CE','PE'] },
                  { label: 'Buy/Sell',   key: 'transactionType', type: 'select', opts: ['BUY','SELL'] },
                  { label: 'Lots',       key: 'lots',       type: 'number' },
                  { label: 'Avg Price ₹',key: 'avgPrice',   type: 'number' },
                  { label: 'Lot Size',   key: 'lotSize',    type: 'number' },
                ].map(f => (
                  <div key={f.key} className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">{f.label}</label>
                    {f.type === 'select' ? (
                      <select className="form-select" value={t[f.key]||''} onChange={e => updateRow(t.id, f.key, e.target.value)}>
                        {f.opts.map(o => <option key={o}>{o}</option>)}
                      </select>
                    ) : (
                      <input className="form-input" type={f.type} value={t[f.key]||''} onChange={e => updateRow(t.id, f.key, e.target.value)} />
                    )}
                  </div>
                ))}
              </div>
              <div style={{ display:'flex', justifyContent:'space-between', marginTop:10 }}>
                <span style={{ fontSize:12, color:'var(--text-muted)' }}>
                  {(t.lots||0)*(t.lotSize||getLotSize(t.instrument))} shares ·{' '}
                  {t.transactionType==='SELL'?'+':'-'}₹{Math.round((t.lots||0)*(t.lotSize||getLotSize(t.instrument))*(t.avgPrice||0)).toLocaleString('en-IN')}
                  {t.status === 'CLOSED' && t.exitPremium > 0 &&
                    <span style={{ marginLeft:8, opacity:0.7 }}>· exit ₹{t.exitPremium}</span>
                  }
                  {t.status === 'CLOSED' &&
                    <span style={{ marginLeft:6, background:'var(--bg-card2)', padding:'1px 6px', borderRadius:3 }}>CLOSED</span>
                  }
                </span>
                <button style={{ background:'none',border:'none',color:'var(--loss)',cursor:'pointer',fontSize:13 }} onClick={() => removeRow(t.id)}>Remove</button>
              </div>
            </div>
          ))}

          {(() => {
            const net = edited.reduce((s,t) => s+(t.transactionType==='SELL'?1:-1)*(t.lots||0)*(t.lotSize||getLotSize(t.instrument))*(t.avgPrice||0), 0);
            return (
              <div style={{ background:'var(--bg-card2)',border:'1px solid var(--border)',borderRadius:8,padding:'12px 16px',marginBottom:20,display:'flex',justifyContent:'space-between' }}>
                <span style={{ color:'var(--text-muted)',fontSize:13 }}>Net premium collected</span>
                <span style={{ fontFamily:"'JetBrains Mono',monospace",fontSize:16,fontWeight:600,color:net>=0?'var(--profit)':'var(--loss)' }}>
                  {net>=0?'+':''}₹{Math.round(net).toLocaleString('en-IN')}
                </span>
              </div>
            );
          })()}

          <div style={{ display:'flex', gap:12 }}>
            <button className="btn btn-outline" onClick={() => { setStatus('idle'); setEdited([]); }}>← Re-extract</button>
            <button className="btn btn-primary" style={{ flex:1 }} onClick={confirmImport}>
              ✓ Import {edited.length} Leg{edited.length>1?'s':''} as One Position
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
