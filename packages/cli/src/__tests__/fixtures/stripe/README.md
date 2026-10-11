# Recorded Stripe responses

Raw responses recorded from a Stripe test-mode account with API version
`2026-09-30.endive` (the version pricectl pins). Tests use them so that the
shape of Stripe objects (nulls, defaults, omitted fields) matches reality.

Sanitized before committing: the account-specific segment of object IDs was
replaced with `TESTACCT00`, account IDs with `acct_TESTACCOUNT`, and
`request_log_url` was removed from error bodies. No other edits were made.

- `price-tiered.json` is the tiered price as Stripe returns it by default
  (without `tiers`); `price-tiered-expanded.json` is the same price retrieved
  with `expand[]=tiers`.
- `product-features-list.json` is `GET /v1/products/{id}/features` for a
  product with one attached feature.
- `error-*.json` files are the error bodies Stripe returned for the named
  situation.
