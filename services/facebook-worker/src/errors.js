import { clean } from './utils.js';

export class GatewayError extends Error {
  constructor(code, message, status = 400, details = {}) {
    super(message);
    this.name = 'GatewayError';
    this.code = clean(code, 'FACEBOOK_GATEWAY_ERROR');
    this.status = Number(status || 400);
    this.details = details && typeof details === 'object' ? details : {};
  }
}

export function invariant(condition, code, message, status = 400, details = {}) {
  if (!condition) throw new GatewayError(code, message, status, details);
}

const META_CODES = Object.freeze({
  10: 'FACEBOOK_PERMISSION_REVOKED',
  100: 'FACEBOOK_REQUEST_INVALID',
  190: 'FACEBOOK_TOKEN_EXPIRED',
  200: 'FACEBOOK_PERMISSION_REVOKED',
  551: 'FACEBOOK_RECIPIENT_UNAVAILABLE',
  613: 'FACEBOOK_RATE_LIMITED'
});

export function mapMetaError(payload = {}, status = 502) {
  const source = payload?.error || payload || {};
  const codeNumber = Number(source.code || 0);
  const subcode = Number(source.error_subcode || 0);
  const sourceMessage = clean(source.message);
  let code = META_CODES[codeNumber] || (status >= 500 ? 'FACEBOOK_META_TEMPORARY' : 'FACEBOOK_META_REQUEST_FAILED');
  const messageText = sourceMessage.toLowerCase();
  if (messageText.includes('24') && messageText.includes('hour')) code = 'FACEBOOK_24H_WINDOW_CLOSED';
  if (messageText.includes('attachment') || messageText.includes('mime')) code = 'FACEBOOK_MEDIA_UNSUPPORTED';
  if (subcode === 2018001 || subcode === 2018336) code = 'FACEBOOK_24H_WINDOW_CLOSED';
  let metaReason = '';
  if (messageText.includes('nonexisting field') || messageText.includes('unknown field')) metaReason = 'invalid_field';
  else if (messageText.includes('unsupported get request')) metaReason = 'unsupported_get';
  else if (messageText.includes('missing permission') || messageText.includes('requires the')) metaReason = 'missing_permission';
  else if (messageText.includes('does not exist') || messageText.includes('cannot be loaded')) metaReason = 'object_unavailable';
  else if (messageText.includes('invalid parameter')) metaReason = 'invalid_parameter';
  const userMessage = ({
    FACEBOOK_PERMISSION_REVOKED: 'Facebook 公共主页权限已撤销，请重新授权',
    FACEBOOK_TOKEN_EXPIRED: 'Facebook 授权已失效，请重新授权',
    FACEBOOK_RATE_LIMITED: 'Facebook 暂时限制请求，请稍后重试',
    FACEBOOK_24H_WINDOW_CLOSED: '当前会话已超出 Facebook 标准回复窗口',
    FACEBOOK_MEDIA_UNSUPPORTED: 'Facebook 不支持此附件类型',
    FACEBOOK_RECIPIENT_UNAVAILABLE: '该 Facebook 联系人当前无法接收消息',
    FACEBOOK_META_TEMPORARY: 'Facebook 服务暂时不可用，请稍后重试',
    FACEBOOK_REQUEST_INVALID: 'Facebook 消息请求无效'
  })[code] || 'Facebook 请求未完成';
  return new GatewayError(code, userMessage, code === 'FACEBOOK_META_TEMPORARY' ? 503 : 409, {
    metaCode: codeNumber || undefined,
    metaSubcode: subcode || undefined,
    metaReason: metaReason || undefined,
    retryable: status >= 500 || code === 'FACEBOOK_RATE_LIMITED'
  });
}

export function publicError(error) {
  if (error instanceof GatewayError) return error;
  return new GatewayError('FACEBOOK_GATEWAY_INTERNAL', 'Facebook 云端服务暂时不可用', 500);
}
