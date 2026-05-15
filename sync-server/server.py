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
def parse_symbol(symbol: str):
    # Format 1: INSTRUMENT + DDMMMYY + STRIKE + CE/PE
    m = re.match(r'^([A-Z&]+)(\d{2}[A-Z]{3}\d{2})(\d+)(CE|PE)$', symbol)
    if m:
        inst, exp_str, strike, opt = m.groups()
        try:
            expiry = datetime.strptime(exp_str, '%d%b%y').strftime('%Y-%m-%d')
        except ValueError:
            expiry = None
        return {'instrument': inst, 'expiry': expiry, 'strike': int(strike), 'optionType': opt}

    # Format 2: INSTRUMENT + DDMMYY + STRIKE + CE/PE (weekly)
    m = re.match(r'^([A-Z&]+)(\d{2}\d{2}\d{2})(\d+)(CE|PE)$', symbol)
    if m:
        inst, exp_str, strike, opt = m.groups()
        try:
            expiry = datetime.strptime(exp_str, '%d%m%y').strftime('%Y-%m-%d')
        except ValueError:
            expiry = None
        return {'instrument': inst, 'expiry': expiry, 'strike': int(strike), 'optionType': opt}

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
# KOTAK NEO API
# ═══════════════════════════════════════════════════════════════════════════════

KOTAK_BASE = 'https://gw-napi.kotaksecurities.com'

def kotak_request_otp(consumer_key, consumer_secret, mobile, password):
    """Step 1: Request OTP from Kotak."""
    import base64
    token = base64.b64encode(f'{consumer_key}:{consumer_secret}'.encode()).decode()
    r = requests.post(
        f'{KOTAK_BASE}/login/1.0/login/v2/validate',
        json={'mobileNumber': mobile, 'password': password},
        headers={'Authorization': f'Basic {token}', 'Content-Type': 'application/json'},
        timeout=10
    )
    data = r.json()
    if data.get('error_code') == '00000':
        return True, data.get('sid', '')
    raise Exception(data.get('description', 'Kotak OTP request failed'))

def kotak_validate_otp(consumer_key, consumer_secret, mobile, otp, sid):
    """Step 2: Validate OTP and get token."""
    import base64
    token = base64.b64encode(f'{consumer_key}:{consumer_secret}'.encode()).decode()
    r = requests.post(
        f'{KOTAK_BASE}/login/1.0/login/v2/token',
        json={'mobileNumber': mobile, 'otp': otp, 'sid': sid},
        headers={'Authorization': f'Basic {token}', 'Content-Type': 'application/json'},
        timeout=10
    )
    data = r.json()
    if data.get('error_code') == '00000':
        return data['data'].get('token', ''), data['data'].get('sid', '')
    raise Exception(data.get('description', 'Kotak OTP validation failed'))

def kotak_tradebook(token, sid, consumer_key, consumer_secret):
    import base64
    cred = base64.b64encode(f'{consumer_key}:{consumer_secret}'.encode()).decode()
    r = requests.get(
        f'{KOTAK_BASE}/Orders/2.0/quick/orders/trade/history/v2',
        headers={
            'Authorization': f'Bearer {token}',
            'Sid': sid,
            'Auth': token,
            'neo-fin-key': 'neotradeapi',
        },
        timeout=10
    )
    return r.json().get('data', [])

def kotak_positions(token, sid):
    r = requests.get(
        f'{KOTAK_BASE}/Orders/2.0/quick/user/positions/v2',
        headers={
            'Authorization': f'Bearer {token}',
            'Sid': sid,
            'neo-fin-key': 'neotradeapi',
        },
        timeout=10
    )
    return r.json().get('data', [])

def map_kotak_trade(t, account_id):
    sym = parse_symbol(t.get('trdSym', '') or t.get('sym', ''))
    if not sym:
        return None
    lot_size = get_lot_size(sym['instrument'])
    qty = int(t.get('flQty', 0))
    lots = qty // lot_size if lot_size > 0 else qty
    return {
        'id': str(uuid4()),
        'brokerTradeId': t.get('ordId', ''),
        'accountId': account_id,
        'source': 'kotak',
        'instrument': sym['instrument'],
        'expiry': sym['expiry'],
        'strike': sym['strike'],
        'optionType': sym['optionType'],
        'transactionType': 'BUY' if t.get('trnsTp', '').upper() == 'BUY' else 'SELL',
        'quantity': lots,
        'lotSize': lot_size,
        'premium': float(t.get('flPrc', 0)),
        'date': datetime.now().strftime('%Y-%m-%d'),
        'status': 'CLOSED',
        'strategyName': 'Custom',
    }


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
        trades_raw = angel_tradebook(s['apiKey'], s['jwtToken'])
        positions_raw = angel_positions(s['apiKey'], s['jwtToken'])
        account_id = s['accountId']
        trades = [t for r in trades_raw if (t := map_angel_trade(r, account_id)) is not None]
        open_pos = [t for r in positions_raw if (t := map_angel_position(r, account_id)) is not None]
        open_pos = group_open_positions(open_pos)
        all_trades = trades + open_pos
        return jsonify({'success': True, 'count': len(all_trades), 'trades': all_trades})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/connect/kotak', methods=['POST'])
def connect_kotak():
    data = request.json
    required = ['consumerKey', 'consumerSecret', 'mobile', 'password']
    missing = [k for k in required if not data.get(k)]
    if missing:
        return jsonify({'success': False, 'error': f'Missing: {", ".join(missing)}'}), 400
    try:
        if data.get('otp'):
            # Step 2: validate OTP
            sid = sessions.get('kotak_sid', '')
            token, new_sid = kotak_validate_otp(
                data['consumerKey'], data['consumerSecret'],
                data['mobile'], data['otp'], sid
            )
            sessions['kotak'] = {
                'token': token,
                'sid': new_sid,
                'consumerKey': data['consumerKey'],
                'consumerSecret': data['consumerSecret'],
                'accountId': data.get('accountId', 'kotak_default'),
            }
            return jsonify({'success': True, 'message': 'Connected to Kotak Neo'})
        else:
            # Step 1: request OTP
            ok, sid = kotak_request_otp(
                data['consumerKey'], data['consumerSecret'],
                data['mobile'], data['password']
            )
            sessions['kotak_sid'] = sid
            return jsonify({'success': False, 'error': 'OTP sent to your mobile. Enter it and click Connect again.', 'needsOtp': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 400

@app.route('/sync/kotak', methods=['POST'])
def sync_kotak():
    s = sessions.get('kotak')
    if not s:
        return jsonify({'success': False, 'error': 'Not connected. Connect first.'}), 401
    try:
        trades_raw = kotak_tradebook(s['token'], s['sid'], s['consumerKey'], s['consumerSecret'])
        account_id = s['accountId']
        trades = [t for r in trades_raw if (t := map_kotak_trade(r, account_id)) is not None]
        return jsonify({'success': True, 'count': len(trades), 'trades': trades})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/extract-screenshot', methods=['POST'])
def extract_screenshot():
    """Use Claude API to extract trades from a broker screenshot."""
    data = request.json
    api_key = data.get('apiKey', '')
    image_data = data.get('image', '')
    image_type = data.get('imageType', 'image/jpeg')

    if not api_key:
        return jsonify({'success': False, 'error': 'Anthropic API key not set. Add it in Settings.'}), 400
    if not image_data:
        return jsonify({'success': False, 'error': 'No image provided'}), 400

    prompt = """Extract all option positions from this broker app screenshot.
Return ONLY a JSON array with no markdown, no explanation:
[
  {
    "instrument": "NIFTY",
    "expiry": "2026-05-19",
    "strike": 22850,
    "optionType": "PE",
    "transactionType": "BUY",
    "lots": 3,
    "avgPrice": 54.89,
    "lotSize": 65
  }
]
Rules:
- expiry: ISO date YYYY-MM-DD
- transactionType: BUY if buy tag or positive lots, SELL if sell tag or negative lots
- optionType: CE or PE only
- lotSize: read from "(1 Lot = X)" if visible, else 65 for NIFTY, 15 for BANKNIFTY, 25 for FINNIFTY
- avgPrice: the Avg price shown (not LTP/current price)
- Return [] if no option positions found"""

    try:
        res = requests.post(
            'https://api.anthropic.com/v1/messages',
            headers={
                'x-api-key': api_key,
                'anthropic-version': '2023-06-01',
                'content-type': 'application/json',
            },
            json={
                'model': 'claude-sonnet-4-20250514',
                'max_tokens': 1000,
                'messages': [{
                    'role': 'user',
                    'content': [
                        {'type': 'image', 'source': {'type': 'base64', 'media_type': image_type, 'data': image_data}},
                        {'type': 'text', 'text': prompt}
                    ]
                }]
            },
            timeout=30
        )
        result = res.json()
        if 'error' in result:
            return jsonify({'success': False, 'error': result['error'].get('message', 'API error')}), 400
        
        raw = result.get('content', [{}])[0].get('text', '[]')
        clean = raw.replace('```json', '').replace('```', '').strip()
        trades = json.loads(clean)
        return jsonify({'success': True, 'trades': trades})
    except json.JSONDecodeError:
        return jsonify({'success': False, 'error': 'Could not parse extracted data. Try a clearer screenshot.'}), 400
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

if __name__ == '__main__':
    print('=' * 55)
    print('  OptionsDesk Sync Server')
    print('  Running on http://localhost:5001')
    print('  Keep this window open while using the journal.')
    print('=' * 55)
    app.run(host='0.0.0.0', port=5001, debug=False)
