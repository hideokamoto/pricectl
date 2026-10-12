"""Check the Stripe keys the key-based lookup relies on (test mode).

Usage: python3 verify_keys.py KEY_FILE
Every object created is archived, deactivated or deleted at the end.
"""
import base64, json, sys, time, urllib.parse, urllib.request, urllib.error

KEY = open(sys.argv[1]).read().strip()
VERSION = '2026-09-30.endive'
RUN = f'pcv{int(time.time())}'
created = {'products': [], 'prices': [], 'features': []}


def call(method, path, params=None):
    data = urllib.parse.urlencode(params or {}, doseq=True).encode() if method in ('POST', 'DELETE') else None
    url = 'https://api.stripe.com/v1/' + path
    if method == 'GET' and params:
        url += '?' + urllib.parse.urlencode(params, doseq=True)
    req = urllib.request.Request(url, data=data if method == 'POST' else None, method=method)
    req.add_header('Authorization', 'Basic ' + base64.b64encode(f'{KEY}:'.encode()).decode())
    req.add_header('Stripe-Version', VERSION)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def report(case, s, b, fields=()):
    if s == 200:
        print(f'  [{case}] HTTP 200 OK', {k: b.get(k) for k in fields} if fields else '')
    else:
        e = b.get('error', {})
        print(f'  [{case}] HTTP {s} ERROR {e.get("code")}: {e.get("message")}')


def product(pid, name='p'):
    s, b = call('POST', 'products', {'id': pid, 'name': f'{RUN} {name}'})
    if s == 200:
        created['products'].append(b['id'])
    return s, b


print('K1 product IDs chosen by pricectl')
s, b = product(f'{RUN}_Stack_ProPlan'); report('create with id', s, b, ['id'])
s, b = product(f'{RUN}_Stack_ProPlan'); report('create the same id again', s, b)
s, b = product(f'{RUN}.stack:pro-plan/1'); report("id with '.', ':', '-', '/'", s, b, ['id'])
long_id = (RUN + '_') + 'x' * 300
for n in (64, 100, 255, 256):
    s, b = product(long_id[:n], f'len{n}'); report(f'id of {n} characters', s, b, [])
print('K2 reuse the id of a deleted product')
s, b = call('POST', 'products', {'id': f'{RUN}_del', 'name': 'del'})
report('create', s, b, ['id'])
s, b = call('DELETE', f'products/{RUN}_del'); report('delete', s, b, ['deleted'])
s, b = product(f'{RUN}_del', 'again'); report('create the same id after delete', s, b, ['id'])

print('K3 lookup keys')
pid = created['products'][0]
def price(**extra):
    params = {'product': pid, 'currency': 'usd', 'unit_amount': 100}
    params.update(extra)
    s, b = call('POST', 'prices', params)
    if s == 200:
        created['prices'].append(b['id'])
    return s, b
k = f'{RUN}.Stack.ProMonthly'
s, a = price(lookup_key=k); report('create A with key', s, a, ['lookup_key'])
s, b = call('POST', f'prices/{a["id"]}', {'active': 'false'}); report('archive A', s, b, ['active', 'lookup_key'])
s, c = price(unit_amount=200, lookup_key=k, transfer_lookup_key='true'); report('create B with transfer from archived A', s, c, ['lookup_key', 'active'])
s, b = call('GET', f'prices/{a["id"]}'); report('A after the transfer', s, b, ['lookup_key'])
s, b = call('GET', 'prices', {'lookup_keys[]': k}); report('list by key', s, b)
print('    ', [(p['id'] == c.get('id'), p['active']) for p in b.get('data', [])])
for n in (200, 201):
    s, b = price(lookup_key=('k' * n)); report(f'lookup_key of {n} characters', s, b, [])
keys = [f'{RUN}.k{i}' for i in range(11)]
s, b = call('GET', 'prices', {'lookup_keys[]': keys[:10]}); report('list with 10 keys', s, b)
s, b = call('GET', 'prices', {'lookup_keys[]': keys}); report('list with 11 keys', s, b)

print('K4 entitlement feature lookup keys')
fk = f'{RUN}.feature'
s, f1 = call('POST', 'entitlements/features', {'name': 'f1', 'lookup_key': fk}); report('create F1', s, f1, ['lookup_key'])
if s == 200: created['features'].append(f1['id'])
s, b = call('POST', 'entitlements/features', {'name': 'f2', 'lookup_key': fk}); report('create F2 with the same key while F1 is active', s, b)
s, b = call('POST', f'entitlements/features/{f1["id"]}', {'active': 'false'}); report('deactivate F1', s, b, ['active'])
s, f2 = call('POST', 'entitlements/features', {'name': 'f2', 'lookup_key': fk}); report('create F2 with the same key after F1 was deactivated', s, f2, ['lookup_key'])
if s == 200: created['features'].append(f2['id'])
s, b = call('GET', 'entitlements/features', {'lookup_key': fk}); report('list by lookup_key', s, b)
print('    ', [(x['id'] == f1.get('id') and 'F1' or 'F2', x['active']) for x in b.get('data', [])])
s, b = call('GET', 'entitlements/features', {'lookup_key': fk, 'archived': 'false'}); report('list by lookup_key, archived=false', s, b)
print('    ', [(x['id'] == f1.get('id') and 'F1' or 'F2', x['active']) for x in b.get('data', [])])

for p in created['prices']:
    call('POST', f'prices/{p}', {'active': 'false'})
for p in created['products']:
    call('POST', f'products/{p}', {'active': 'false'})
for f in created['features']:
    call('POST', f'entitlements/features/{f}', {'active': 'false'})
print('cleaned up', {k: len(v) for k, v in created.items()})
