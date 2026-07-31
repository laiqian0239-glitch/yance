'use strict';

function optionValue(name, options = {}) {
  const argv = options.argv || process.argv;
  const env = options.env || process.env;
  const index = argv.indexOf(name);
  if (index >= 0) {
    const value = argv[index + 1];
    if (value === undefined || String(value).startsWith('--')) {
      const error = new Error(`${name} requires a value`);
      error.reasonCode = 'WP7_CLI_ARGUMENT_VALUE_MISSING';
      error.details = { name };
      throw error;
    }
    return value;
  }
  if (options.envName && env[options.envName] !== undefined && String(env[options.envName]).trim() !== '') {
    return env[options.envName];
  }
  return options.fallback === undefined ? null : options.fallback;
}

function numericOption(name, options = {}) {
  const value = optionValue(name, options);
  if (value === null || value === undefined || value === '') return options.fallback === undefined ? null : options.fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) {
    const error = new Error(`${name} must be numeric`);
    error.reasonCode = 'WP7_CLI_ARGUMENT_VALUE_INVALID';
    error.details = { name, value };
    throw error;
  }
  return number;
}

module.exports = { numericOption, optionValue };
