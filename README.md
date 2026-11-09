# Receipt Box 收据箱

一个**微信小程序**：拍下超市购物、餐厅就餐的小票，自动识别并解析小票内容，帮家庭管理日常开销。

- 📷 **拍照识别**：拍照或从相册选择小票，自动识别商户、门店、日期时间、每个商品（名称、规格、数量、单价、折扣）、GST 与实付金额
- 🗂️ **自动分类**：每个商品自动归入 18 个开销分类（果蔬、肉禽水产、乳品蛋类、饮料酒水、日用清洁、餐饮外食……），识别结果可在确认页修改
- 📊 **多维度统计**：按**日 / 周 / 月 / 年**查看总支出、环比、趋势图、分类占比、去了哪些商户、消费场所类型、买得最多的商品；日视图列出当天在**哪里**买了**哪些类型**的商品
- 🏷️ **价格追踪**：同一商品在不同时间、不同商店的价格历史。例如某天在 Woolworths 买 2L 可口可乐 $4，后来在 Coles 买 $4.5，商品页会显示价格走势、各商店均价/最低价、按每升/每千克折算的单价，以及同一商品其他规格的比较
- 👨‍👩‍👧 **家庭共享**：用 6 位邀请码邀请家人加入，全家的小票汇总到同一个账本

## 技术方案

| 部分 | 实现 |
| --- | --- |
| 前端 | 原生微信小程序（WXML / WXSS / JS），支持深色模式；图表为自绘 Canvas 2D 组件，无第三方依赖 |
| 后端 | 微信云开发：云数据库 + 云存储 + 云函数（`api`、`parseReceipt`） |
| 小票识别 | 默认使用 Claude 视觉模型（`claude-opus-5-5`）+ 结构化输出（JSON Schema）直接从照片解析出商户、商品、分类与规范化商品名；未配置 Claude 时退回到 **微信 OCR 通用印刷体识别 + 规则解析** |

```
小程序                       云函数                          外部服务
┌───────────────┐  上传图片  ┌──────────────┐
│ 拍照 / 相册     │ ────────▶ │  云存储        │
│ 识别页          │           └──────┬───────┘
│                │  fileID   ┌──────▼───────┐  图片  ┌──────────────┐
│                │ ────────▶ │ parseReceipt │ ─────▶ │ Claude API   │
│ 确认 / 编辑页    │ ◀──草稿── │（不写库）      │ ◀JSON─ │ (或微信 OCR)  │
│                │           └──────────────┘        └──────────────┘
│                │  保存     ┌──────────────┐
│ 首页 / 账单 /    │ ────────▶ │     api      │──▶ receipts / priceRecords / families …
│ 统计 / 比价 / 我的│ ◀──数据── │ 按家庭隔离数据 │
└───────────────┘           └──────────────┘
```

识别结果**不会直接入库**：先进入确认页，用户核对、修改后再保存。保存时每个商品会生成一条价格记录（`priceRecords`），用于价格追踪。

## 目录结构

```
ReceiptBox/
├── project.config.json        # 微信开发者工具项目配置（需填 appid）
├── miniprogram/               # 小程序前端
│   ├── config.js              # ⚠️ 需填写云开发环境 ID
│   ├── app.js / app.json / app.wxss / theme.json
│   ├── pages/
│   │   ├── index/             # 首页：本月概览、拍小票入口、每日支出、分类 Top5、最近小票
│   │   ├── scan/              # 上传并识别小票
│   │   ├── receipt-edit/      # 确认 / 编辑小票（识别结果、手动记一笔）
│   │   ├── receipt-detail/    # 小票详情（按分类分组的商品、原图）
│   │   ├── receipts/          # 账单：按月浏览、分类筛选、搜索
│   │   ├── receipt-list/      # 筛选后的小票列表（按商户 / 分类 / 时间）
│   │   ├── stats/             # 统计：日 / 周 / 月 / 年
│   │   ├── products/          # 比价：所有买过的商品
│   │   ├── product-detail/    # 单个商品的价格走势、各商店比较、其他规格
│   │   ├── product-pick/      # 合并商品时选择目标
│   │   └── mine/              # 家庭共享、邀请码、昵称
│   ├── components/            # chart（Canvas 图表）、receipt-item、receipt-feed
│   ├── shared/                # ← 由 shared/ 自动复制
│   └── utils/
├── cloudfunctions/
│   ├── api/                   # 业务接口：家庭、小票增删改查、统计、价格追踪
│   └── parseReceipt/          # 小票识别：Claude 视觉 / 微信 OCR
├── shared/                    # 前后端共用逻辑的源文件（分类、商品规格归一化、日期、统计）
├── scripts/sync-shared.js     # 把 shared/ 复制到小程序与云函数目录
└── test/                      # 单元测试、云函数集成测试、页面冒烟测试
```

> 小程序和每个云函数都是独立打包上传的，不能引用目录外的文件，所以 `shared/` 会被复制三份。**请只修改根目录 `shared/` 下的源文件，然后运行 `npm run sync`**；`npm test` 会检查副本是否一致。

## 部署步骤

### 1. 准备小程序与云开发

1. 在 [微信公众平台](https://mp.weixin.qq.com/) 注册小程序，拿到 AppID，填入 `project.config.json` 的 `appid`。
2. 用 [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html) 导入本仓库根目录。
3. 点击工具栏「云开发」开通云开发环境，把**环境 ID** 填入 `miniprogram/config.js` 的 `envId`。

### 2. 创建数据库集合

在云开发控制台 → 数据库中创建以下集合，**权限均设为「仅管理端可读写」**（所有读写都经过云函数，并按家庭校验权限）：

| 集合 | 说明 | 建议索引 |
| --- | --- | --- |
| `users` | 用户（`_id` 为 openid）与所属家庭 | — |
| `families` | 家庭、成员、邀请码 | `inviteCode` |
| `receipts` | 小票 | `familyId + date(降序)`、`familyId + categories` |
| `priceRecords` | 商品价格记录（每个商品一行） | `familyId + productKey + date`、`familyId + date`、`receiptId` |
| `productAliases` | 用户合并过的商品别名 | `familyId` |

### 3. 部署云函数

在开发者工具中，右键 `cloudfunctions/api` 和 `cloudfunctions/parseReceipt`，选择「**上传并部署：云端安装依赖**」。

- 运行环境请选择 **Node.js 18 或更高**（`parseReceipt` 依赖的 Anthropic SDK 需要 Node 18+）。
- `parseReceipt` 的超时时间已在 `config.json` 中设为 60 秒，`api` 为 20 秒。

### 4. 配置小票识别

**方式 A：Claude 视觉识别（推荐）**

在云开发控制台 → 云函数 → `parseReceipt` → 函数配置 → 环境变量中添加：

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | ✅ | Claude API Key（在 [Claude Console](https://platform.claude.com/) 创建） |
| `ANTHROPIC_BASE_URL` | | API 地址。如果云函数所在网络无法访问 `api.anthropic.com`，填你自己的转发网关地址 |
| `RECEIPT_CLAUDE_MODEL` | | 默认 `claude-opus-5-5` |
| `RECEIPT_CLAUDE_EFFORT` | | `low` / `medium` / `high`，默认 `low` |

说明：
- 识别使用 Claude 的**结构化输出**（`output_config.format` + JSON Schema），保证返回字段完整、分类取值合法；并开启了服务端 `fallbacks: "default"`，偶发的安全策略拒绝会自动换用推荐的备用模型重试。
- 默认 `effort` 为 `low`：小票识别以「看清并抄录」为主，`low` 已能胜任，且云函数单次最长只能运行 60 秒。如果发现长小票识别不全，可改为 `medium`，同时关注是否超时。
- 小票照片会发送给 Anthropic 进行识别，请在小程序的隐私说明中告知用户。

**方式 B：微信 OCR（无需外部服务）**

不配置 `ANTHROPIC_API_KEY` 时自动使用。需在 [微信服务市场](https://fuwu.weixin.qq.com/) 为小程序开通「OCR 识别 / 通用印刷体识别」服务。规则解析能识别常见的澳洲超市小票格式（称重商品、`2 @ $1.50`、`Less Promotion` 折扣、GST、TOTAL 等），但商品名不会被规范化，跨商店比价的效果不如方式 A，建议在确认页仔细核对。

### 5. 隐私与上线

- 在小程序管理后台「设置 → 服务内容声明 → 用户隐私保护指引」中声明使用了**摄像头**、**选中的照片**（用于拍摄/选择小票），否则 `wx.chooseMedia` 会被拦截。
- 若使用方式 A，在隐私指引中说明小票图片会提交给第三方识别服务。

## 本地开发与测试

```bash
npm run sync        # 修改 shared/ 后同步到小程序与云函数
npm test            # 单元测试 + 云函数集成测试（无需安装依赖）
npm install
npm run test:ui     # 页面冒烟测试：用 miniprogram-simulate 渲染每个页面
```

测试内容：
- `test/product|dates|receipt|stats.test.js`：商品规格解析与商品键、按周/月/年分段、小票清洗与分类分摊、统计与价格汇总
- `test/ocrParser.test.js`：OCR 规则解析（澳洲超市小票、中文餐厅小票）
- `test/claude.test.js`：Claude 请求参数（模型、结构化输出、图片、备用模型）与错误处理（需先在 `cloudfunctions/parseReceipt` 下 `npm install`，否则跳过）
- `test/api.test.js`：在内存数据库（`test/helpers/fake-cloud.js` 模拟 `wx-server-sdk`）上跑通完整流程：建家庭 → 保存小票 → 重复检测 → 筛选 → 统计 → 价格历史 → 合并商品 → 修改价格 → 家人加入/退出 → 删除
- `test/ui/pages.sim.js`：渲染全部页面，并走通「拍照 → 识别 → 确认 → 保存」与「手动记一笔」

## 数据说明

- **日期**以本地日期字符串 `YYYY-MM-DD` 存储与查询，周从周一开始。云函数服务器与用户（澳洲）不在同一时区，用字符串可避免时区偏差。
- **分类统计**：一张超市小票通常包含多个分类，统计时按商品金额比例把小票**实付总额**分摊到各分类（折扣、附加费等差额按比例分摊），各分类之和始终等于实际支出。
- **商品键（productKey）**：`规范化商品名|规格`，例如 `coca-cola-classic|2l`。Claude 识别时会把 `COKE CLASSIC 2LT`、`Coca Cola Classic 2L` 等写法规范成同一个商品名；仍然被识别成两个商品时，可以在商品详情页「与其他商品合并」，之后的小票会自动归入合并后的商品。
- **单位价格**：根据规格（`2L`、`24x375ml`、`500g`）或称重单位（`kg`）计算每升 / 每千克价格，方便比较不同规格。
- 货币默认 AUD，可在 `miniprogram/config.js` 修改显示符号。
