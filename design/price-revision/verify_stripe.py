"""Check Stripe behaviors that the price revision design depends on (test mode)."""
import base64, json, sys, time, urllib.parse, urllib.request, urllib.error

KEY = open(sys.argv[1]).read().strip()
VERSION = '2026-09-30.endive'
RUN = f'pricectl-verify-{int(time.time())}'
created = {'products': [], 'prices': []}


def call(method, path, params=None):
    data = urllib.parse.urlencode(params or {}, doseq=True).encode() if method == 'POST' else None
    url = 'https://api.stripe.com/v1/' + path
    if method == 'GET' and params:
        url += '?' + urllib.parse.urlencode(params, doseq=True)
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header('Authorization', 'Basic ' + base64.b64encode(f'{KEY}:'.encode()).decode())
    req.add_header('Stripe-Version', VERSION)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def ok(status, body):
    return status == 200


def err(body):
    e = body.get('error', {})
    return f"{e.get('type')}/{e.get('code')}: {e.get('message')}"


def product(name):
    s, b = call('POST', 'products', {'name': f'{RUN} {name}', 'metadata[verify]': RUN})
    assert ok(s, b), err(b)
    created['products'].append(b['id'])
    return b['id']


def price(prod, amount=1000, **extra):
    params = {'product': prod, 'currency': 'usd', 'unit_amount': amount, 'metadata[verify]': RUN}
    params.update(extra)
    s, b = call('POST', 'prices', params)
    if ok(s, b):
        created['prices'].append(b['id'])
    return s, b


def report(case, s, b, field=None):
    if ok(s, b):
        shown = {k: b.get(k) for k in (field or [])}
        print(f'  [{case}] HTTP {s} OK {shown}')
    else:
        print(f'  [{case}] HTTP {s} ERROR {err(b)}')


print('T1 default_price: archive while default, then unset with empty string')
p = product('T1')
s, pr = price(p); assert ok(s, pr), err(pr)
s, b = call('POST', f'products/{p}', {'default_price': pr['id']}); report('set default', s, b, ['default_price'])
s, b = call('POST', f'prices/{pr["id"]}', {'active': 'false'}); report('archive default price', s, b, ['active'])
s, b = call('POST', f'products/{p}', {'default_price': ''}); report("unset default_price=''", s, b, ['default_price'])
s, b = call('POST', f'prices/{pr["id"]}', {'active': 'false'}); report('archive after unset', s, b, ['active'])

print('T2 default_price must be active / must belong to the product')
p2 = product('T2a'); p3 = product('T2b')
s, a = price(p2); assert ok(s, a), err(a)
s, b = call('POST', f'prices/{a["id"]}', {'active': 'false'})
s, b = call('POST', f'products/{p2}', {'default_price': a['id']}); report('set archived price as default', s, b, ['default_price'])
s, other = price(p3); assert ok(s, other), err(other)
s, b = call('POST', f'products/{p2}', {'default_price': other['id']}); report("set another product's price as default", s, b, ['default_price'])

print('T3 lookup_key: update in place, conflicts, transfer on update, archived holder')
p4 = product('T3')
k1, k2 = f'{RUN}-k1', f'{RUN}-k2'
s, x = price(p4, lookup_key=k1); report('create X with k1', s, x, ['lookup_key'])
s, b = call('POST', f'prices/{x["id"]}', {'lookup_key': k2}); report('update X lookup_key k1->k2 in place', s, b, ['lookup_key'])
s, y = price(p4, 2000); assert ok(s, y), err(y)
s, b = call('POST', f'prices/{y["id"]}', {'lookup_key': k2}); report('update Y to k2 (held by X) without transfer', s, b, ['lookup_key'])
s, b = call('POST', f'prices/{y["id"]}', {'lookup_key': k2, 'transfer_lookup_key': 'true'}); report('update Y to k2 with transfer', s, b, ['lookup_key'])
s, b = call('GET', f'prices/{x["id"]}'); report('X after transfer', s, b, ['lookup_key'])
s, b = call('POST', f'prices/{y["id"]}', {'lookup_key': ''}); report("unset Y lookup_key=''", s, b, ['lookup_key'])
s, z = price(p4, 3000, lookup_key=k1); report('create Z with k1', s, z, ['lookup_key'])
s, b = call('POST', f'prices/{z["id"]}', {'active': 'false'}); report('archive Z', s, b, ['active', 'lookup_key'])
s, w = price(p4, 4000, lookup_key=k1); report('create W with k1 (held by archived Z) without transfer', s, w, ['lookup_key'])

print('T4 tax_behavior transitions')
p5 = product('T4')
s, t = price(p5); report('create without tax_behavior (account default inferred_by_currency)', s, t, ['tax_behavior'])
s, b = call('POST', f'prices/{t["id"]}', {'tax_behavior': 'inclusive'}); report('unspecified -> inclusive', s, b, ['tax_behavior'])
s, b = call('POST', f'prices/{t["id"]}', {'tax_behavior': 'exclusive'}); report('inclusive -> exclusive', s, b, ['tax_behavior'])
s, b = call('POST', f'prices/{t["id"]}', {'tax_behavior': 'unspecified'}); report('inclusive -> unspecified', s, b, ['tax_behavior'])
s, b = call('POST', f'prices/{t["id"]}', {'tax_behavior': 'inclusive'}); report('inclusive -> inclusive (same value)', s, b, ['tax_behavior'])
s, u = price(p5, 2000, tax_behavior='unspecified'); report("create with tax_behavior='unspecified'", s, u, ['tax_behavior'])

print('T5 nickname update (control)')
s, b = call('POST', f'prices/{t["id"]}', {'nickname': 'renamed'}); report('update nickname', s, b, ['nickname'])

json.dump({'run': RUN, **created}, open(sys.argv[2], 'w'))
print('created', {k: len(v) for k, v in created.items()}, 'run', RUN)
