"""Measure how long listing every price takes (test mode), as v3 plan does without a state file.

Usage: python3 measure_listing.py KEY_FILE COUNT
Creates COUNT prices on one product tagged with metadata, lists all prices of the account the
way pricectl does (auto-pagination, limit=100, expand data.tiers), times it, then archives
what it created.
"""
import base64, json, sys, time, urllib.parse, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor

KEY = open(sys.argv[1]).read().strip()
COUNT = int(sys.argv[2])
VERSION = '2026-09-30.endive'
RUN = f'pricectl-measure-{int(time.time())}'


def call(method, path, params=None):
    data = urllib.parse.urlencode(params or {}, doseq=True).encode() if method == 'POST' else None
    url = 'https://api.stripe.com/v1/' + path
    if method == 'GET' and params:
        url += '?' + urllib.parse.urlencode(params, doseq=True)
    for attempt in range(6):
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header('Authorization', 'Basic ' + base64.b64encode(f'{KEY}:'.encode()).decode())
        req.add_header('Stripe-Version', VERSION)
        try:
            with urllib.request.urlopen(req) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(2 ** attempt)
                continue
            raise RuntimeError(e.read().decode())
    raise RuntimeError('rate limited')


def list_all_prices():
    pages, items, after = 0, 0, None
    while True:
        params = {'limit': 100, 'expand[]': 'data.tiers'}
        if after:
            params['starting_after'] = after
        page = call('GET', 'prices', params)
        pages += 1
        items += len(page['data'])
        if not page['has_more']:
            return pages, items
        after = page['data'][-1]['id']


product = call('POST', 'products', {'name': RUN, 'metadata[verify]': RUN})['id']
t0 = time.time()
with ThreadPoolExecutor(max_workers=8) as pool:
    ids = list(pool.map(lambda i: call('POST', 'prices', {
        'product': product, 'currency': 'usd', 'unit_amount': 100 + i,
        'metadata[pricectl_stack]': RUN, 'metadata[pricectl_id]': f'P{i}',
    })['id'], range(COUNT)))
print(f'created {len(ids)} prices in {time.time() - t0:.1f}s')

for run in range(3):
    t0 = time.time()
    pages, items = list_all_prices()
    elapsed = time.time() - t0
    print(f'list all prices: {items} prices, {pages} pages, {elapsed:.2f}s ({elapsed / pages:.3f}s per page)')

t0 = time.time()
with ThreadPoolExecutor(max_workers=8) as pool:
    list(pool.map(lambda i: call('POST', f'prices/{i}', {'active': 'false'}), ids))
call('POST', f'products/{product}', {'active': 'false'})
print(f'archived {len(ids)} prices and the product in {time.time() - t0:.1f}s')
