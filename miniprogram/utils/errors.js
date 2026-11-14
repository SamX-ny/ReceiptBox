/**
 * 把 wx.cloud.callFunction 调用失败（云函数没跑起来或中途被终止）的原始错误，
 * 翻译成能直接照着处理的中文提示。原始错误码和信息会附在后面，便于排查。
 *
 * 注意：这里处理的是“调用失败”，云函数正常返回的业务错误（{ ok: false, message }）不经过这里。
 */

const TIMEOUT_SECONDS = { parseReceipt: 60, api: 20 };

function rawText(err) {
  return String((err && (err.errMsg || err.message)) || '');
}

function describeCallError(err, fnName) {
  const text = rawText(err);
  const code = err && err.errCode !== undefined ? String(err.errCode) : '';
  const detail = '（' + (code ? code + ' ' : '') + text.replace(/\s+/g, ' ').slice(0, 120) + '）';

  if (/timed?\s?out|timeout|time limit/i.test(text)) {
    const seconds = TIMEOUT_SECONDS[fnName] || 20;
    return '云函数 ' + fnName + ' 运行超时。请在云开发控制台 → 云函数 → ' + fnName + ' → 函数配置里，把「超时时间」改为 ' + seconds + ' 秒' + detail;
  }
  if (/cannot find module/i.test(text)) {
    return '云函数 ' + fnName + ' 缺少依赖。请在开发者工具里右键该云函数，选「上传并部署：云端安装依赖」重新部署' + detail;
  }
  if (/function\s?name|function not found|FUNCTION_NOT_FOUND|could not be found|not found/i.test(text)) {
    return '云函数 ' + fnName + ' 还没有部署到当前云开发环境。请右键该云函数，选「上传并部署：云端安装依赖」' + detail;
  }
  if (/invalid env|env.*not (exist|found)|-501005/i.test(text) || code === '-501005') {
    return '云开发环境 ID 不正确，请检查 miniprogram/config.js 里的 envId' + detail;
  }
  if (/exceed|quota|limit/i.test(text)) {
    return '云开发资源额度不足或请求过于频繁，请稍后再试' + detail;
  }
  return '云函数 ' + fnName + ' 调用失败' + detail;
}

module.exports = { describeCallError: describeCallError };
