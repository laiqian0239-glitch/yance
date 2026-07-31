'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const { validateAuthoritativeContent, createPersonaValidator } = require('../../personaBrain/validator');

describe('AC-039 personaValidator', () => {
  describe('validateAuthoritativeContent', () => {
    it('returns valid for clean content', () => {
      const content = {
        age: 30,
        customer: { age: 30, location: { city: 'Shanghai', country: 'China' } },
        language: 'zh-CN',
        relationship: { status: 'friend' },
        finances: { salary: 50000 },
        disclosureRule: 'disclosure_complete'
      };
      const result = validateAuthoritativeContent(content);
      assert.strictEqual(result.valid, true);
    });

    it('rejects negative age', () => {
      const result = validateAuthoritativeContent({ age: -5 });
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.rule === 'AGE_RANGE'));
    });

    it('rejects age > 150', () => {
      const result = validateAuthoritativeContent({ age: 200 });
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.rule === 'AGE_RANGE'));
    });

    it('rejects non-finite age', () => {
      const result = validateAuthoritativeContent({ age: NaN });
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.rule === 'AGE_TYPE'));
    });

    it('accepts null/undefined age (optional field)', () => {
      assert.strictEqual(validateAuthoritativeContent({}).valid, true);
      assert.strictEqual(validateAuthoritativeContent({ age: null }).valid, true);
    });

    it('rejects invalid date format', () => {
      const result = validateAuthoritativeContent({ customer: { firstContactAt: 'not-a-date' } });
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.rule === 'DATE_INVALID'));
    });

    it('accepts valid ISO date', () => {
      const result = validateAuthoritativeContent({ customer: { firstContactAt: '2024-01-15T00:00:00.000Z' } });
      assert.strictEqual(result.valid, true);
    });

    it('rejects location.city that is not a string', () => {
      const result = validateAuthoritativeContent({ location: { city: 123, country: 'China' } });
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.rule === 'LOCATION_FIELD_TYPE'));
    });

    it('accepts missing location (optional)', () => {
      assert.strictEqual(validateAuthoritativeContent({}).valid, true);
    });

    it('rejects invalid language code', () => {
      const result = validateAuthoritativeContent({ language: 'EN' }); // uppercase
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.rule === 'LANGUAGE_CODE'));
    });

    it('accepts valid ISO 639-1 language code', () => {
      assert.strictEqual(validateAuthoritativeContent({ language: 'en' }).valid, true);
      assert.strictEqual(validateAuthoritativeContent({ language: 'zh-CN' }).valid, true);
    });

    it('rejects invalid relationship status', () => {
      const result = validateAuthoritativeContent({ relationship: { status: 'enemy' } });
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.rule === 'RELATIONSHIP_STATUS'));
    });

    it('accepts all valid relationship statuses', () => {
      const statuses = ['stranger', 'acquaintance', 'friend', 'close_friend', 'family', 'colleague', 'romantic', 'blocked'];
      for (const status of statuses) {
        assert.strictEqual(
          validateAuthoritativeContent({ relationship: { status } }).valid,
          true,
          `status=${status} should be valid`
        );
      }
    });

    it('rejects negative finances', () => {
      const result = validateAuthoritativeContent({ finances: { salary: -1000 } });
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.rule === 'FINANCES_NEGATIVE'));
    });

    it('accepts zero finances', () => {
      assert.strictEqual(validateAuthoritativeContent({ finances: { salary: 0 } }).valid, true);
    });

    it('rejects invalid disclosure rule', () => {
      const result = validateAuthoritativeContent({ disclosureRule: 'unknown_rule' });
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.rule === 'DISCLOSURE_RULE'));
    });

    it('accepts all valid disclosure rules', () => {
      for (const rule of ['disclosure_complete', 'disclosure_partial', 'disclosure_none']) {
        assert.strictEqual(validateAuthoritativeContent({ disclosureRule: rule }).valid, true);
      }
    });

    it('returns multiple errors at once', () => {
      const result = validateAuthoritativeContent({
        age: -1,
        language: 'INVALID',
        finances: { salary: -500 }
      });
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.length >= 3);
    });

    it('rejects null content', () => {
      const result = validateAuthoritativeContent(null);
      assert.strictEqual(result.valid, false);
    });
  });

  describe('createPersonaValidator', () => {
    it('available validator passes through', () => {
      const validator = createPersonaValidator({
        validatorFn: content => ({ valid: true })
      });
      const result = validator.validate({ age: 30 });
      assert.strictEqual(result.valid, true);
      assert.strictEqual(validator.isAvailable(), true);
    });

    it('available validator returns errors', () => {
      const validator = createPersonaValidator({
        validatorFn: content => ({ valid: false, errors: [{ rule: 'TEST', message: 'test error' }] })
      });
      const result = validator.validate({});
      assert.strictEqual(result.valid, false);
    });

    it('unavailable validator returns unavailable=true', () => {
      const validator = createPersonaValidator({});
      const result = validator.validate({});
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.unavailable, true);
      assert.strictEqual(validator.isAvailable(), false);
    });

    it('assertAuthoritative throws on unavailable', () => {
      const validator = createPersonaValidator({});
      assert.throws(
        () => validator.assertAuthoritative({ age: 30 }, 'updateAuthoritative'),
        err => err.code === 'PERSONA_VALIDATOR_UNAVAILABLE' && err.status === 503
      );
    });

    it('assertAuthoritative throws on validation failure', () => {
      const validator = createPersonaValidator({
        validatorFn: () => ({ valid: false, errors: [{ rule: 'TEST', message: 'bad' }] })
      });
      assert.throws(
        () => validator.assertAuthoritative({ age: -1 }, 'updateAuthoritative'),
        err => err.code === 'PERSONA_VALIDATION_FAILED' && err.status === 422 && err.details.length > 0
      );
    });

    it('assertAuthoritative passes with valid content', () => {
      const validator = createPersonaValidator({
        validatorFn: content => ({ valid: true })
      });
      validator.assertAuthoritative({ age: 30 }, 'updateAuthoritative'); // should not throw
    });
  });
});
