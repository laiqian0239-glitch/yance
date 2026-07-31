'use strict';

class FakeNode {
  constructor(tagName = '#text', text = '') {
    this.tagName = tagName.toLowerCase();
    this.nodeType = this.tagName === '#text' ? 3 : 1;
    this.children = [];
    this.attributes = new Map();
    this.dataset = {};
    this.className = '';
    this._text = this.nodeType === 3 ? String(text) : '';
    this.parentNode = null;
    this.value = '';
    this.selected = false;
  }

  set textContent(value) {
    this._text = String(value ?? '');
    if (this.nodeType === 1) this.children = [];
  }

  get textContent() {
    if (this.nodeType === 3) return this._text;
    return this._text + this.children.map(child => child.textContent).join('');
  }

  append(...items) {
    for (const item of items) {
      if (item === null || item === undefined) continue;
      this.appendChild(item instanceof FakeNode ? item : new FakeNode('#text', String(item)));
    }
  }

  appendChild(child) {
    if (!(child instanceof FakeNode)) throw new TypeError('Fake DOM only accepts FakeNode children');
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  replaceChildren(...items) {
    this.children = [];
    this._text = '';
    this.append(...items);
  }

  setAttribute(name, value) {
    this.attributes.set(String(name).toLowerCase(), String(value));
  }

  removeAttribute(name) {
    this.attributes.delete(String(name).toLowerCase());
  }
}

class FakeDocument {
  createElement(tagName) { return new FakeNode(tagName); }
  createTextNode(text) { return new FakeNode('#text', text); }
}

function walk(node, output = []) {
  output.push(node);
  for (const child of node.children || []) walk(child, output);
  return output;
}

function effectiveAttributes(node) {
  const result = new Map(node.attributes || []);
  if (node.className) result.set('class', node.className);
  for (const [key, value] of Object.entries(node.dataset || {})) {
    const dataName = key.replace(/[A-Z]/g, match => `-${match.toLowerCase()}`);
    result.set(`data-${dataName}`, String(value));
  }
  return result;
}

module.exports = { FakeNode, FakeDocument, walk, effectiveAttributes };
