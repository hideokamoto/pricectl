import { Stack } from '@pricectl/core';
import { Product } from '@pricectl/constructs';

const stack = new Stack(undefined, 'CmdStack', { apiKey: 'sk_test_dummy' });
new Product(stack, 'Widget', { name: 'Widget' });

export default stack;
