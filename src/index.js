'use strict';

/**
 * envguard - Runtime .env Contract Enforcer
 * Zero dependencies. TypeScript types included.
 *
 * Define a contract for your environment variables.
 * Validate at startup. Access typed values throughout your app.
 */

// ─── Type Validators ──────────────────────────────────────────────────────────

const VALIDATORS = {
  string(value, opts = {}) {
    if (typeof value !== 'string') return 'must be a string';
    if (opts.minLength != null && value.length < opts.minLength) {
      return `must be at least ${opts.minLength} characters`;
    }
    if (opts.maxLength != null && value.length > opts.maxLength) {
      return `must be at most ${opts.maxLength} characters`;
    }
    if (opts.pattern != null) {
      const re = opts.pattern instanceof RegExp ? opts.pattern : new RegExp(opts.pattern);
      if (!re.test(value)) return `must match pattern ${re}`;
    }
    return null;
  },

  number(value, opts = {}) {
    const n = Number(value);
    if (isNaN(n)) return `"${value}" is not a valid number`;
    if (opts.min != null && n < opts.min) return `${n} is below minimum (${opts.min})`;
    if (opts.max != null && n > opts.max) return `${n} exceeds maximum (${opts.max})`;
    return null;
  },

  boolean(value) {
    const truthy = ['true', '1', 'yes', 'on'];
    const falsy  = ['false', '0', 'no', 'off'];
    if (truthy.includes(String(value).toLowerCase())) return null;
    if (falsy.includes(String(value).toLowerCase())) return null;
    return `"${value}" is not a boolean (use true/false/1/0/yes/no)`;
  },

  url(value) {
    try {
      new URL(value);
      return null;
    } catch {
      return `"${value}" is not a valid URL`;
    }
  },

  email(value) {
    // RFC 5322 simplified pattern
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    if (!re.test(value)) return `"${value}" is not a valid email address`;
    return null;
  },

  enum(value, opts = {}) {
    const choices = opts.values || [];
    if (!choices.includes(value)) {
      return `"${value}" must be one of [${choices.join(', ')}]`;
    }
    return null;
  },

  json(value) {
    try {
      JSON.parse(value);
      return null;
    } catch {
      return `"${value}" is not valid JSON`;
    }
  },

  port(value) {
    const n = Number(value);
    if (isNaN(n) || !Number.isInteger(n)) return `"${value}" is not a valid port number`;
    if (n < 1 || n > 65535) return `${n} is out of valid port range [1-65535]`;
    return null;
  },
};

// ─── Value Coercion ───────────────────────────────────────────────────────────

function coerce(type, rawValue, opts = {}) {
  switch (type) {
    case 'number':
      return Number(rawValue);
    case 'boolean': {
      const truthy = ['true', '1', 'yes', 'on'];
      return truthy.includes(String(rawValue).toLowerCase());
    }
    case 'json':
      return JSON.parse(rawValue);
    case 'port':
      return parseInt(rawValue, 10);
    case 'enum':
      return rawValue;
    default:
      return rawValue;
  }
}

// ─── Example Value Generators ─────────────────────────────────────────────────

const EXAMPLES = {
  string:  (opts) => opts.example || 'your_value_here',
  number:  (opts) => opts.example || opts.default || '42',
  boolean: (opts) => opts.example || 'true',
  url:     (opts) => opts.example || 'https://example.com',
  email:   (opts) => opts.example || 'user@example.com',
  enum:    (opts) => opts.example || (opts.values ? opts.values[0] : 'value'),
  json:    (opts) => opts.example || '{"key":"value"}',
  port:    (opts) => opts.example || opts.default || '3000',
};

// ─── Terminal Colors (no dependencies) ───────────────────────────────────────

const c = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  red:    '\x1b[31m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  gray:   '\x1b[90m',
  white:  '\x1b[37m',
};

function colorize(enabled = true) {
  if (!enabled || process.env.NO_COLOR || process.env.ENVGUARD_NO_COLOR) {
    return Object.fromEntries(Object.keys(c).map(k => [k, '']));
  }
  return c;
}

// ─── Core Validation Engine ───────────────────────────────────────────────────

/**
 * Validate a single field against its spec.
 * @param {string} key
 * @param {string|undefined} rawValue
 * @param {object} spec
 * @returns {{ error: string|null, value: any }}
 */
function validateField(key, rawValue, spec) {
  const type = spec.type || 'string';

  // Check presence
  if (rawValue === undefined || rawValue === '') {
    if (spec.default !== undefined) {
      return { error: null, value: coerce(type, spec.default, spec) };
    }
    if (spec.required !== false) {
      return { error: 'missing (required)', value: undefined };
    }
    return { error: null, value: undefined };
  }

  // Validate value
  const validator = VALIDATORS[type];
  if (!validator) {
    return { error: `unknown type "${type}"`, value: undefined };
  }

  const validationError = validator(rawValue, spec);
  if (validationError) {
    return { error: validationError, value: undefined };
  }

  // Custom validator
  if (typeof spec.validate === 'function') {
    const customError = spec.validate(rawValue);
    if (customError) return { error: customError, value: undefined };
  }

  return { error: null, value: coerce(type, rawValue, spec) };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Validate environment variables against a contract and return typed config.
 * Throws (and exits) if validation fails.
 *
 * @param {Record<string, object>} contract - The env var contract
 * @param {object} [options]
 * @param {object} [options.env] - Custom env source (default: process.env)
 * @param {boolean} [options.color] - Enable colored output (default: true)
 * @param {boolean} [options.exitOnFail] - Call process.exit(1) on failure (default: true)
 * @returns {Record<string, any>} Typed, validated config object
 */
function guard(contract, options = {}) {
  const {
    env: envSource = process.env,
    color = true,
    exitOnFail = true,
  } = options;

  const errors = [];
  const result = {};

  for (const [key, spec] of Object.entries(contract)) {
    const rawValue = envSource[key];
    const { error, value } = validateField(key, rawValue, spec);

    if (error) {
      errors.push({ key, error });
    } else {
      result[key] = value;
    }
  }

  if (errors.length > 0) {
    const cl = colorize(color);
    const lines = [
      '',
      `${cl.bold}${cl.red}  envguard: Contract Violation${cl.reset}`,
      `${cl.gray}  ─────────────────────────────────────────────${cl.reset}`,
    ];

    for (const [key, spec] of Object.entries(contract)) {
      const failing = errors.find(e => e.key === key);
      if (failing) {
        lines.push(`  ${cl.red}✗${cl.reset}  ${cl.bold}${key}${cl.reset}${cl.gray} — ${failing.error}${cl.reset}`);
      } else {
        lines.push(`  ${cl.green}✓${cl.reset}  ${cl.gray}${key}${cl.reset}`);
      }
    }

    lines.push(`${cl.gray}  ─────────────────────────────────────────────${cl.reset}`);
    lines.push(`  ${cl.yellow}Tip: run \`node -e "require('envguard').example(contract)"\` to generate .env.example${cl.reset}`);
    lines.push('');

    const message = lines.join('\n');
    const err = new Error(message);
    err.name = 'EnvGuardError';
    err.failures = errors;

    if (exitOnFail) {
      console.error(message);
      process.exit(1);
    }

    throw err;
  }

  return Object.freeze(result);
}

/**
 * Validate without throwing. Returns a result object.
 *
 * @param {Record<string, object>} contract
 * @param {object} [options]
 * @param {object} [options.env] - Custom env source (default: process.env)
 * @returns {{ valid: boolean, errors: Array<{key, error}>, config: object }}
 */
function check(contract, options = {}) {
  const { env: envSource = process.env } = options;

  const errors = [];
  const config = {};

  for (const [key, spec] of Object.entries(contract)) {
    const rawValue = envSource[key];
    const { error, value } = validateField(key, rawValue, spec);
    if (error) {
      errors.push({ key, error });
    } else {
      config[key] = value;
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    config: errors.length === 0 ? Object.freeze(config) : config,
  };
}

/**
 * Generate a .env.example file content from a contract.
 *
 * @param {Record<string, object>} contract
 * @returns {string} The .env.example content
 */
function example(contract) {
  const lines = [
    '# Generated by envguard',
    '# https://www.npmjs.com/package/envguard',
    '',
  ];

  for (const [key, spec] of Object.entries(contract)) {
    const type = spec.type || 'string';
    const required = spec.required !== false;
    const exampleValue = EXAMPLES[type] ? EXAMPLES[type](spec) : 'value';

    if (spec.description) {
      lines.push(`# ${spec.description}`);
    }

    const tags = [];
    if (required) tags.push('required');
    else tags.push('optional');
    if (spec.default !== undefined) tags.push(`default: ${spec.default}`);
    if (type !== 'string') tags.push(`type: ${type}`);
    if (tags.length) lines.push(`# [${tags.join(', ')}]`);

    lines.push(`${key}=${exampleValue}`);
    lines.push('');
  }

  const output = lines.join('\n');
  process.stdout.write(output);
  return output;
}

/**
 * Show current env status without crashing. For debugging.
 *
 * @param {Record<string, object>} contract
 * @param {object} [options]
 * @param {object} [options.env] - Custom env source (default: process.env)
 * @param {boolean} [options.color] - Enable colored output (default: true)
 * @returns {{ passed: string[], failed: string[], missing: string[] }}
 */
function audit(contract, options = {}) {
  const { env: envSource = process.env, color = true } = options;
  const cl = colorize(color);

  const passed  = [];
  const failed  = [];
  const missing = [];

  console.log(`\n${cl.bold}  envguard: Environment Audit${cl.reset}`);
  console.log(`${cl.gray}  ─────────────────────────────────────────────${cl.reset}`);

  for (const [key, spec] of Object.entries(contract)) {
    const rawValue = envSource[key];
    const { error } = validateField(key, rawValue, spec);
    const type = spec.type || 'string';
    const required = spec.required !== false;

    if (error) {
      if (rawValue === undefined || rawValue === '') {
        missing.push(key);
        const badge = required ? `${cl.red}MISSING${cl.reset}` : `${cl.yellow}UNSET${cl.reset}`;
        console.log(`  ${badge}   ${cl.bold}${key}${cl.reset}${cl.gray} (${type})${cl.reset}`);
      } else {
        failed.push(key);
        console.log(`  ${cl.red}INVALID${cl.reset}  ${cl.bold}${key}${cl.reset}${cl.gray} — ${error}${cl.reset}`);
      }
    } else {
      passed.push(key);
      const preview = rawValue !== undefined
        ? ` = ${String(rawValue).substring(0, 20)}${rawValue.length > 20 ? '…' : ''}`
        : ` (default: ${spec.default})`;
      console.log(`  ${cl.green}OK${cl.reset}       ${cl.bold}${key}${cl.reset}${cl.gray}${preview}${cl.reset}`);
    }
  }

  console.log(`${cl.gray}  ─────────────────────────────────────────────${cl.reset}`);
  console.log(`  ${cl.green}${passed.length} passed${cl.reset}  ${cl.red}${failed.length + missing.length} issues${cl.reset}\n`);

  return { passed, failed, missing };
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = { guard, check, example, audit };
