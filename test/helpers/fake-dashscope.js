/**
 * 本地 HTTP 服务，模拟百炼的 OpenAI 兼容接口（/chat/completions），用于测试 Qwen 识别。
 *
 *   const server = await fakeDashscope.start();
 *   server.reply = (req) => ({ status: 200, body: {...} });   // 或 { delayMs }
 *   process.env.DASHSCOPE_BASE_URL = server.baseUrl;
 *   ...
 *   await server.close();
 */
const http = require('http');

function completion(content, extra) {
  return {
    status: 200,
    body: Object.assign({
      id: 'chatcmpl-test',
      model: 'qwen-vl-ocr',
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: content } }],
      usage: { prompt_tokens: 3000, completion_tokens: 800, total_tokens: 3800 }
    }, extra || {})
  };
}

function start() {
  return new Promise((resolve) => {
    const state = { requests: [], reply: () => completion('{}') };
    const server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const record = { method: req.method, url: req.url, headers: req.headers, body: JSON.parse(Buffer.concat(chunks).toString() || '{}') };
        state.requests.push(record);
        const r = state.reply(record);
        setTimeout(() => {
          res.writeHead(r.status || 200, { 'Content-Type': 'application/json' });
          res.end(typeof r.body === 'string' ? r.body : JSON.stringify(r.body));
        }, r.delayMs || 0);
      });
    });
    server.listen(0, '127.0.0.1', () => {
      state.baseUrl = 'http://127.0.0.1:' + server.address().port + '/compatible-mode/v1';
      state.close = () => new Promise((done) => { server.closeAllConnections(); server.close(done); });
      resolve(state);
    });
  });
}

module.exports = { start: start, completion: completion };
