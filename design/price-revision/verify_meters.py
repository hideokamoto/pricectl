"""Check every way to find a billing meter for a known event name (test mode).

Usage: python3 verify_meters.py KEY_FILE
Every object created is deactivated, archived or deleted at the end.
"""
import base64, json, sys, time, urllib.parse, urllib.request, urllib.error

KEY = open(sys.argv[1]).read().strip()
VERSION = '2026-09-30.endive'
RUN = f'mtr{int(time.time())}'
created = {'meters': [], 'prices': [], 'products': [], 'customers': []}


def call(method, path, params=None):
    data = urllib.parse.urlencode(params or {}, doseq=True).encode() if method in ('POST', 'DELETE') else None
    url = 'https://api.stripe.com/v1/' + path
    if method == 'GET' and params:
        url += '?' + urllib.parse.urlencode(params, doseq=True)
    req = urllib.request.Request(url, data=data if method == 'POST' else None, method=method)
    req.add_header('Authorization', 'Basic ' + base64.b64encode(f'{KEY}:'.encode()).decode())
    req.add_header('Stripe-Version', VERSION)
    return send(req)


def call_v2(method, path, body=None, query=None):
    url = 'https://api.stripe.com/v2/' + path
    if query:
        url += '?' + urllib.parse.urlencode(query, doseq=True)
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header('Authorization', 'Bearer ' + KEY)
    req.add_header('Stripe-Version', VERSION)
    if data is not None:
        req.add_header('Content-Type', 'application/json')
    return send(req)


def send(req):
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw)
        except ValueError:
            return e.code, {'error': {'code': None, 'message': raw[:200].decode(errors='replace')}}


def report(case, s, b, fields=()):
    if 200 <= s < 300:
        print(f'  [{case}] HTTP {s} OK', {k: b.get(k) for k in fields} if fields else '')
    else:
        e = b.get('error', {})
        print(f'  [{case}] HTTP {s} ERROR {e.get("type")}/{e.get("code")}: {e.get("message")}')


def meter(event_name, **extra):
    params = {'display_name': f'{RUN} {event_name}', 'event_name': event_name,
              'default_aggregation[formula]': 'sum'}
    params.update(extra)
    s, b = call('POST', 'billing/meters', params)
    if s == 200:
        created['meters'].append(b['id'])
    return s, b


EV_A = f'{RUN}_api_calls'
print('run tag', RUN)

print('M1 choose the meter id at creation')
s, b = meter(f'{RUN}_m1', id=f'{RUN}_Stack_ApiCalls'); report('create with id', s, b, ['id'])
s, b = meter(f'{RUN}_m1b', id=f'mtr_{RUN}'); report('create with id prefixed mtr_', s, b, ['id'])

print('M2 search endpoints for meters')
s, b = call('GET', 'billing/meters/search', {'query': f"event_name:'{EV_A}'"}); report('GET /v1/billing/meters/search', s, b)
s, b = call('GET', 'billing/meters', {'query': f"event_name:'{EV_A}'"}); report('GET /v1/billing/meters?query=', s, b)

print('setup: meter A for', EV_A)
s, ma = meter(EV_A); report('create meter A', s, ma, ['id', 'event_name', 'status'])
MA = ma['id']
s, b = meter(EV_A); report('create a second active meter with the same event name', s, b)

print('M9 retrieve by event name in the id slot')
s, b = call('GET', f'billing/meters/{EV_A}'); report('GET /v1/billing/meters/<event_name>', s, b, ['id'])

print('M3 v2 meter endpoints')
s, b = call_v2('GET', 'billing/meters'); report('GET /v2/billing/meters', s, b)
s, b = call_v2('GET', 'billing/meters', query={'event_name': EV_A}); report('GET /v2/billing/meters?event_name=', s, b)
s, b = call_v2('GET', f'billing/meters/{MA}'); report('GET /v2/billing/meters/{id}', s, b)
s, b = call_v2('POST', 'billing/meters', {'display_name': 'x', 'event_name': f'{RUN}_v2', 'metadata': {'k': 'v'}})
report('POST /v2/billing/meters with metadata', s, b)

print('M4 metadata on meters (v1)')
s, b = meter(f'{RUN}_md', **{'metadata[pricectl_key]': 'Stack/ApiCalls'}); report('create with metadata', s, b, ['id', 'metadata'])
s, b = call('POST', f'billing/meters/{MA}', {'metadata[pricectl_key]': 'Stack/ApiCalls'}); report('update with metadata', s, b, ['metadata'])
s, b = call('GET', f'billing/meters/{MA}'); report('retrieve A', s, b, ['metadata'])
print('     fields on meter object:', sorted(b.keys()) if s == 200 else None)

print('M8 expand on meter')
s, b = call('GET', f'billing/meters/{MA}', {'expand[]': 'prices'}); report('retrieve A expand[]=prices', s, b)

print('M5 find the meter through a price')
s, p = call('POST', 'products', {'name': f'{RUN} product'}); report('create product', s, p, ['id'])
if s == 200: created['products'].append(p['id'])
LK = f'{RUN}.Stack.ApiCalls'
def mprice(meter_id, key=None, **extra):
    params = {'product': p['id'], 'currency': 'usd', 'unit_amount': 1,
              'recurring[interval]': 'month', 'recurring[usage_type]': 'metered',
              'recurring[meter]': meter_id}
    if key: params['lookup_key'] = key
    params.update(extra)
    s, b = call('POST', 'prices', params)
    if s == 200: created['prices'].append(b['id'])
    return s, b
s, pr = mprice(MA, LK); report('create metered price on A with lookup_key', s, pr, ['id', 'lookup_key'])
print('     recurring:', pr.get('recurring'))
s, b = call('GET', 'prices', {'lookup_keys[]': LK}); report('list prices by lookup_key', s, b)
d = b.get('data', [])
print('     n =', len(d), 'recurring.meter == A:', [x['recurring'].get('meter') == MA for x in d])
s, b = call('GET', 'prices', {'lookup_keys[]': LK, 'expand[]': 'data.recurring.meter'}); report('list by lookup_key expand data.recurring.meter', s, b)
if s == 200: print('     recurring.meter type:', type(b['data'][0]['recurring'].get('meter')).__name__)
s, b = call('GET', 'prices', {'recurring[meter]': MA}); report('list prices recurring[meter]=A', s, b)
print('     ids:', [x['id'] == pr.get('id') for x in b.get('data', [])])
s, b = call('GET', 'prices/search', {'query': f"recurring.meter:'{MA}'"}); report('price search recurring.meter', s, b)

print('M6 meter events')
s, c = call('POST', 'customers', {'name': f'{RUN} cust'}); report('create customer', s, c, ['id'])
if s == 200: created['customers'].append(c['id'])
cid = c.get('id', 'cus_missing')
s, b = call('POST', 'billing/meter_events', {'event_name': EV_A, 'payload[value]': '1', 'payload[stripe_customer_id]': cid, 'identifier': f'{RUN}_e1'})
report('v1 meter event to A', s, b); print('     response keys:', sorted(b.keys()) if s == 200 else None)
s, b = call('POST', 'billing/meter_events', {'event_name': f'{RUN}_nomtr', 'payload[value]': '1', 'payload[stripe_customer_id]': cid})
report('v1 meter event to unknown event name', s, b)
s, b = call_v2('POST', 'billing/meter_events', {'event_name': EV_A, 'payload': {'value': '1', 'stripe_customer_id': cid}, 'identifier': f'{RUN}_e2'})
report('v2 meter event to A', s, b); print('     response:', b if s == 200 else None)
s, b = call_v2('POST', 'billing/meter_events', {'event_name': f'{RUN}_nomtr', 'payload': {'value': '1', 'stripe_customer_id': cid}})
report('v2 meter event to unknown event name', s, b)
s, b = call_v2('POST', 'billing/meter_event_session'); report('v2 meter_event_session', s, b, ['object', 'expires_at'])

print('M7 status=active listing')
s, b = call('GET', 'billing/meters', {'status': 'active', 'limit': 100}); report('list status=active limit=100', s, b)
active, page, pages = [], b, 1
while s == 200:
    active += page['data']
    if not page.get('has_more'): break
    s, page = call('GET', 'billing/meters', {'status': 'active', 'limit': 100, 'starting_after': page['data'][-1]['id']}); pages += 1
print(f'     pages={pages} active meters={len(active)} all status active={all(m["status"] == "active" for m in active)}')
print('     event names unique among active:', len({m['event_name'] for m in active}) == len(active))
print('     A found:', any(m['id'] == MA for m in active))
s, b = call('GET', 'billing/meters', {'status': 'active', 'limit': 101}); report('list limit=101', s, b)
if s == 200: print('     returned', len(b['data']))
s, p1 = call('GET', 'billing/meters', {'status': 'inactive', 'limit': 1}); report('list status=inactive limit=1', s, p1, ['has_more'])
if s == 200 and p1['data']:
    s, p2 = call('GET', 'billing/meters', {'status': 'inactive', 'limit': 1, 'starting_after': p1['data'][0]['id']})
    report('list status=inactive limit=1 starting_after', s, p2, ['has_more'])
    if s == 200: print('     next page differs:', [m['id'] != p1['data'][0]['id'] for m in p2['data']], 'statuses:', [m['status'] for m in p2['data']])

print('M5b deactivate A; what happens to its price')
s, b = call('POST', f'billing/meters/{MA}/deactivate'); report('deactivate A', s, b, ['status'])
s, b = call('GET', f'prices/{pr.get("id")}'); report('retrieve price after A deactivated', s, b, ['active', 'lookup_key'])
print('     recurring.meter == A:', b.get('recurring', {}).get('meter') == MA)
s, b = call('GET', 'prices', {'lookup_keys[]': LK}); report('list by lookup_key after A deactivated', s, b)
print('     n =', len(b.get('data', [])))
s, b = mprice(MA); report('create a new price on deactivated A', s, b, ['id'])
s, b = call('POST', 'billing/meter_events', {'event_name': EV_A, 'payload[value]': '1', 'payload[stripe_customer_id]': cid})
report('v1 meter event while no active meter', s, b)
s, b = call('GET', 'billing/meters', {'status': 'inactive', 'limit': 100}); report('list status=inactive', s, b)
print('     A in first inactive page:', any(m['id'] == MA for m in b.get('data', [])))
s, b = call('GET', 'billing/meters', {'status': 'active', 'limit': 100})
print('     A in active list after deactivate:', any(m['id'] == MA for m in b.get('data', [])))

print('M5c new meter B with the same event name')
s, mb = meter(EV_A); report('create B with event name of deactivated A', s, mb, ['id', 'status'])
s, b = call('GET', 'prices', {'lookup_keys[]': LK})
print('     price by lookup_key still points to A (not B):', [x['recurring'].get('meter') == MA for x in b.get('data', [])])
s, b = call('POST', f'billing/meters/{MA}/reactivate'); report('reactivate A while B is active', s, b, ['status'])

print('M8b account events')
s, b = call('GET', 'events', {'type': 'billing.meter.created', 'limit': 5}); report('GET /v1/events type=billing.meter.created', s, b)
if s == 200: print('     first event object event_name:', [e['data']['object'].get('event_name') for e in b['data'][:3]])

for x in created['prices']:
    call('POST', f'prices/{x}', {'active': 'false'})
for x in created['products']:
    call('POST', f'products/{x}', {'active': 'false'})
for x in created['meters']:
    call('POST', f'billing/meters/{x}/deactivate')
for x in created['customers']:
    call('DELETE', f'customers/{x}')
left = [x for x in created['meters'] if call('GET', f'billing/meters/{x}')[1].get('status') != 'inactive']
print('cleaned up', {k: len(v) for k, v in created.items()}, 'meters still active:', left)
