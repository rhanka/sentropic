import { createNotBoundHandlers } from '../not-bound.js';

export const productsToolNames = ['products_list', 'product_get'] as const;
export const productsHandlers = createNotBoundHandlers('products', productsToolNames);
