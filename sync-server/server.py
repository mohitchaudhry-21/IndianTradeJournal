"""
OptionsDesk Sync Server
=======================
Local bridge between Angel One SmartAPI / Kotak Neo API and the OptionsDesk journal.
Runs on port 5001. Keep this window open while using the journal.

Start: python server.py
"""

from flask import Flask, jsonify, request
from flask_cors import CORS
import requests
import re
from datetime import datetime
from uuid import uuid4
import json
import os

app = Flask(__name__)
CORS(app)

# ── Session store (in-memory, resets on restart) ─────────────────────────────
sessions = {}   # broker -> session data

# ── Lot sizes (NSE as of 2025 – update if NSE revises) ───────────────────────
LOT_SIZES = {
    'NIFTY': 25, 'BANKNIFTY': 15, 'FINNIFTY': 25,
    'MIDCPNIFTY': 75, 'SENSEX': 10, 'BANKEX': 15,
}

def get_lot_size(instrument: str) -> int:
    for k, v in LOT_SIZES.items():
        if instrument.startswith(k):
            return v
    return 1  # unknown stock options

# ── Symbol parser ─────────────────────────────────────────────────────────────
# Handles formats:  BANKNIFTY14MAY2548000CE  /  NIFTY25500CE25APR25
MONTH_MAP = {'JAN':1,'FEB':2,'MAR':3,'APR':4,'MAY':5,'JUN':6,
              'JUL':7,'AUG':8,'SEP':9,'OCT':10,'NOV':11,'DEC':12}

def parse_symbol(symbol: str):
    if not symbol:
        return None
    symbol = symbol.upper().strip()

    # Angel One Format 1: NIFTY19MAY26 → DDMMMYY
    m = re.match(r'^([A-Z&]+)(\d{2}[A-Z]{3}\d{2})(\d+)(CE|PE)$', symbol)
    if m:
        inst, exp_str, strike, opt = m.groups()
        try:
            expiry = datetime.strptime(exp_str, '%d%b%y').strftime('%Y-%m-%d')
            return {'instrument': inst, 'expiry': expiry, 'strike': int(strike), 'optionType': opt}
        except ValueError:
            pass

    # Kotak Monthly: NIFTY26MAY22850PE → YYMMMSTRIKE
    m = re.match(r'^([A-Z&]+)(\d{2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d+)(CE|PE)$', symbol)
    if m:
        inst, yr, mon, strike, opt = m.groups()
        year = 2000 + int(yr)
        month = MONTH_MAP[mon]
        # Last Thursday of month
        import calendar as cal
        last_day = cal.monthrange(year, month)[1]
        exp_day = last_day
        for d in range(last_day, 0, -1):
            if datetime(year, month, d).weekday() == 3:
                exp_day = d
                break
        expiry = f'{year}-{str(month).zfill(2)}-{str(exp_day).zfill(2)}'
        return {'instrument': inst, 'expiry': expiry, 'strike': int(strike), 'optionType': opt}

    # Kotak Weekly: NIFTY2651922850PE → YY + M(1digit) + DD + STRIKE + TYPE
    m = re.match(r'^([A-Z&]+)(\d{2})(\d{1})(\d{2})(\d+)(CE|PE)$', symbol)
    if m:
        inst, yr, mon, day, strike, opt = m.groups()
        year = 2000 + int(yr)
        month = int(mon)
        expiry = f'{year}-{str(month).zfill(2)}-{str(int(day)).zfill(2)}'
        return {'instrument': inst, 'expiry': expiry, 'strike': int(strike), 'optionType': opt}

    # Angel One Format 2: DDMMYY + STRIKE (weekly fallback)
    m = re.match(r'^([A-Z&]+)(\d{6})(\d+)(CE|PE)$', symbol)
    if m:
        inst, exp_str, strike, opt = m.groups()
        try:
            expiry = datetime.strptime(exp_str, '%d%m%y').strftime('%Y-%m-%d')
            return {'instrument': inst, 'expiry': expiry, 'strike': int(strike), 'optionType': opt}
        except ValueError:
            pass

    return None


# ═══════════════════════════════════════════════════════════════════════════════
# ANGEL ONE SmartAPI
# ═══════════════════════════════════════════════════════════════════════════════

ANGEL_BASE = 'https://apiconnect.angelone.in'

def angel_headers(api_key: str, jwt_token: str = None):
    h = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-UserType': 'USER',
        'X-SourceID': 'WEB',
        'X-ClientLocalIP': '127.0.0.1',
        'X-ClientPublicIP': '127.0.0.1',
        'X-MACAddress': '00:00:00:00:00:00',
        'X-PrivateKey': api_key,
    }
    if jwt_token:
        h['Authorization'] = f'Bearer {jwt_token}'
    return h

def angel_login(client_id, api_key, pin, totp):
    url = f'{ANGEL_BASE}/rest/auth/angelbroking/user/v1/loginByPassword'
    payload = {'clientcode': client_id, 'password': pin, 'totp': totp}
    r = requests.post(url, json=payload, headers=angel_headers(api_key), timeout=10)
    data = r.json()
    if data.get('status') and data.get('data'):
        return data['data']
    raise Exception(data.get('message', 'Angel One login failed'))

def angel_tradebook(api_key, jwt_token):
    url = f'{ANGEL_BASE}/rest/secure/angelbroking/order/v1/getTradeBook'
    r = requests.get(url, headers=angel_headers(api_key, jwt_token), timeout=10)
    data = r.json()
    if data.get('status'):
        return data.get('data') or []
    raise Exception(data.get('message', 'Failed to fetch trade book'))

def angel_positions(api_key, jwt_token):
    url = f'{ANGEL_BASE}/rest/secure/angelbroking/order/v1/getPosition'
    r = requests.get(url, headers=angel_headers(api_key, jwt_token), timeout=10)
    data = r.json()
    if data.get('status'):
        return data.get('data') or []
    raise Exception(data.get('message', 'Failed to fetch positions'))

def map_angel_trade(t, account_id):
    """Map Angel One trade book entry to OptionsDesk format."""
    sym = parse_symbol(t.get('tradingsymbol', ''))
    if not sym:
        return None  # skip non-option trades
    lot_size = get_lot_size(sym['instrument'])
    qty = int(t.get('fillsize', 0))
    lots = qty // lot_size if lot_size > 0 else qty
    trade_date = t.get('tradedate', '')
    if trade_date:
        try:
            dt = datetime.strptime(trade_date, '%d%b%Y %H:%M:%S')
            trade_date = dt.strftime('%Y-%m-%d')
        except ValueError:
            pass
    return {
        'id': str(uuid4()),
        'brokerTradeId': t.get('tradeid', ''),
        'accountId': account_id,
        'source': 'angelone',
        'instrument': sym['instrument'],
        'expiry': sym['expiry'],
        'strike': sym['strike'],
        'optionType': sym['optionType'],
        'transactionType': t.get('transactiontype', 'BUY').upper(),
        'quantity': lots,
        'lotSize': lot_size,
        'premium': float(t.get('fillprice', 0)),
        'date': trade_date,
        'status': 'CLOSED',
        'strategyName': 'Custom',
    }

def first_nonzero(d, *keys):
    """Return first non-zero float found among the given keys."""
    for k in keys:
        try:
            v = float(d.get(k, 0) or 0)
            if v != 0:
                return v
        except (ValueError, TypeError):
            pass
    return 0.0

def map_angel_position(p, account_id):
    """Map Angel One open position to OptionsDesk format."""
    sym = parse_symbol(p.get('tradingsymbol', ''))
    if not sym:
        return None
    # Prefer lotsize from API response; fall back to lookup table
    api_lotsize = int(p.get('lotsize', 0) or 0)
    lot_size = api_lotsize if api_lotsize > 0 else get_lot_size(sym['instrument'])
    net_qty = int(p.get('netqty', 0) or 0)
    if net_qty == 0:
        return None
    lots = abs(net_qty) // lot_size if lot_size > 0 else abs(net_qty)
    if lots == 0:
        lots = abs(net_qty)
    tx_type = 'SELL' if net_qty < 0 else 'BUY'
    # Angel One field names vary — try all known price fields
    premium = first_nonzero(p,
        'netprice', 'averageprice', 'buyavgprice', 'sellavgprice', 'ltp', 'close'
    )
    return {
        'id': str(uuid4()),
        'brokerTradeId': p.get('symboltoken', ''),
        'accountId': account_id,
        'source': 'angelone',
        'instrument': sym['instrument'],
        'expiry': sym['expiry'],
        'strike': sym['strike'],
        'optionType': sym['optionType'],
        'transactionType': tx_type,
        'quantity': lots,
        'lotSize': lot_size,
        'premium': premium,
        'date': datetime.now().strftime('%Y-%m-%d'),
        'status': 'OPEN',
        'strategyName': 'Custom',
    }


# ═══════════════════════════════════════════════════════════════════════════════
# KOTAK NEO API v2 (uses official neo-api-client SDK)
# ═══════════════════════════════════════════════════════════════════════════════

try:
    from neo_api_client import NeoAPI as KotakNeoAPI
    NEO_SDK_AVAILABLE = True
except ImportError:
    NEO_SDK_AVAILABLE = False

# Store kotak client object globally (one instance)
kotak_client_obj = None

def map_kotak_position(p, account_id):
    """Map Kotak Neo position to OptionsDesk format."""
    try:
        symbol = p.get('trdSym', '') or p.get('sym', '') or ''
        parsed = parse_symbol(symbol)
        if not parsed:
            return None
        lot_size = get_lot_size(parsed['instrument'])
        qty = int(p.get('flBuyQty', 0) or 0) - int(p.get('flSellQty', 0) or 0)
        if qty == 0:
            qty = int(p.get('netQty', 0) or 0)
        if qty == 0:
            return None
        lots = abs(qty) // lot_size if lot_size > 0 else abs(qty)
        tx_type = 'SELL' if qty < 0 else 'BUY'
        avg_sell = float(p.get('avgSellPrc', 0) or 0)
        avg_buy  = float(p.get('avgBuyPrc',  0) or 0)
        price = avg_sell if qty < 0 else (avg_buy if qty > 0 else float(p.get('ltp', 0) or 0))
        if price == 0:
            price = float(p.get('ltp', 0) or 0)
        return {
            'id': str(uuid4()),
            'brokerTradeId': p.get('tok', ''),
            'accountId': account_id,
            'source': 'kotak',
            'instrument': parsed['instrument'],
            'expiry': parsed['expiry'],
            'strike': parsed['strike'],
            'optionType': parsed['optionType'],
            'transactionType': tx_type,
            'quantity': lots,
            'lotSize': lot_size,
            'premium': price,
            'date': datetime.now().strftime('%Y-%m-%d'),
            'status': 'OPEN',
            'strategyName': 'Custom',
        }
    except Exception:
        return None

# ═══════════════════════════════════════════════════════════════════════════════
# API ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════════

@app.route('/health')
def health():
    return jsonify({'status': 'ok', 'server': 'OptionsDesk Sync', 'version': '1.0'})

@app.route('/connect/angelone', methods=['POST'])
def connect_angelone():
    data = request.json
    required = ['clientId', 'apiKey', 'pin', 'totpSecret']
    missing = [k for k in required if not data.get(k)]
    if missing:
        return jsonify({'success': False, 'error': f'Missing: {", ".join(missing)}'}), 400
    try:
        # Generate TOTP
        import pyotp
        totp = pyotp.TOTP(data['totpSecret']).now()
        session = angel_login(data['clientId'], data['apiKey'], data['pin'], totp)
        sessions['angelone'] = {
            'jwtToken': session['jwtToken'],
            'apiKey': data['apiKey'],
            'clientId': data['clientId'],
            'accountId': data.get('accountId', 'angelone_default'),
        }
        return jsonify({'success': True, 'message': f'Connected as {data["clientId"]}'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 400

def detect_strategy(legs):
    sells = [l for l in legs if l['transactionType'] == 'SELL']
    buys  = [l for l in legs if l['transactionType'] == 'BUY']
    ce_s = [l for l in sells if l['optionType'] == 'CE']
    pe_s = [l for l in sells if l['optionType'] == 'PE']
    ce_b = [l for l in buys  if l['optionType'] == 'CE']
    pe_b = [l for l in buys  if l['optionType'] == 'PE']
    if len(legs) == 1: return 'Single Leg'
    if ce_s and pe_s and not buys:
        return 'Straddle' if ce_s[0]['strike'] == pe_s[0]['strike'] else 'Strangle'
    if pe_s and pe_b and not ce_s and not ce_b: return 'Bull Put Spread'
    if ce_s and ce_b and not pe_s and not pe_b: return 'Bear Call Spread'
    if ce_s and pe_s and ce_b and pe_b: return 'Iron Condor'
    if ce_s and pe_s and (ce_b or pe_b): return 'Strangle'
    return 'Custom'

def group_open_positions(positions):
    groups = {}
    for p in positions:
        key = f"{p['instrument']}_{p['expiry']}"
        if key not in groups:
            groups[key] = str(uuid4())
        p['positionId'] = groups[key]
    by_pid = {}
    for p in positions:
        by_pid.setdefault(p['positionId'], []).append(p)
    for pid, legs in by_pid.items():
        name = detect_strategy(legs)
        for leg in legs:
            leg['strategyName'] = name
    return positions

@app.route('/sync/angelone', methods=['POST'])
def sync_angelone():
    s = sessions.get('angelone')
    if not s:
        return jsonify({'success': False, 'error': 'Not connected. Connect first.'}), 401
    try:
        positions_raw = angel_positions(s['apiKey'], s['jwtToken'])
        account_id = s['accountId']

        # Only use positions API (gives aggregated net positions, not raw order executions)
        # Tradebook gives individual legs which creates duplicate/split entries
        all_pos = [t for r in positions_raw if (t := map_angel_position(r, account_id)) is not None]
        all_pos = group_open_positions(all_pos)
        return jsonify({'success': True, 'count': len(all_pos), 'trades': all_pos})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/connect/kotak', methods=['POST'])
def connect_kotak():
    global kotak_client_obj
    if not NEO_SDK_AVAILABLE:
        return jsonify({'success': False, 'error': 'Run: pip install neo-api-client, then restart server'}), 400

    data = request.json
    access_token = data.get('consumerKey', '')
    mobile       = data.get('mobile', '')
    ucc          = data.get('ucc', '')
    mpin         = data.get('password', '')
    totp_code    = data.get('totp', '')

    missing = [k for k, v in {'Access Token': access_token, 'Mobile': mobile, 'UCC': ucc, 'MPIN': mpin, 'TOTP': totp_code}.items() if not v]
    if missing:
        return jsonify({'success': False, 'error': f'Missing: {", ".join(missing)}'}), 400

    # Ensure mobile has country code
    if not mobile.startswith('+'):
        mobile = '+91' + mobile.lstrip('0')

    try:
        client = KotakNeoAPI(consumer_key=access_token, environment='prod')

        # Step 1: TOTP login
        try:
            login_resp = client.totp_login(mobile_number=mobile, ucc=ucc, totp=totp_code)
        except Exception as e:
            return jsonify({'success': False, 'error': f'Login failed: {str(e)}. Check Access Token and UCC.'}), 400

        if login_resp and isinstance(login_resp, dict) and login_resp.get('error'):
            return jsonify({'success': False, 'error': login_resp.get('message', str(login_resp))}), 400

        # Step 2: MPIN validate
        try:
            val_resp = client.totp_validate(mpin=mpin)
        except Exception as e:
            return jsonify({'success': False, 'error': f'MPIN validation failed: {str(e)}'}), 400

        if val_resp and isinstance(val_resp, dict) and val_resp.get('error'):
            return jsonify({'success': False, 'error': val_resp.get('message', str(val_resp))}), 400

        kotak_client_obj = client
        sessions['kotak'] = {'accountId': data.get('accountId', 'kotak_default')}
        return jsonify({'success': True, 'message': f'Connected to Kotak Neo ({ucc})'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 400

@app.route('/sync/kotak', methods=['POST'])
def sync_kotak():
    global kotak_client_obj
    if not kotak_client_obj or 'kotak' not in sessions:
        return jsonify({'success': False, 'error': 'Not connected. Connect first.'}), 401
    try:
        account_id = sessions['kotak']['accountId']
        pos_resp = kotak_client_obj.positions()

        # Handle various response formats from Kotak SDK
        if isinstance(pos_resp, list):
            positions = pos_resp
        elif isinstance(pos_resp, dict):
            positions = (pos_resp.get('data') or pos_resp.get('Data') or
                        pos_resp.get('positions') or [])
            if isinstance(positions, dict):
                positions = positions.get('positions', [])
        else:
            positions = []

        # Filter out zero-quantity positions
        active = [p for p in positions if p.get('netQty') and p['netQty'] not in ('0', 0, '')]

        trades = [t for p in active if (t := map_kotak_position(p, account_id)) is not None]
        trades = group_open_positions(trades)
        return jsonify({'success': True, 'count': len(trades), 'trades': trades,
                       'debug_raw_count': len(positions), 'debug_active': len(active)})
    except Exception as e:
        import traceback
        return jsonify({'success': False, 'error': str(e), 'trace': traceback.format_exc()[:500]}), 500

if __name__ == '__main__':
    print('=' * 55)
    print('  OptionsDesk Sync Server')
    print('  Running on http://localhost:5001')
    print('  Keep this window open while using the journal.')
    print('=' * 55)
    app.run(host='0.0.0.0', port=5001, debug=False)
