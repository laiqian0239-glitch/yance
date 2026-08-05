from pathlib import Path
import textwrap

store_path = Path('backend/repositories/storeProvider.js')
source = store_path.read_text(encoding='utf-8')
old = """          const result = Reflect.apply(value, store, args);
          return result === store ? capability : immutableValue(result);
"""
new = """          const result = Reflect.apply(value, store, args);
          if (result && typeof result.then === 'function') {
            return Promise.resolve(result).then(resolved =>
              resolved === store ? capability : immutableValue(resolved)
            );
          }
          return result === store ? capability : immutableValue(result);
"""
assert source.count(old) == 1
source = source.replace(old, new, 1)
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
    return { changes: 1, nested: { status: 'committed' } };
  });

  assert.equal(typeof pending?.then, 'function');
  assert.equal(callbackSettled, false);
  const result = await pending;
  assert.equal(callbackSettled, true);
  assert.deepEqual(result, { changes: 1, nested: { status: 'committed' } });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.nested), true);

  await assert.rejects(
    store.transactionAsync(async () => {
      throw new Error('ASYNC_STORE_CAPABILITY_REJECTION');
    }),
    /ASYNC_STORE_CAPABILITY_REJECTION/u
  );
});
''')
test_path.write_text(test_source, encoding='utf-8')

assert "typeof result.then === 'function'" in source
assert marker in test_source
