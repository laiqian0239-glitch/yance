from pathlib import Path

path = Path('backend/tests/whatsappQrChallenge.test.js')
source = path.read_text(encoding='utf-8')

import_marker = "const messageStore = require('../services/messageStore');\n"
import_replacement = import_marker + "const accountLifecycleSaga = require('../services/accountLifecycleSagaService').singleton;\n"
assert source.count(import_marker) == 1
source = source.replace(import_marker, import_replacement, 1)

fixture_marker = "  patch(messageStore, 'listConversations', () => []);\n"
fixture_replacement = fixture_marker + "  patch(accountLifecycleSaga, 'latest', () => null);\n"
assert source.count(fixture_marker) == 2
source = source.replace(fixture_marker, fixture_replacement, 2)

old_assertion = "  assert.match(adapter, /!row\\.startupTimedOut/);\n"
new_assertions = (
    "  assert.match(adapter, /startupTimedOut: row\\.startupTimedOut/);\n"
    "  assert.match(adapter, /if \\(!policy\\.autoReconnect\\) return;/);\n"
    "  assert.match(adapter, /shouldExecuteReconnect/);\n"
)
assert source.count(old_assertion) == 1
source = source.replace(old_assertion, new_assertions, 1)

path.write_text(source, encoding='utf-8')
