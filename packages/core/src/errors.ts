export const STRIPE_API_KEY_MISSING_ERROR =
  'Stripe API key not found.\n\n' +
  'To fix this, choose one of:\n' +
  '  1. Set the environment variable:  export STRIPE_SECRET_KEY=sk_...\n' +
  '  2. Pass it in the Stack constructor: new Stack(scope, "id", { apiKey: "sk_..." })\n' +
  '  3. Add STRIPE_SECRET_KEY=sk_... to your .env file';
