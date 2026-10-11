# Recorded Stripe responses

Raw responses recorded from a Stripe test-mode account with API version
`2024-12-18.acacia` (the version pricectl pins). Tests use them so that the
shape of Stripe objects (nulls, defaults, omitted fields) matches reality.

Sanitized before committing: the account-specific segment of object IDs was
replaced with `TESTACCT00`, account IDs with `acct_TESTACCOUNT`, and
`request_log_url` was removed from error bodies.

Edits beyond sanitizing:

- `price-tiered-expanded.json`: retrieved with `expand[]=tiers` after the price
  had been archived, so `active` was changed back to `true` to represent the
  live price.

`error-*.json` files are the error bodies Stripe returned for the named
situation.
