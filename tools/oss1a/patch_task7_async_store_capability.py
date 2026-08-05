from pathlib import Path
import textwrap

store_path = Path('backend/repositories/storeProvider.js')
source = store_path.read_text(encoding='utf-8')

old_immutable = """function immutableValue(value) {
  if (value == null || typeof value !== 'object') return value;
  try { return Object.freeze(JSON.parse(JSON.stringify(value))); }
  catch (_) { return value; }
}
"""
new_immutable = """function immutableValue(value) {
  if (value == null || typeof value !== 'object') return value;
  try { return Object.freeze(JSON.parse(JSON.stringify(value))); }
  catch (_) { return value; }
}

function deepFreeze(value) {
  if (value == null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function immutableAsyncValue(value) {
  if (value == null || typeof value !== 'object') return value;
  try { return deepFreeze(JSON.parse(JSON.stringify(value))); }
  catch (_) { return value; }
}
"""
assert source.count(old_immutable) == 1
source = source.replace(old_immutable, new_immutable, 1)

old_wrapper = """        const result = Reflect.apply(value, store, args);
        return result === store ? capability : immutableValue(result);
"""
new_wrapper = """        const result = Reflect.apply(value, store, args);
        if (result && typeof result.then === 'function') {
          return Promise.resolve(result).then(resolved =>
            resolved === store ? capability : immutableAsyncValue(resolved)
          );
        }
        return result === store ? capability : immutableValue(result);
"""
assert source.count(old_wrapper) == 1
source = source.replace(old_wrapper, new_wrapper, 1)
store_path.write_text(source, encoding='utf-8')

test_path = Path('backend/tests/accountLifecycleRegression.test.js')
test_source = test_path.read_text(encoding='utf-8')
marker = "primary store capability preserves Promise settlement and immutable resolved values"
assert marker not in test_source
test_source += textwrap.dedent(r'''


test('primary store capability preserves Promise settlement and immutable resolved values', async () => {
  const store = getStore();
  let callbackSettled = false;
  const pending = store.transactionAsync(async tx => {
    assert.ok(tx);
    await Promise.resolve();
    callbackSettled = true;
    return { changes: 1, nested: { status: 'committed' }, items: [{ id: 1 }] };
  });

  assert.equal(typeof pending?.then, 'function');
  assert.equal(callbackSettled, false);
  const result = await pending;
  assert.equal(callbackSettled, true);
  assert.deepEqual(result, {
    changes: 1,
    nested: { status: 'committed' },
    items: [{ id: 1 }]
  });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.nested), true);
  assert.equal(Object.isFrozen(result.items), true);
  assert.equal(Object.isFrozen(result.items[0]), true);
  assert.throws(() => { result.nested.status = 'mutated'; }, TypeError);

  await assert.rejects(
    store.transactionAsync(async () => {
      throw new Error('ASYNC_STORE_CAPABILITY_REJECTION');
    }),
    /ASYNC_STORE_CAPABILITY_REJECTION/u
  );
});
''')
test_path.write_text(test_source, encoding='utf-8')

assert "function immutableAsyncValue(value)" in source
assert "immutableAsyncValue(resolved)" in source
assert marker in test_source
