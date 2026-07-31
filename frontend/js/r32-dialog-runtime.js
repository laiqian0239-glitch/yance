(function attachYanceDialogs(root) {
  'use strict';

  let active = null;

  function ensureStyles() {
    if (document.getElementById('yanceDialogRuntimeStyle')) return;
    const style = document.createElement('style');
    style.id = 'yanceDialogRuntimeStyle';
    style.textContent = `
      .yance-dialog-runtime{position:fixed;inset:0;z-index:120000;display:grid;place-items:center;padding:24px;background:var(--overlay-scrim);backdrop-filter:blur(6px)}
      .yance-dialog-runtime[hidden]{display:none}
      .yance-dialog-card{width:min(520px,calc(100vw - 32px));max-height:calc(100vh - 48px);overflow:auto;border:1px solid var(--line);border-radius:18px;background:var(--panel);color:var(--text);box-shadow:var(--overlay-shadow)}
      .yance-dialog-card header{padding:20px 22px 8px}.yance-dialog-card h3{margin:0;font-size:20px}.yance-dialog-card p{margin:8px 0 0;color:var(--muted);line-height:1.6;white-space:pre-wrap}
      .yance-dialog-body{padding:14px 22px}.yance-dialog-body label{display:grid;gap:8px;font-size:13px;color:var(--muted)}
      .yance-dialog-body input,.yance-dialog-body textarea,.yance-dialog-body select{width:100%;box-sizing:border-box;border:1px solid var(--line);border-radius:12px;background:var(--surface);color:var(--text);padding:12px 14px;font:inherit;outline:none}
      .yance-dialog-body textarea{min-height:120px;resize:vertical}.yance-dialog-body input:focus,.yance-dialog-body textarea:focus,.yance-dialog-body select:focus{border-color:var(--accent)}
      .yance-dialog-actions{display:flex;justify-content:flex-end;gap:10px;padding:12px 22px 20px}.yance-dialog-actions button{border:1px solid var(--line);border-radius:11px;background:transparent;color:inherit;padding:10px 18px;font:inherit;cursor:pointer}
      .yance-dialog-actions button[data-primary]{background:var(--accent);color:var(--accent-contrast);border-color:transparent;font-weight:700}.yance-dialog-actions button[data-danger]{background:var(--danger);color:var(--danger-contrast);border-color:transparent}
    `;
    document.head.appendChild(style);
  }

  function close(value) {
    if (!active) return;
    const { overlay, resolve, previousFocus } = active;
    active = null;
    overlay.remove();
    previousFocus?.focus?.();
    resolve(value);
  }

  function appendTextElement(parent, tagName, text, className = '') {
    const node = document.createElement(tagName);
    if (className) node.className = className;
    node.textContent = String(text ?? '');
    parent.appendChild(node);
    return node;
  }

  function open(options = {}) {
    ensureStyles();
    if (active) close(null);
    return new Promise(resolve => {
      const previousFocus = document.activeElement;
      const overlay = document.createElement('div');
      overlay.className = 'yance-dialog-runtime';
      overlay.setAttribute('role', 'presentation');

      const card = document.createElement('section');
      card.className = 'yance-dialog-card';
      card.setAttribute('role', 'dialog');
      card.setAttribute('aria-modal', 'true');

      const header = document.createElement('header');
      appendTextElement(header, 'h3', options.title || '请输入');
      if (options.message) appendTextElement(header, 'p', options.message);
      card.appendChild(header);

      const body = document.createElement('div');
      body.className = 'yance-dialog-body';
      let input = null;
      if (options.kind !== 'confirm') {
        const label = document.createElement('label');
        if (options.label) appendTextElement(label, 'span', options.label);
        input = document.createElement(options.multiline ? 'textarea' : 'input');
        input.dataset.dialogInput = '1';
        if (!options.multiline) input.type = options.secret ? 'password' : 'text';
        input.value = String(options.value ?? '');
        input.placeholder = String(options.placeholder ?? '');
        label.appendChild(input);
        body.appendChild(label);
      }
      card.appendChild(body);

      const footer = document.createElement('footer');
      footer.className = 'yance-dialog-actions';
      const cancel = appendTextElement(footer, 'button', options.cancelLabel || '取消');
      cancel.type = 'button';
      cancel.dataset.cancel = '1';
      const submit = appendTextElement(footer, 'button', options.submitLabel || (options.kind === 'confirm' ? '确认' : '保存'));
      submit.type = 'button';
      submit.dataset.submit = '1';
      if (options.danger) submit.dataset.danger = '1';
      else submit.dataset.primary = '1';
      card.appendChild(footer);

      overlay.appendChild(card);
      document.body.appendChild(overlay);
      active = { overlay, resolve, previousFocus };
      const submitValue = () => close(options.kind === 'confirm' ? true : String(input?.value ?? ''));
      submit.addEventListener('click', submitValue);
      cancel.addEventListener('click', () => close(options.kind === 'confirm' ? false : null));
      overlay.addEventListener('mousedown', event => { if (event.target === overlay) close(options.kind === 'confirm' ? false : null); });
      card.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); close(options.kind === 'confirm' ? false : null); }
        if (event.key === 'Enter' && !options.multiline && !event.shiftKey) { event.preventDefault(); submitValue(); }
      });
      requestAnimationFrame(() => (input || submit).focus());
    });
  }

  root.YanceDialogs = Object.freeze({
    prompt: options => open({ ...options, kind: 'prompt' }),
    confirm: options => open({ ...options, kind: 'confirm' }),
    close
  });
})(typeof window !== 'undefined' ? window : globalThis);
