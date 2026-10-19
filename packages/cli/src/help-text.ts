/**
 * Sentences shared by the help of several commands. Each one states what the code does, so
 * keep it in line with app.ts (loading the app file) and engine/lock-store.ts (the lock).
 */

/** How the app file is loaded and where its Stripe API key comes from (see `loadApp` and `Stack`). */
export const APP_FILE_HELP =
  'The app file (TypeScript or JavaScript) is run and must export the Stack as its default export, as `stack`, ' +
  'or as the module itself. Loading it needs a Stripe API key: the Stack\'s apiKey, or else STRIPE_SECRET_KEY. ' +
  'A .env file is not read.';

/** Where the lock is kept (see `FileLockStore`, which every command creates without a directory). */
export const LOCK_FILE_HELP =
  'It creates or updates pricectl.lock.json in the current directory (not the directory of the app file); ' +
  'commit it to Git. With --frozen-lock it fails instead when the lock is out of date, and writes nothing.';
