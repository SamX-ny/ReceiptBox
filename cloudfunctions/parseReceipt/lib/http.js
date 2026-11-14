/**
 * 用 Node 内置 http/https 发送 JSON POST 请求（不依赖 fetch，兼容各版本云函数运行环境）。
 * 返回 { status, body }；body 为解析后的 JSON，无法解析时为 { raw: 文本 }。
 * 超时或网络错误时抛出带 code（TIMEOUT / NETWORK）的错误。
 */

const http = require('http');
const https = require('https');

function postJson(url, headers, payload, timeoutMs) {
  return new Promise(function (resolve, reject) {
    let target;
    try {
      target = new URL(url);
    } catch (e) {
      reject(Object.assign(new Error('请求地址无效：' + url), { code: 'CONFIG' }));
      return;
    }
    const data = Buffer.from(JSON.stringify(payload));
    const lib = target.protocol === 'http:' ? http : https;
    const req = lib.request(target, {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json', 'Content-Length': data.length }, headers)
    }, function (res) {
      const chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        const text = Buffer.concat(chunks).toString('utf8');
        let body;
        try {
          body = JSON.parse(text);
        } catch (e) {
          body = { raw: text.slice(0, 500) };
        }
        resolve({ status: res.statusCode, body: body });
      });
      res.on('error', function (err) {
        reject(Object.assign(new Error(err.message), { code: 'NETWORK' }));
      });
    });
    req.setTimeout(timeoutMs, function () {
      req.destroy(Object.assign(new Error('request timeout'), { code: 'TIMEOUT' }));
    });
    req.on('error', function (err) {
      reject(Object.assign(new Error(err.message), { code: err.code === 'TIMEOUT' ? 'TIMEOUT' : 'NETWORK' }));
    });
    req.end(data);
  });
}

module.exports = { postJson: postJson };
