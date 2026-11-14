const test = require('node:test');
const assert = require('node:assert/strict');
const { describeCallError } = require('../miniprogram/utils/errors');

test('云函数调用失败的原因翻译', () => {
  const timeout = describeCallError({ errCode: -504003, errMsg: 'cloud.callFunction:fail Error: errCode: -504003  | errMsg: Invoking task timed out after 3 seconds' }, 'parseReceipt');
  assert.match(timeout, /运行超时/);
  assert.match(timeout, /改为 60 秒/);
  assert.match(timeout, /-504003/);
  assert.match(describeCallError({ errMsg: 'request:fail timeout' }, 'api'), /改为 20 秒/);

  assert.match(describeCallError({ errCode: -504002, errMsg: "cloud.callFunction:fail errMsg: Cannot find module 'wx-server-sdk'" }, 'parseReceipt'), /缺少依赖/);
  assert.match(describeCallError({ errCode: -501000, errMsg: 'cloud.callFunction:fail FunctionName parameter could not be found' }, 'parseReceipt'), /还没有部署/);
  assert.match(describeCallError({ errCode: -501005, errMsg: 'cloud.callFunction:fail invalid env' }, 'api'), /envId/);

  const unknown = describeCallError({ errCode: -1, errMsg: 'cloud.callFunction:fail something odd' }, 'parseReceipt');
  assert.match(unknown, /云函数 parseReceipt 调用失败/);
  assert.match(unknown, /something odd/);
  assert.match(describeCallError(undefined, 'api'), /调用失败/);
});
