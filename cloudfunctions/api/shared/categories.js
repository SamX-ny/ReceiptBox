// ⚠️ 自动生成：请修改仓库根目录 shared/ 下的源文件，然后运行 npm run sync
/**
 * 开销分类（商品级）与商户类型定义。
 * color 只用于图标底色等装饰（淡色圆底），图表仍使用统一的系列色。
 *
 * 本文件是 shared/ 下的源文件，通过 `npm run sync` 复制到
 * miniprogram/shared 与各云函数目录，请勿直接修改副本。
 */

const CATEGORIES = [
  { id: 'produce', name: '果蔬', en: 'Fruit & Veg', icon: '🥬', color: '#3fa34d' },
  { id: 'meat', name: '肉禽水产', en: 'Meat & Seafood', icon: '🥩', color: '#dc2626' },
  { id: 'dairy', name: '乳品蛋类', en: 'Dairy & Eggs', icon: '🥛', color: '#3b82f6' },
  { id: 'bakery', name: '烘焙面包', en: 'Bakery', icon: '🍞', color: '#c2843a' },
  { id: 'pantry', name: '粮油调味', en: 'Pantry', icon: '🍚', color: '#d99a00' },
  { id: 'frozen', name: '冷冻食品', en: 'Frozen', icon: '🧊', color: '#17a2b8' },
  { id: 'snacks', name: '零食甜点', en: 'Snacks', icon: '🍪', color: '#f97316' },
  { id: 'beverages', name: '饮料酒水', en: 'Drinks', icon: '🥤', color: '#8b5cf6' },
  { id: 'household', name: '日用清洁', en: 'Household', icon: '🧻', color: '#64748b' },
  { id: 'personal', name: '个护美妆', en: 'Personal Care', icon: '🧴', color: '#ec4899' },
  { id: 'baby', name: '母婴', en: 'Baby', icon: '🍼', color: '#f472b6' },
  { id: 'pet', name: '宠物', en: 'Pet', icon: '🐾', color: '#a16207' },
  { id: 'health', name: '医药保健', en: 'Health', icon: '💊', color: '#14b8a6' },
  { id: 'dining', name: '餐饮外食', en: 'Dining Out', icon: '🍜', color: '#e11d48' },
  { id: 'home', name: '家居电器', en: 'Home & Electronics', icon: '🔌', color: '#6366f1' },
  { id: 'clothing', name: '服饰鞋包', en: 'Clothing', icon: '👕', color: '#a855f7' },
  { id: 'transport', name: '交通燃油', en: 'Transport & Fuel', icon: '⛽', color: '#475569' },
  { id: 'other', name: '其他', en: 'Other', icon: '📦', color: '#9ca3af' }
];

const MERCHANT_TYPES = [
  { id: 'supermarket', name: '超市', icon: '🛒', color: '#16a34a' },
  { id: 'restaurant', name: '餐厅', icon: '🍽️', color: '#e11d48' },
  { id: 'cafe', name: '咖啡/茶饮', icon: '☕', color: '#b45309' },
  { id: 'takeaway', name: '外卖/快餐', icon: '🍔', color: '#f97316' },
  { id: 'convenience', name: '便利店', icon: '🏪', color: '#0ea5e9' },
  { id: 'grocer', name: '生鲜/亚超', icon: '🥢', color: '#65a30d' },
  { id: 'pharmacy', name: '药房', icon: '💊', color: '#14b8a6' },
  { id: 'fuel', name: '加油站', icon: '⛽', color: '#475569' },
  { id: 'department', name: '百货/家居', icon: '🏬', color: '#6366f1' },
  { id: 'online', name: '网购', icon: '📦', color: '#8b5cf6' },
  { id: 'other', name: '其他', icon: '🧾', color: '#9ca3af' }
];

const CATEGORY_IDS = CATEGORIES.map(function (c) { return c.id; });
const MERCHANT_TYPE_IDS = MERCHANT_TYPES.map(function (m) { return m.id; });

const CATEGORY_MAP = {};
CATEGORIES.forEach(function (c) { CATEGORY_MAP[c.id] = c; });
const MERCHANT_TYPE_MAP = {};
MERCHANT_TYPES.forEach(function (m) { MERCHANT_TYPE_MAP[m.id] = m; });

function getCategory(id) {
  return CATEGORY_MAP[id] || CATEGORY_MAP.other;
}

function getMerchantType(id) {
  return MERCHANT_TYPE_MAP[id] || MERCHANT_TYPE_MAP.other;
}

function isCategory(id) {
  return Object.prototype.hasOwnProperty.call(CATEGORY_MAP, id);
}

function isMerchantType(id) {
  return Object.prototype.hasOwnProperty.call(MERCHANT_TYPE_MAP, id);
}

/**
 * 关键词规则：用于 OCR 规则解析的兜底分类，以及用户手动新增商品时的默认分类。
 * 顺序有意义：越具体的规则越靠前（如 "milk chocolate" 应归零食而非乳品）。
 */
const CATEGORY_RULES = [
  ['snacks', /chocolate|choc\b|chips|crisps|lollies|lolly|candy|biscuit|cookie|cracker|tim ?tam|popcorn|ice ?cream|gelato|cake|muffin|donut|doughnut|零食|巧克力|薯片|饼干|糖果|冰淇淋|蛋糕|雪糕/i],
  ['beverages', /coke|coca|cola|pepsi|sprite|fanta|solo\b|soft ?drink|juice|water\b|mineral|sparkling|soda|cordial|coffee|nescafe|tea\b|tea ?bags|kombucha|energy ?drink|red ?bull|beer|wine|cider|vodka|whisky|spirit|lager|饮料|可乐|果汁|矿泉水|咖啡|茶|啤酒|红酒|白酒/i],
  ['baby', /nappy|nappies|diaper|huggies|formula|baby|wipes|奶粉|尿不湿|纸尿裤|婴儿|宝宝/i],
  ['pet', /\bdog\b|\bcat\b|pet ?food|whiskas|pedigree|dine\b|kitty|litter|宠物|猫粮|狗粮|猫砂/i],
  ['household', /toilet|tissue|paper ?towel|detergent|laundry|dishwash|finish\b|bin ?bag|garbage|cleaner|bleach|sponge|foil|cling|glad\b|battery|batteries|light ?bulb|纸巾|卫生纸|洗衣|洗洁精|垃圾袋|清洁|保鲜膜|电池/i],
  ['personal', /shampoo|conditioner|soap|body ?wash|toothpaste|toothbrush|deodorant|razor|lotion|sunscreen|makeup|cosmetic|洗发|护发|沐浴|牙膏|牙刷|香皂|护肤|防晒|化妆/i],
  ['health', /panadol|nurofen|ibuprofen|paracetamol|vitamin|supplement|medicine|tablet|capsule|bandaid|band-aid|药|维生素|保健|创可贴/i],
  ['dairy', /milk|cheese|yoghurt|yogurt|butter|cream|egg|eggs|a2\b|dairy|牛奶|奶酪|芝士|酸奶|黄油|鸡蛋|蛋/i],
  ['meat', /beef|steak|mince|lamb|pork|chicken|turkey|bacon|ham\b|sausage|salami|fish|salmon|tuna|prawn|shrimp|seafood|barramundi|肉|鸡|牛|猪|羊|鱼|虾|海鲜|香肠|培根/i],
  ['produce', /apple|banana|orange|mandarin|grape|berry|berries|strawberr|blueberr|avocado|tomato|potato|onion|garlic|carrot|lettuce|cabbage|broccoli|spinach|cucumber|capsicum|mushroom|pumpkin|zucchini|kiwi|mango|pear|lemon|lime|watermelon|melon|fruit|veg|salad|herb|bok ?choy|苹果|香蕉|橙|葡萄|莓|牛油果|番茄|西红柿|土豆|洋葱|蒜|胡萝卜|生菜|白菜|西兰花|菠菜|黄瓜|青椒|蘑菇|南瓜|水果|蔬菜|菜/i],
  ['bakery', /bread|loaf|roll|bun|bagel|croissant|wrap|tortilla|baguette|sourdough|面包|吐司|馒头|包子/i],
  ['frozen', /frozen|froz\b|nugget|dumpling|pizza|速冻|冷冻|饺子|汤圆/i],
  ['pantry', /rice|pasta|spaghetti|noodle|flour|sugar|salt|oil|olive|sauce|soy|vinegar|spice|cereal|oats|weet ?bix|honey|jam|vegemite|peanut ?butter|canned|tin\b|beans|stock|soup|大米|米|面|面粉|糖|盐|油|酱|醋|调料|麦片|蜂蜜|罐头/i],
  ['transport', /unleaded|diesel|petrol|fuel|e10|u91|u95|u98|opal|myki|parking|toll|汽油|柴油|加油|停车|过路费/i],
  ['clothing', /shirt|t-shirt|tee\b|pants|jeans|dress|sock|shoe|jacket|衣|裤|鞋|袜/i],
  ['home', /kitchen|towel|pillow|blanket|cable|charger|usb|headphone|lamp|锅|毛巾|枕|充电|数据线/i]
];

const MERCHANT_RULES = [
  ['supermarket', /woolworths|coles|aldi|iga\b|costco|foodworks|harris ?farm|spudshed|drakes|countdown|supermarket|超市/i],
  ['grocer', /asian ?grocer|亚超|\bfruit\b|greengrocer|market|butcher|bakery|生鲜|菜市场/i],
  ['pharmacy', /chemist|pharmacy|priceline|terry ?white|药房|药店/i],
  ['fuel', /\bbp\b|shell|caltex|ampol|7-?eleven|united ?petroleum|puma ?energy|\bmetro\b ?petroleum|加油/i],
  ['convenience', /convenience|ezymart|night ?owl|便利店/i],
  ['cafe', /cafe|café|coffee|espresso|chatime|gong ?cha|bubble ?tea|starbucks|咖啡|奶茶|茶饮/i],
  ['takeaway', /mcdonald|kfc|hungry ?jack|subway|domino|pizza ?hut|grill'?d|guzman|nando|uber ?eats|menulog|doordash|外卖|快餐/i],
  ['restaurant', /restaurant|bistro|kitchen|dining|eatery|grill|bar\b|pub\b|hotel|yum ?cha|餐厅|饭店|酒家|酒楼|火锅|烧烤/i],
  ['department', /kmart|target|big ?w|myer|david ?jones|ikea|bunnings|jb ?hi-?fi|harvey ?norman|officeworks|百货|家居/i],
  ['online', /amazon|ebay|catch\.com|taobao|淘宝|京东|拼多多|online/i]
];

function guessCategory(text, fallback) {
  const s = String(text || '');
  for (let i = 0; i < CATEGORY_RULES.length; i++) {
    if (CATEGORY_RULES[i][1].test(s)) return CATEGORY_RULES[i][0];
  }
  return fallback || 'other';
}

function guessMerchantType(text) {
  const s = String(text || '');
  for (let i = 0; i < MERCHANT_RULES.length; i++) {
    if (MERCHANT_RULES[i][1].test(s)) return MERCHANT_RULES[i][0];
  }
  return 'other';
}

/** 餐饮类商户的整张小票默认归入“餐饮外食”，加油站归入“交通燃油”。 */
function defaultCategoryForMerchantType(type) {
  if (type === 'restaurant' || type === 'cafe' || type === 'takeaway') return 'dining';
  if (type === 'fuel') return 'transport';
  if (type === 'pharmacy') return 'health';
  return 'other';
}

module.exports = {
  CATEGORIES: CATEGORIES,
  CATEGORY_IDS: CATEGORY_IDS,
  MERCHANT_TYPES: MERCHANT_TYPES,
  MERCHANT_TYPE_IDS: MERCHANT_TYPE_IDS,
  getCategory: getCategory,
  getMerchantType: getMerchantType,
  isCategory: isCategory,
  isMerchantType: isMerchantType,
  guessCategory: guessCategory,
  guessMerchantType: guessMerchantType,
  defaultCategoryForMerchantType: defaultCategoryForMerchantType
};
