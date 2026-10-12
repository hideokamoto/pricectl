export const STRIPE_API_KEY_MISSING_ERROR =
  'Stripe API key not found.\n\n' +
  'To fix this, choose one of:\n' +
  '  1. Set the environment variable:  export STRIPE_SECRET_KEY=sk_...\n' +
  '  2. Pass it in the Stack constructor: new Stack(scope, "id", { apiKey: "sk_..." })\n' +
  '  3. Add STRIPE_SECRET_KEY=sk_... to your .env file';

export const EMPTY_LOGICAL_ID_ERROR =
  'Construct id must not be an empty string. ' +
  'Provide a unique non-empty identifier as the second argument.';

/** Error for a construct ID that a sibling already uses. */
export const DUPLICATE_LOGICAL_ID_ERROR = (id: string, path: string) =>
  `There is already a child construct with id "${id}" under "${path}". ` +
  'Each construct within the same scope must have a unique id.';

/** Error for a resource ID that another resource in the stack already uses. */
export const DUPLICATE_RESOURCE_ID_ERROR = (id: string, existingPath: string, newPath: string) =>
  `Resource id "${id}" at "${newPath}" is already used by "${existingPath}". ` +
  'Resource ids must be unique within a stack because pricectl identifies resources in Stripe by id.';
