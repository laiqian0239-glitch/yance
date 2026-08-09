'use strict';

// Yance modification notice (2026-08-09): mechanically adapted from the pinned SillyTavern source below.
// This modified source file is licensed under GNU Affero General Public License v3.0 (AGPL-3.0); see ../../LICENSE.
// Upstream: SillyTavern 1.18.0, src/validator/TavernCardValidator.js
// Commit: 51ad27fb86d39a3daca3adaa970375c9670c12df
// Source blob: 82593d0aabda8b17363f892cc7119a005eefae77
// Transformation: strip ESM export and add CommonJS export only.
class TavernCardValidator {
    #lastValidationError = null;

    constructor(card) {
        this.card = card;
    }

    get lastValidationError() {
        return this.#lastValidationError;
    }

    validate() {
        this.#lastValidationError = null;

        if (this.validateV1()) return 1;
        if (this.validateV2()) return 2;
        if (this.validateV3()) return 3;
        return false;
    }

    validateV1() {
        const requiredFields = ['name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example'];
        return requiredFields.every(field => {
            if (!Object.hasOwn(this.card, field)) {
                this.#lastValidationError = field;
                return false;
            }
            return true;
        });
    }

    validateV2() {
        return this.#validateSpecV2()
            && this.#validateSpecVersionV2()
            && this.#validateDataV2()
            && this.#validateCharacterBookV2();
    }

    validateV3() {
        return this.#validateSpecV3()
            && this.#validateSpecVersionV3()
            && this.#validateDataV3();
    }

    #validateSpecV2() {
        if (this.card.spec !== 'chara_card_v2') {
            this.#lastValidationError = 'spec';
            return false;
        }
        return true;
    }

    #validateSpecVersionV2() {
        if (this.card.spec_version !== '2.0') {
            this.#lastValidationError = 'spec_version';
            return false;
        }
        return true;
    }

    #validateDataV2() {
        const data = this.card.data;

        if (!data) {
            this.#lastValidationError = 'No tavern card data found';
            return false;
        }

        const requiredFields = ['name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example', 'creator_notes', 'system_prompt', 'post_history_instructions', 'alternate_greetings', 'tags', 'creator', 'character_version', 'extensions'];
        const isAllRequiredFieldsPresent = requiredFields.every(field => {
            if (!Object.hasOwn(data, field)) {
                this.#lastValidationError = `data.${field}`;
                return false;
            }
            return true;
        });

        return isAllRequiredFieldsPresent && Array.isArray(data.alternate_greetings) && Array.isArray(data.tags) && typeof data.extensions === 'object';
    }

    #validateCharacterBookV2() {
        const characterBook = this.card.data.character_book;

        if (!characterBook) return true;

        const requiredFields = ['extensions', 'entries'];
        const isAllRequiredFieldsPresent = requiredFields.every(field => {
            if (!Object.hasOwn(characterBook, field)) {
                this.#lastValidationError = `data.character_book.${field}`;
                return false;
            }
            return true;
        });

        return isAllRequiredFieldsPresent && Array.isArray(characterBook.entries) && typeof characterBook.extensions === 'object';
    }

    #validateSpecV3() {
        if (this.card.spec !== 'chara_card_v3') {
            this.#lastValidationError = 'spec';
            return false;
        }
        return true;
    }

    #validateSpecVersionV3() {
        if (Number(this.card.spec_version) < 3.0 || Number(this.card.spec_version) >= 4.0) {
            this.#lastValidationError = 'spec_version';
            return false;
        }
        return true;
    }

    #validateDataV3() {
        const data = this.card.data;

        if (!data || typeof data !== 'object') {
            this.#lastValidationError = 'No tavern card data found';
            return false;
        }

        return true;
    }
}

module.exports = TavernCardValidator;
module.exports.TavernCardValidator = TavernCardValidator;
