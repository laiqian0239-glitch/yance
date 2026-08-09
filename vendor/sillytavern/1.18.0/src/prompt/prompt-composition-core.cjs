'use strict';

/*
 * SillyTavern 1.18.0 source-derived prompt composition core.
 * Upstream: https://github.com/SillyTavern/SillyTavern
 * Commit: 51ad27fb86d39a3daca3adaa970375c9670c12df
 * License: AGPL-3.0
 *
 * Mechanical adaptation only: ESM exports are converted to CommonJS exports and
 * references to SillyTavern global/UI services are supplied as lexical inputs.
 */

// SILLYTAVERN_SLICE::PromptManager::injection-position
const DEFAULT_DEPTH = 4;
const DEFAULT_ORDER = 100;
const INJECTION_POSITION = {
    RELATIVE: 0,
    ABSOLUTE: 1,
};
// END_SILLYTAVERN_SLICE::PromptManager::injection-position

class Prompt {
    // SILLYTAVERN_SLICE::PromptManager::prompt-constructor
    constructor({ identifier, role, content, name, system_prompt, position, injection_depth, injection_position, forbid_overrides, extension, injection_order, injection_trigger } = {}) {
        this.identifier = identifier;
        this.role = role;
        this.content = content;
        this.name = name;
        this.system_prompt = system_prompt;
        this.position = position;
        this.injection_depth = injection_depth;
        this.injection_position = injection_position;
        this.forbid_overrides = forbid_overrides;
        this.extension = extension ?? false;
        this.injection_order = injection_order ?? DEFAULT_ORDER;
        this.injection_trigger = injection_trigger ?? [];
    }
    // END_SILLYTAVERN_SLICE::PromptManager::prompt-constructor
}

// SILLYTAVERN_SLICE::PromptManager::prompt-collection
class PromptCollection {
    collection = [];
    overriddenPrompts = [];

    constructor(...prompts) {
        this.add(...prompts);
    }

    checkPromptInstance(...prompts) {
        for (let prompt of prompts) {
            if (!(prompt instanceof Prompt)) {
                throw new Error('Only Prompt instances can be added to PromptCollection');
            }
        }
    }

    add(...prompts) {
        this.checkPromptInstance(...prompts);
        this.collection.push(...prompts);
    }

    set(prompt, position) {
        this.checkPromptInstance(prompt);
        this.collection[position] = prompt;
    }

    get(identifier) {
        return this.collection.find(prompt => prompt.identifier === identifier);
    }

    index(identifier) {
        return this.collection.findIndex(prompt => prompt.identifier === identifier);
    }

    has(identifier) {
        return this.index(identifier) !== -1;
    }

    override(prompt, position) {
        this.set(prompt, position);
        this.overriddenPrompts.push(prompt.identifier);
    }
}
// END_SILLYTAVERN_SLICE::PromptManager::prompt-collection

// SILLYTAVERN_SLICE::PromptManager::prepare-prompt
function preparePrompt(prompt, original = null, bindings = {}) {
    const groupMembers = typeof bindings.getActiveGroupCharacters === 'function' ? bindings.getActiveGroupCharacters() : [];
    const substituteParams = typeof bindings.substituteParams === 'function' ? bindings.substituteParams : (value => value ?? '');
    const preparedPrompt = new Prompt(prompt);

    if (typeof original === 'string') {
        if (0 < groupMembers.length) preparedPrompt.content = substituteParams(prompt.content ?? '', { original, groupOverride: groupMembers.join(', ') });
        else preparedPrompt.content = substituteParams(prompt.content, { original });
    } else {
        if (0 < groupMembers.length) preparedPrompt.content = substituteParams(prompt.content ?? '', { groupOverride: groupMembers.join(', ') });
        else preparedPrompt.content = substituteParams(prompt.content);
    }

    return preparedPrompt;
}
// END_SILLYTAVERN_SLICE::PromptManager::prepare-prompt

// SILLYTAVERN_SLICE::PromptManager::collection-order
function shouldTrigger(prompt, generationType) {
    if (!Array.isArray(prompt?.injection_trigger)) return true;
    if (!prompt.injection_trigger.length) return true;
    return prompt.injection_trigger.includes(generationType);
}

function getPromptCollection({ generationType, promptOrder, getPromptById, prepare = prompt => new Prompt(prompt) } = {}) {
    generationType = String(generationType || 'normal').toLowerCase().trim();
    const promptCollection = new PromptCollection();
    (Array.isArray(promptOrder) ? promptOrder : []).forEach(entry => {
        const prompt = typeof getPromptById === 'function' ? getPromptById(entry.identifier) : null;
        const allowedTrigger = entry.enabled && shouldTrigger(prompt, generationType);
        if (!prompt) return;
        if (allowedTrigger) promptCollection.add(prepare(prompt));
        else if (entry.identifier === 'main') {
            const replacementPrompt = structuredClone(prompt);
            replacementPrompt.content = '';
            promptCollection.add(prepare(replacementPrompt));
        }
    });
    return promptCollection;
}
// END_SILLYTAVERN_SLICE::PromptManager::collection-order

// SILLYTAVERN_SLICE::PromptManager::default-order
const promptManagerDefaultPromptOrder = [
    { 'identifier': 'main', 'enabled': true },
    { 'identifier': 'worldInfoBefore', 'enabled': true },
    { 'identifier': 'personaDescription', 'enabled': true },
    { 'identifier': 'charDescription', 'enabled': true },
    { 'identifier': 'charPersonality', 'enabled': true },
    { 'identifier': 'scenario', 'enabled': true },
    { 'identifier': 'enhanceDefinitions', 'enabled': false },
    { 'identifier': 'nsfw', 'enabled': true },
    { 'identifier': 'worldInfoAfter', 'enabled': true },
    { 'identifier': 'dialogueExamples', 'enabled': true },
    { 'identifier': 'chatHistory', 'enabled': true },
    { 'identifier': 'jailbreak', 'enabled': true },
];
// END_SILLYTAVERN_SLICE::PromptManager::default-order

function createExampleDialogueRuntime(bindings = {}) {
    const getGroupNames = typeof bindings.getGroupNames === 'function' ? bindings.getGroupNames : (() => []);
    const name1 = String(bindings.name1 ?? '{{user}}');
    const name2 = String(bindings.name2 ?? '{{char}}');
    const selected_group = bindings.selected_group || null;

    // SILLYTAVERN_SLICE::openai::example-dialogue-parser
    function parseExampleIntoIndividual(messageExampleString, appendNamesForGroup = true) {
        const groupBotNames = getGroupNames().map(name => `${name}:`);
        let result = [];
        let tmp = messageExampleString.split('\n');
        let cur_msg_lines = [];
        let in_user = false;
        let in_bot = false;
        let botName = name2;

        function add_msg(name, role, system_name) {
            let parsed_msg = cur_msg_lines.join('\n').replace(name + ':', '').trim();
            if (appendNamesForGroup && selected_group && ['example_user', 'example_assistant'].includes(system_name)) {
                parsed_msg = `${name}: ${parsed_msg}`;
            }
            result.push({ 'role': role, 'content': parsed_msg, 'name': system_name });
            cur_msg_lines = [];
        }
        for (let i = 1; i < tmp.length; i++) {
            let cur_str = tmp[i];
            if (cur_str.startsWith(name1 + ':')) {
                in_user = true;
                if (in_bot) {
                    add_msg(botName, 'system', 'example_assistant');
                }
                in_bot = false;
            } else if (cur_str.startsWith(name2 + ':') || groupBotNames.some(n => cur_str.startsWith(n))) {
                if (!cur_str.startsWith(name2 + ':') && groupBotNames.length) {
                    botName = cur_str.split(':')[0];
                }
                in_bot = true;
                if (in_user) {
                    add_msg(name1, 'system', 'example_user');
                }
                in_user = false;
            }
            cur_msg_lines.push(cur_str);
        }
        if (in_user) {
            add_msg(name1, 'system', 'example_user');
        } else if (in_bot) {
            add_msg(botName, 'system', 'example_assistant');
        }
        return result;
    }
    // END_SILLYTAVERN_SLICE::openai::example-dialogue-parser

    // SILLYTAVERN_SLICE::openai::example-blocks
    function setOpenAIMessageExamples(mesExamplesArray) {
        const examples = [];
        for (let item of mesExamplesArray) {
            let replaced = item.replace(/<START>/i, '{Example Dialogue:}').replace(/\r/gm, '');
            let parsed = parseExampleIntoIndividual(replaced, true);
            examples.push(parsed);
        }
        return examples;
    }
    // END_SILLYTAVERN_SLICE::openai::example-blocks

    return { parseExampleIntoIndividual, setOpenAIMessageExamples };
}

// SILLYTAVERN_SLICE::openai::depth-order-role-injection
function createPopulationInjectionPrompts(bindings = {}) {
    const extension_prompt_roles = bindings.extension_prompt_roles || { SYSTEM: 0, USER: 1, ASSISTANT: 2 };
    const getExtensionPromptMaxDepth = typeof bindings.getExtensionPromptMaxDepth === 'function' ? bindings.getExtensionPromptMaxDepth : (() => 100);
    const getExtensionPrompt = typeof bindings.getExtensionPrompt === 'function' ? bindings.getExtensionPrompt : (async () => '');
    const extension_prompt_types = bindings.extension_prompt_types || { IN_CHAT: 1 };

    return async function populationInjectionPrompts(prompts, messages) {
        let totalInsertedMessages = 0;
        const roleTypes = {
            'system': extension_prompt_roles.SYSTEM,
            'user': extension_prompt_roles.USER,
            'assistant': extension_prompt_roles.ASSISTANT,
        };

        const maxDepth = getExtensionPromptMaxDepth();
        for (let i = 0; i <= maxDepth; i++) {
            const depthPrompts = prompts.filter(prompt => prompt.injection_depth === i && prompt.content);
            const roleMessages = [];
            const separator = '\n';
            const wrap = false;
            const extensionPromptsOrder = '100';
            const orderGroups = { [extensionPromptsOrder]: [] };
            for (const prompt of depthPrompts) {
                const order = prompt.injection_order ?? 100;
                if (!orderGroups[order]) {
                    orderGroups[order] = [];
                }
                orderGroups[order].push(prompt);
            }
            const orders = Object.keys(orderGroups).sort((a, b) => +b - +a);
            for (const order of orders) {
                const orderPrompts = orderGroups[order];
                const roles = ['system', 'user', 'assistant'];
                for (const role of roles) {
                    const rolePrompts = orderPrompts.filter(prompt => prompt.role === role).map(x => x.content).join(separator);
                    const extensionPrompt = order === extensionPromptsOrder
                        ? await getExtensionPrompt(extension_prompt_types.IN_CHAT, i, separator, roleTypes[role], wrap)
                        : '';
                    const jointPrompt = [rolePrompts, extensionPrompt].filter(x => x).map(x => x.trim()).join(separator);
                    if (jointPrompt && jointPrompt.length) roleMessages.push({ role, content: jointPrompt, injected: true });
                }
            }
            if (roleMessages.length) {
                const injectIdx = i + totalInsertedMessages;
                messages.splice(injectIdx, 0, ...roleMessages);
                totalInsertedMessages += roleMessages.length;
            }
        }
        messages = messages.reverse();
        return messages;
    };
}
// END_SILLYTAVERN_SLICE::openai::depth-order-role-injection

// SILLYTAVERN_SLICE::personas::description-placement
const persona_description_positions = {
    IN_PROMPT: 0,
    AFTER_CHAR: 1,
    TOP_AN: 2,
    BOTTOM_AN: 3,
    AT_DEPTH: 4,
    NONE: 9,
};
const PERSONA_DEFAULT_DEPTH = 2;
const PERSONA_DEFAULT_ROLE = 0;
// END_SILLYTAVERN_SLICE::personas::description-placement

// SILLYTAVERN_SLICE::authors-note::metadata-placement
const metadata_keys = {
    prompt: 'note_prompt',
    interval: 'note_interval',
    depth: 'note_depth',
    position: 'note_position',
    role: 'note_role',
};
const chara_note_position = {
    replace: 0,
    before: 1,
    after: 2,
};
// END_SILLYTAVERN_SLICE::authors-note::metadata-placement

// SILLYTAVERN_SLICE::authors-note::depth-role-injection
function createFloatingPromptRuntime(bindings = {}) {
    const getContext = typeof bindings.getContext === 'function' ? bindings.getContext : (() => ({}));
    const chat_metadata = bindings.chat_metadata || {};
    const extension_settings = {
        ...(bindings.extension_settings || {}),
        note: {
            ...(bindings.extension_settings?.note || {}),
            chara: Array.isArray(bindings.extension_settings?.note?.chara) ? bindings.extension_settings.note.chara : [],
            allowWIScan: Boolean(bindings.extension_settings?.note?.allowWIScan),
        },
    };
    const $ = typeof bindings.$ === 'function' ? bindings.$ : (() => ({ val: () => '', text: () => undefined }));
    const extension_prompt_types = bindings.extension_prompt_types || { NONE: 0 };
    const MODULE_NAME = String(bindings.MODULE_NAME || '2_floating_prompt');
    const MAX_INJECTION_DEPTH = Number(bindings.MAX_INJECTION_DEPTH ?? 100);
    const getCharaFilename = typeof bindings.getCharaFilename === 'function' ? bindings.getCharaFilename : (() => '');
    const console = bindings.console || globalThis.console;
    let shouldWIAddPrompt = Boolean(bindings.shouldWIAddPrompt);

function setFloatingPrompt() {
    const context = getContext();
    if (!context.groupId && context.characterId === undefined) {
        console.debug('setFloatingPrompt: Not in a chat. Skipping.');
        shouldWIAddPrompt = false;
        return;
    }

    // take the count of messages
    let lastMessageNumber = Array.isArray(context.chat) && context.chat.length ? context.chat.filter(m => m.is_user).length : 0;

    console.debug(`
    setFloatingPrompt entered
    ------
    lastMessageNumber = ${lastMessageNumber}
    metadata_keys.interval = ${chat_metadata[metadata_keys.interval]}
    metadata_keys.position = ${chat_metadata[metadata_keys.position]}
    metadata_keys.depth = ${chat_metadata[metadata_keys.depth]}
    metadata_keys.role = ${chat_metadata[metadata_keys.role]}
    ------
    `);

    // interval 1 should be inserted no matter what
    if (chat_metadata[metadata_keys.interval] === 1) {
        lastMessageNumber = 1;
    }

    if (lastMessageNumber <= 0 || chat_metadata[metadata_keys.interval] <= 0) {
        context.setExtensionPrompt(MODULE_NAME, '', extension_prompt_types.NONE, MAX_INJECTION_DEPTH);
        $('#extension_floating_counter').text('(disabled)');
        shouldWIAddPrompt = false;
        return;
    }

    const messagesTillInsertion = lastMessageNumber >= chat_metadata[metadata_keys.interval]
        ? (lastMessageNumber % chat_metadata[metadata_keys.interval])
        : (chat_metadata[metadata_keys.interval] - lastMessageNumber);
    const shouldAddPrompt = messagesTillInsertion == 0;
    shouldWIAddPrompt = shouldAddPrompt;

    let prompt = shouldAddPrompt ? $('#extension_floating_prompt').val() : '';
    if (shouldAddPrompt && extension_settings.note.chara && getContext().characterId !== undefined) {
        const charaNote = extension_settings.note.chara.find((e) => e.name === getCharaFilename());

        // Only replace with the chara note if the user checked the box
        if (charaNote && charaNote.useChara) {
            switch (charaNote.position) {
                case chara_note_position.before:
                    prompt = charaNote.prompt + '\n' + prompt;
                    break;
                case chara_note_position.after:
                    prompt = prompt + '\n' + charaNote.prompt;
                    break;
                default:
                    prompt = charaNote.prompt;
                    break;
            }
        }
    }
    context.setExtensionPrompt(
        MODULE_NAME,
        String(prompt),
        chat_metadata[metadata_keys.position],
        chat_metadata[metadata_keys.depth],
        extension_settings.note.allowWIScan,
        chat_metadata[metadata_keys.role],
    );
    $('#extension_floating_counter').text(shouldAddPrompt ? '0' : messagesTillInsertion);
}

    return {
        setFloatingPrompt,
        getShouldWIAddPrompt: () => shouldWIAddPrompt,
    };
}
// END_SILLYTAVERN_SLICE::authors-note::depth-role-injection

// SILLYTAVERN_SLICE::world-info::selective-logic
const world_info_logic = {
    AND_ANY: 0,
    NOT_ALL: 1,
    NOT_ANY: 2,
    AND_ALL: 3,
};
// END_SILLYTAVERN_SLICE::world-info::selective-logic

// SILLYTAVERN_SLICE::world-info::placement
const world_info_position = {
    before: 0,
    after: 1,
    ANTop: 2,
    ANBottom: 3,
    atDepth: 4,
    EMTop: 5,
    EMBottom: 6,
    outlet: 7,
};
const wi_anchor_position = { before: 0, after: 1 };
// END_SILLYTAVERN_SLICE::world-info::placement

// SILLYTAVERN_SLICE::world-info::regex-parser
function parseRegexFromString(input) {
    let match = input.match(/^\/([\w\W]+?)\/([gimsuy]*)$/);
    if (!match) {
        return null;
    }
    let [, pattern, flags] = match;
    if (pattern.match(/(^|[^\\])\//)) {
        return null;
    }
    pattern = pattern.replace('\\/', '/');
    try {
        return new RegExp(pattern, flags);
    } catch (e) {
        return null;
    }
}
// END_SILLYTAVERN_SLICE::world-info::regex-parser

function escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// SILLYTAVERN_SLICE::world-info::match-keys
function matchKeys(haystack, needle, entry = {}, bindings = {}) {
    const world_info_case_sensitive = bindings.world_info_case_sensitive ?? false;
    const world_info_match_whole_words = bindings.world_info_match_whole_words ?? false;
    const transformString = (str, row) => {
        const caseSensitive = row.caseSensitive ?? world_info_case_sensitive;
        return caseSensitive ? str : str.toLowerCase();
    };
    const keyRegex = parseRegexFromString(needle);
    if (keyRegex) {
        return keyRegex.test(haystack);
    }
    haystack = transformString(haystack, entry);
    const transformedString = transformString(needle, entry);
    const matchWholeWords = entry.matchWholeWords ?? world_info_match_whole_words;
    if (matchWholeWords) {
        const keyWords = transformedString.split(/\s+/);
        if (keyWords.length > 1) {
            return haystack.includes(transformedString);
        } else {
            const regex = new RegExp(`(?:^|\\W)(${escapeRegex(transformedString)})(?:$|\\W)`);
            if (regex.test(haystack)) {
                return true;
            }
        }
    } else {
        return haystack.includes(transformedString);
    }
    return false;
}
// END_SILLYTAVERN_SLICE::world-info::match-keys

const WORLD_INFO_DEFAULT_DEPTH = 4;
const DEFAULT_WEIGHT = 100;
const GENERATION_TYPE_TRIGGERS = Object.freeze(['normal', 'continue', 'impersonate', 'regenerate', 'swipe', 'quiet']);

// SILLYTAVERN_SLICE::world-info::entry-schema
const newWorldInfoEntryDefinition = {
    key: { default: [], type: 'array' }, keysecondary: { default: [], type: 'array' }, comment: { default: '', type: 'string' },
    content: { default: '', type: 'string' }, constant: { default: false, type: 'boolean' }, vectorized: { default: false, type: 'boolean' },
    selective: { default: true, type: 'boolean' }, selectiveLogic: { default: world_info_logic.AND_ANY, type: 'enum' }, addMemo: { default: false, type: 'boolean' },
    order: { default: 100, type: 'number' }, position: { default: 0, type: 'number' }, disable: { default: false, type: 'boolean' }, ignoreBudget: { default: false, type: 'boolean' },
    excludeRecursion: { default: false, type: 'boolean' }, preventRecursion: { default: false, type: 'boolean' }, matchPersonaDescription: { default: false, type: 'boolean' },
    matchCharacterDescription: { default: false, type: 'boolean' }, matchCharacterPersonality: { default: false, type: 'boolean' }, matchCharacterDepthPrompt: { default: false, type: 'boolean' },
    matchScenario: { default: false, type: 'boolean' }, matchCreatorNotes: { default: false, type: 'boolean' }, delayUntilRecursion: { default: 0, type: 'number' },
    probability: { default: 100, type: 'number' }, useProbability: { default: true, type: 'boolean' }, depth: { default: WORLD_INFO_DEFAULT_DEPTH, type: 'number' },
    outletName: { default: '', type: 'string' }, group: { default: '', type: 'string' }, groupOverride: { default: false, type: 'boolean' }, groupWeight: { default: DEFAULT_WEIGHT, type: 'number' },
    scanDepth: { default: null, type: 'number?' }, caseSensitive: { default: null, type: 'boolean?' }, matchWholeWords: { default: null, type: 'boolean?' }, useGroupScoring: { default: null, type: 'boolean?' },
    automationId: { default: '', type: 'string' }, role: { default: 0, type: 'enum' }, sticky: { default: null, type: 'number?' }, cooldown: { default: null, type: 'number?' }, delay: { default: null, type: 'number?' },
    characterFilterNames: { default: [], type: 'array', excludeFromTemplate: true }, characterFilterTags: { default: [], type: 'array', excludeFromTemplate: true },
    characterFilterExclude: { default: false, type: 'boolean', excludeFromTemplate: true }, triggers: { default: [], type: 'array', arrayFilter: (value) => GENERATION_TYPE_TRIGGERS.includes(value) },
};
const newWorldInfoEntryTemplate = Object.fromEntries(
    Object.entries(newWorldInfoEntryDefinition).filter(([_, value]) => !value.excludeFromTemplate).map(([key, value]) => [key, value.default]),
);
// END_SILLYTAVERN_SLICE::world-info::entry-schema

// SILLYTAVERN_SLICE::world-info::character-book-conversion
function convertCharacterBook(characterBook, bindings = {}) {
    const extension_prompt_roles = bindings.extension_prompt_roles || { SYSTEM: 0 };
    const result = { entries: {}, originalData: characterBook };
    characterBook.entries.forEach((entry, index) => {
        if (entry.id === undefined) {
            entry.id = index;
        }
        result.entries[entry.id] = {
            ...newWorldInfoEntryTemplate,
            uid: entry.id,
            key: entry.keys,
            keysecondary: entry.secondary_keys || [],
            comment: entry.comment || '',
            content: entry.content,
            constant: entry.constant || false,
            selective: entry.selective || false,
            order: entry.insertion_order,
            position: entry.extensions?.position ?? (entry.position === 'before_char' ? world_info_position.before : world_info_position.after),
            excludeRecursion: entry.extensions?.exclude_recursion ?? false,
            preventRecursion: entry.extensions?.prevent_recursion ?? false,
            delayUntilRecursion: entry.extensions?.delay_until_recursion ?? false,
            disable: !entry.enabled,
            addMemo: !!entry.comment,
            displayIndex: entry.extensions?.display_index ?? index,
            probability: entry.extensions?.probability ?? 100,
            useProbability: entry.extensions?.useProbability ?? true,
            depth: entry.extensions?.depth ?? WORLD_INFO_DEFAULT_DEPTH,
            selectiveLogic: entry.extensions?.selectiveLogic ?? world_info_logic.AND_ANY,
            outletName: entry.extensions?.outlet_name ?? '', group: entry.extensions?.group ?? '', groupOverride: entry.extensions?.group_override ?? false,
            groupWeight: entry.extensions?.group_weight ?? DEFAULT_WEIGHT, scanDepth: entry.extensions?.scan_depth ?? null, caseSensitive: entry.extensions?.case_sensitive ?? null,
            matchWholeWords: entry.extensions?.match_whole_words ?? null, useGroupScoring: entry.extensions?.use_group_scoring ?? null, automationId: entry.extensions?.automation_id ?? '',
            role: entry.extensions?.role ?? extension_prompt_roles.SYSTEM, vectorized: entry.extensions?.vectorized ?? false, sticky: entry.extensions?.sticky ?? null,
            cooldown: entry.extensions?.cooldown ?? null, delay: entry.extensions?.delay ?? null, matchPersonaDescription: entry.extensions?.match_persona_description ?? false,
            matchCharacterDescription: entry.extensions?.match_character_description ?? false, matchCharacterPersonality: entry.extensions?.match_character_personality ?? false,
            matchCharacterDepthPrompt: entry.extensions?.match_character_depth_prompt ?? false, matchScenario: entry.extensions?.match_scenario ?? false,
            matchCreatorNotes: entry.extensions?.match_creator_notes ?? false, extensions: entry.extensions ?? {}, triggers: entry.extensions?.triggers || [], ignoreBudget: entry.extensions?.ignore_budget ?? false,
        };
    });
    return result;
}
// END_SILLYTAVERN_SLICE::world-info::character-book-conversion

module.exports = {
    DEFAULT_DEPTH, DEFAULT_ORDER, INJECTION_POSITION, Prompt, PromptCollection, preparePrompt, shouldTrigger, getPromptCollection,
    promptManagerDefaultPromptOrder, createExampleDialogueRuntime, createPopulationInjectionPrompts,
    persona_description_positions, PERSONA_DEFAULT_DEPTH, PERSONA_DEFAULT_ROLE, metadata_keys, chara_note_position, createFloatingPromptRuntime,
    world_info_logic, world_info_position, wi_anchor_position, parseRegexFromString, matchKeys, newWorldInfoEntryDefinition, newWorldInfoEntryTemplate, convertCharacterBook,
    WORLD_INFO_DEFAULT_DEPTH, DEFAULT_WEIGHT,
};
