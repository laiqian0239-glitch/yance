(function initYanceSecurity(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.YanceSecurity = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createYanceSecurity() {
  'use strict';

  const URL_ATTRIBUTE_NAMES = new Set(['href', 'src', 'poster', 'action', 'formaction']);
  const SAFE_DATA_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp|avif);base64,[a-z0-9+/=\s]+$/i;
  const SAFE_RELATIVE_URL = /^(?:\/|\.\/|\.\.\/|[a-z0-9_~.-]+\/)/i;

  function toText(value, fallback = '') {
    if (value === null || value === undefined) return String(fallback ?? '');
    return String(value);
  }

  function escapeHtmlText(value) {
    return toText(value).replace(/[&<>]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char]));
  }

  function escapeHtmlAttribute(value) {
    return toText(value).replace(/[&<>"'`\u0000-\u001f\u007f]/g, char => {
      const named = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
      return named[char] || `&#${char.charCodeAt(0)};`;
    });
  }

  function sanitizeUrl(value, options = {}) {
    const raw = toText(value).trim();
    if (!raw) return '';
    const {
      allowHttp = true,
      allowHttps = true,
      allowBlob = false,
      allowDataImage = false,
      allowRelative = true,
      allowMailto = false,
      allowTel = false
    } = options;

    if (allowRelative && (raw.startsWith('/') || raw.startsWith('./') || raw.startsWith('../') || SAFE_RELATIVE_URL.test(raw))) {
      return raw.replace(/[\u0000-\u001f\u007f]/g, '');
    }
    if (allowDataImage && SAFE_DATA_IMAGE.test(raw)) return raw.replace(/\s+/g, '');

    let parsed;
    try {
      parsed = new URL(raw, 'https://yance.invalid/');
    } catch (_) {
      return '';
    }
    const protocol = parsed.protocol.toLowerCase();
    if (protocol === 'https:' && allowHttps) return raw;
    if (protocol === 'http:' && allowHttp) return raw;
    if (protocol === 'blob:' && allowBlob) return raw;
    if (protocol === 'mailto:' && allowMailto) return raw;
    if (protocol === 'tel:' && allowTel) return raw;
    return '';
  }

  function escapeUrlAttribute(value, options = {}) {
    return escapeHtmlAttribute(sanitizeUrl(value, options));
  }

  function sanitizeCssNumber(value, options = {}) {
    const { min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY, unit = '' } = options;
    const number = Number(value);
    if (!Number.isFinite(number)) return '';
    const clamped = Math.min(max, Math.max(min, number));
    if (!/^(?:|px|%|rem|em|vh|vw|deg|ms|s)$/.test(unit)) return '';
    return `${clamped}${unit}`;
  }


  function sanitizeCssColor(value) {
    const raw = toText(value).trim();
    if (!raw || raw.length > 96) return '';
    if (/^#[0-9a-f]{3,8}$/i.test(raw)) return raw;
    if (/^(?:rgb|rgba|hsl|hsla)\(\s*[-+0-9.%\s,]+\)$/i.test(raw)) return raw;
    if (/^(?:transparent|currentcolor|black|white)$/i.test(raw)) return raw.toLowerCase();
    return '';
  }

  function setText(node, value, fallback = '') {
    if (!node) return node;
    node.textContent = toText(value, fallback);
    return node;
  }

  function setAttribute(node, name, value) {
    if (!node) return node;
    const normalizedName = toText(name).toLowerCase();
    if (!/^[a-z_:][a-z0-9_.:-]*$/i.test(normalizedName) || normalizedName.startsWith('on')) {
      throw new TypeError(`Unsafe attribute name: ${name}`);
    }
    if (URL_ATTRIBUTE_NAMES.has(normalizedName)) {
      throw new TypeError(`Use setUrlAttribute() for ${normalizedName}`);
    }
    if (normalizedName === 'style') throw new TypeError('Use setStyleNumber() or direct constant style properties');
    node.setAttribute(normalizedName, toText(value));
    return node;
  }

  function setUrlAttribute(node, name, value, options = {}) {
    if (!node) return node;
    const normalizedName = toText(name).toLowerCase();
    if (!URL_ATTRIBUTE_NAMES.has(normalizedName)) throw new TypeError(`Not a URL attribute: ${name}`);
    const safe = sanitizeUrl(value, options);
    if (safe) node.setAttribute(normalizedName, safe);
    else node.removeAttribute(normalizedName);
    return safe;
  }

  function setStyleNumber(node, property, value, options = {}) {
    if (!node || !node.style) return '';
    const normalizedProperty = toText(property);
    if (!/^(?:--[a-z0-9_-]+|[a-z][a-z0-9-]*)$/i.test(normalizedProperty)) throw new TypeError(`Unsafe CSS property: ${property}`);
    const safe = sanitizeCssNumber(value, options);
    if (safe) node.style.setProperty(normalizedProperty, safe);
    else node.style.removeProperty(normalizedProperty);
    return safe;
  }

  function appendChildren(node, children) {
    for (const child of children || []) {
      if (child === null || child === undefined || child === false) continue;
      if (Array.isArray(child)) appendChildren(node, child);
      else if (typeof child === 'string' || typeof child === 'number' || typeof child === 'boolean') node.append(String(child));
      else node.appendChild(child);
    }
    return node;
  }

  function createElement(documentRef, tagName, options = {}) {
    if (!documentRef || typeof documentRef.createElement !== 'function') throw new TypeError('A document implementation is required');
    const tag = toText(tagName).toLowerCase();
    if (!/^[a-z][a-z0-9-]*$/.test(tag)) throw new TypeError(`Unsafe tag name: ${tagName}`);
    const node = documentRef.createElement(tag);
    if (options.className) node.className = toText(options.className);
    if (options.text !== undefined) setText(node, options.text);
    if (options.type !== undefined) setAttribute(node, 'type', options.type);
    if (options.dataset) {
      for (const [key, value] of Object.entries(options.dataset)) {
        if (!/^[a-z][a-z0-9]*$/i.test(key)) throw new TypeError(`Unsafe dataset key: ${key}`);
        node.dataset[key] = toText(value);
      }
    }
    if (options.attributes) {
      for (const [name, value] of Object.entries(options.attributes)) setAttribute(node, name, value);
    }
    if (options.urlAttributes) {
      for (const [name, config] of Object.entries(options.urlAttributes)) {
        const payload = config && typeof config === 'object' && Object.prototype.hasOwnProperty.call(config, 'value') ? config : { value: config };
        setUrlAttribute(node, name, payload.value, payload.options || {});
      }
    }
    appendChildren(node, options.children || []);
    return node;
  }

  function replaceChildren(node, ...children) {
    if (!node) return node;
    node.replaceChildren();
    appendChildren(node, children);
    return node;
  }

  return Object.freeze({
    toText,
    escapeHtmlText,
    escapeHtmlAttribute,
    sanitizeUrl,
    escapeUrlAttribute,
    sanitizeCssNumber,
    sanitizeCssColor,
    setText,
    setAttribute,
    setUrlAttribute,
    setStyleNumber,
    createElement,
    appendChildren,
    replaceChildren
  });
});
