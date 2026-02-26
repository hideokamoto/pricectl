import { Stack } from '@pricectl/core';

export const API_KEY = 'sk_test_dummy_key_for_testing';

export function createStack(id = 'TestStack'): Stack {
  return new Stack(undefined, id, { apiKey: API_KEY });
}
