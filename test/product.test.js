const test = require('node:test');
const assert = require('node:assert/strict');
const product = require('../shared/product');

test('parseSize: 单一规格', () => {
  assert.deepEqual(product.parseSize('Coca-Cola Classic 2L'), { amount: 2000, base: 'ml', count: 1, label: '2L' });
  assert.deepEqual(product.parseSize('Coke 1.25 Litre'), { amount: 1250, base: 'ml', count: 1, label: '1.25L' });
  assert.deepEqual(product.parseSize('WW CHIPS ORIG 175G'), { amount: 175, base: 'g', count: 1, label: '175g' });
  assert.deepEqual(product.parseSize('牛奶 1升'), { amount: 1000, base: 'ml', count: 1, label: '1L' });
  assert.equal(product.parseSize('Bananas Cavendish'), null);
  assert.equal(product.parseSize('2 lemons'), null);
});

test('parseSize: 多件装', () => {
  assert.deepEqual(product.parseSize('Coke 24 x 375ml'), { amount: 9000, base: 'ml', count: 24, label: '24×375ml' });
  assert.deepEqual(product.parseSize('375ml x 10'), { amount: 3750, base: 'ml', count: 10, label: '10×375ml' });
  assert.equal(product.parseSize('Eggs 12pk').count, 12);
});

test('productKey: 同一商品不同写法得到相同 key', () => {
  const a = product.productKey({ productName: 'Coca-Cola Classic', spec: '2L' });
  const b = product.productKey({ productName: 'Coca Cola Classic 2 L' });
  const c = product.productKey({ name: 'COCA-COLA CLASSIC 2LT' });
  assert.equal(a, 'coca-cola-classic|2l');
  assert.equal(b, a);
  assert.equal(c, a);
  assert.notEqual(product.productKey({ productName: 'Coca-Cola Classic', spec: '1.25L' }), a);
});

test('productKey: 品牌前缀不重复', () => {
  assert.equal(product.productKey({ productName: 'a2 Full Cream Milk', brand: 'a2', spec: '2L' }), 'a2-full-cream-milk|2l');
  assert.equal(product.productKey({ productName: 'Full Cream Milk', brand: 'a2', spec: '2L' }), 'a2-full-cream-milk|2l');
});

test('measurePrice: 按升/千克折算', () => {
  assert.deepEqual(product.measurePrice({ unitPrice: 4, spec: '2L' }), { value: 2, unit: 'L' });
  assert.deepEqual(product.measurePrice({ unitPrice: 3.5, spec: '175g' }), { value: 20, unit: 'kg' });
  assert.deepEqual(product.measurePrice({ unitPrice: 3.9, unit: 'kg', quantity: 0.856 }), { value: 3.9, unit: 'kg' });
  assert.deepEqual(product.measurePrice({ unitPrice: 24, spec: '24x375ml' }), { value: 2.67, unit: 'L' });
  assert.equal(product.measurePrice({ unitPrice: 5, spec: '' }), null);
});
