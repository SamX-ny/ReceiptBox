/**
 * 小票识别的提示词与 JSON Schema（Claude 结构化输出）。
 */

const categories = require('../shared/categories');

const NUM_OR_NULL = { anyOf: [{ type: 'number' }, { type: 'null' }] };

const ITEM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'productName', 'brand', 'spec', 'quantity', 'unit', 'unitPrice', 'totalPrice', 'discount', 'category'],
  properties: {
    name: { type: 'string', description: '小票上打印的原始商品名' },
    productName: { type: 'string', description: '规范化后的商品名，不含规格、促销字样，用于跨超市/跨时间比价' },
    brand: { type: 'string', description: '品牌，未知为空字符串' },
    spec: { type: 'string', description: '包装规格，如 2L、375ml、24x375ml、500g；称重商品或未知为空字符串' },
    quantity: { type: 'number', description: '数量；称重商品为重量' },
    unit: { type: 'string', enum: ['each', 'kg', 'g', 'L', 'ml'] },
    unitPrice: { type: 'number', description: '折扣前单价（称重商品为每 kg 价格）' },
    totalPrice: { type: 'number', description: '该行实付金额（已扣除该商品的折扣）' },
    discount: { type: 'number', description: '该商品获得的折扣金额（正数），没有为 0' },
    category: { type: 'string', enum: categories.CATEGORY_IDS }
  }
};

const RECEIPT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['isReceipt', 'merchant', 'date', 'time', 'currency', 'items', 'subtotal', 'tax', 'discount', 'total', 'paymentMethod', 'notes'],
  properties: {
    isReceipt: { type: 'boolean', description: '图片是否为购物/消费小票或发票' },
    merchant: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'branch', 'address', 'type'],
      properties: {
        name: { type: 'string', description: '商户品牌名，如 Woolworths、Coles、ALDI' },
        branch: { type: 'string', description: '门店/分店名，如 Chatswood' },
        address: { type: 'string' },
        type: { type: 'string', enum: categories.MERCHANT_TYPE_IDS }
      }
    },
    date: { type: 'string', description: 'YYYY-MM-DD；无法识别为空字符串' },
    time: { type: 'string', description: 'HH:mm（24 小时制）；无法识别为空字符串' },
    currency: { type: 'string', description: 'ISO 4217 货币代码，如 AUD、CNY' },
    items: { type: 'array', items: ITEM_SCHEMA },
    subtotal: NUM_OR_NULL,
    tax: NUM_OR_NULL,
    discount: NUM_OR_NULL,
    total: NUM_OR_NULL,
    paymentMethod: { type: 'string', description: '如 EFTPOS、Visa、Mastercard、Cash、Apple Pay；未知为空字符串' },
    notes: { type: 'string', description: '看不清或不确定的地方，简要说明；没有则为空字符串' }
  }
};

const CATEGORY_GUIDE = categories.CATEGORIES.map(function (c) {
  return '- ' + c.id + '：' + c.name + '（' + c.en + '）';
}).join('\n');

const MERCHANT_GUIDE = categories.MERCHANT_TYPES.map(function (m) {
  return '- ' + m.id + '：' + m.name;
}).join('\n');

const SYSTEM_PROMPT = [
  'You read photos of shopping and restaurant receipts for a family expense-tracking app (WeChat mini program "Receipt Box").',
  'The family mainly lives in Australia, so expect Woolworths, Coles, ALDI, IGA, Costco, Asian grocers, cafes and restaurants, with prices in AUD. Receipts in Chinese or other languages also occur.',
  'Transcribe the receipt faithfully into the requested JSON. Never invent items or prices you cannot see; if part of the receipt is unreadable, leave it out and mention it in "notes".',
  '',
  'How to read Australian receipts:',
  '- A line such as "0.856 kg NET @ $3.90/kg" belongs to the item above it: quantity 0.856, unit "kg", unitPrice 3.90, totalPrice is the amount printed for that item.',
  '- A line such as "2 @ $1.50 each" or "QTY 2 @ 1.50" sets quantity 2 and unitPrice 1.50 for the item above it.',
  '- Lines like "Less Promotion", "Saving", "Member Price", "Discount", "Multi-buy" or negative amounts are discounts on the item above: put the amount (positive) in that item\'s "discount" and subtract it from its totalPrice. Store-wide discounts that apply to no single item go in the receipt-level "discount".',
  '- Prices include GST. "tax" is the GST amount printed on the receipt (do not add it to the total). Items marked with ^ or # are GST-applicable; ignore the marker.',
  '- "total" is the amount actually paid, including card surcharges and rounding. Add card surcharges, delivery fees, service charges or tips as their own items (category "other") so the items add up to the total.',
  '- Ignore payment terminal details, loyalty points balances, barcodes and promotional footers.',
  '',
  'Normalising products (important for price tracking across stores and dates):',
  '- "name" is the line exactly as printed (e.g. "WW CHIPS ORIG 175G").',
  '- "productName" is a clean, stable name WITHOUT size, promo text or store codes, with abbreviations expanded and the canonical brand spelling, e.g. "Woolworths Original Potato Chips", "Coca-Cola Classic", "Bananas Cavendish", "a2 Full Cream Milk". The same product must get the same productName no matter which store printed it. Keep Chinese product names in Chinese.',
  '- "spec" is the pack size in compact form: "2L", "1.25L", "375ml", "24x375ml", "500g", "1kg", "12pk". Leave it empty for weighed produce or when no size is shown.',
  '- For restaurants, each dish or drink is an item; use category "dining" for food and drink consumed at the venue.',
  '',
  'Item categories:',
  CATEGORY_GUIDE,
  '',
  'Merchant types:',
  MERCHANT_GUIDE,
  '',
  'Dates on Australian receipts are day/month/year. Output dates as YYYY-MM-DD and times as 24-hour HH:mm.',
  'If the image is not a receipt or invoice, set "isReceipt" to false and return empty values.'
].join('\n');

const USER_PROMPT = '请识别这张小票，按要求输出 JSON。Read this receipt and return the JSON.';

module.exports = {
  RECEIPT_SCHEMA: RECEIPT_SCHEMA,
  SYSTEM_PROMPT: SYSTEM_PROMPT,
  USER_PROMPT: USER_PROMPT
};
