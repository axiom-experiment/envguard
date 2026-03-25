'use strict';

const assert = require('assert');
const { guard, check, example, audit } = require('../src/index');

// ─── Test Helpers ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const results = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    results.push({ status: 'pass', name });
  } catch (err) {
    failed++;
    results.push({ status: 'fail', name, error: err.message });
  }
}

function assertEqual(actual, expected, msg = '') {
  assert.strictEqual(actual, expected, msg || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function assertDeepEqual(actual, expected, msg = '') {
  assert.deepStrictEqual(actual, expected, msg);
}

function assertThrows(fn, expectedMessage) {
  let threw = false;
  try {
    fn();
  } catch (err) {
    threw = true;
    if (expectedMessage && !err.message.includes(expectedMessage)) {
      throw new Error(`Expected error message to include "${expectedMessage}", got: ${err.message}`);
    }
  }
  if (!threw) throw new Error('Expected function to throw but it did not');
}

// ─── guard() Tests ────────────────────────────────────────────────────────────

test('guard: returns typed config for valid env', () => {
  const config = guard(
    {
      APP_NAME: { type: 'string', required: true },
      PORT: { type: 'port', default: '3000' },
    },
    { env: { APP_NAME: 'TestApp' }, exitOnFail: false }
  );
  assertEqual(config.APP_NAME, 'TestApp');
  assertEqual(config.PORT, 3000);
});

test('guard: coerces number type', () => {
  const config = guard(
    { TIMEOUT: { type: 'number', required: true } },
    { env: { TIMEOUT: '5000' }, exitOnFail: false }
  );
  assertEqual(config.TIMEOUT, 5000);
  assertEqual(typeof config.TIMEOUT, 'number');
});

test('guard: coerces boolean type (true)', () => {
  const config = guard(
    { DEBUG: { type: 'boolean', required: true } },
    { env: { DEBUG: 'true' }, exitOnFail: false }
  );
  assertEqual(config.DEBUG, true);
});

test('guard: coerces boolean type (false)', () => {
  const config = guard(
    { DEBUG: { type: 'boolean', required: true } },
    { env: { DEBUG: '0' }, exitOnFail: false }
  );
  assertEqual(config.DEBUG, false);
});

test('guard: coerces boolean yes/no variants', () => {
  const c1 = guard({ X: { type: 'boolean' } }, { env: { X: 'yes' }, exitOnFail: false });
  const c2 = guard({ X: { type: 'boolean' } }, { env: { X: 'no' }, exitOnFail: false });
  assertEqual(c1.X, true);
  assertEqual(c2.X, false);
});

test('guard: applies default when var is missing', () => {
  const config = guard(
    { PORT: { type: 'port', default: '8080' } },
    { env: {}, exitOnFail: false }
  );
  assertEqual(config.PORT, 8080);
});

test('guard: throws when required var missing', () => {
  assertThrows(() => {
    guard(
      { SECRET: { type: 'string', required: true } },
      { env: {}, exitOnFail: false }
    );
  }, 'missing');
});

test('guard: returns frozen object', () => {
  const config = guard(
    { X: { type: 'string', default: 'hello' } },
    { env: {}, exitOnFail: false }
  );
  assertEqual(Object.isFrozen(config), true);
});

test('guard: optional var without default returns undefined', () => {
  const config = guard(
    { OPTIONAL: { type: 'string', required: false } },
    { env: {}, exitOnFail: false }
  );
  assertEqual(config.OPTIONAL, undefined);
});

test('guard: collects all errors before throwing', () => {
  let caught;
  try {
    guard(
      {
        A: { type: 'string', required: true },
        B: { type: 'number', required: true },
        C: { type: 'string', default: 'ok' },
      },
      { env: {}, exitOnFail: false }
    );
  } catch (err) {
    caught = err;
  }
  assert.ok(caught, 'should have thrown');
  assertEqual(caught.failures.length, 2);
  assertEqual(caught.failures[0].key, 'A');
  assertEqual(caught.failures[1].key, 'B');
});

// ─── Type Validation Tests ────────────────────────────────────────────────────

test('string: validates minLength', () => {
  assertThrows(() => {
    guard(
      { TOKEN: { type: 'string', minLength: 10 } },
      { env: { TOKEN: 'short' }, exitOnFail: false }
    );
  }, 'at least 10');
});

test('string: validates maxLength', () => {
  assertThrows(() => {
    guard(
      { NAME: { type: 'string', maxLength: 5 } },
      { env: { NAME: 'toolong_name' }, exitOnFail: false }
    );
  }, 'at most 5');
});

test('string: validates regex pattern', () => {
  assertThrows(() => {
    guard(
      { CODE: { type: 'string', pattern: /^\d{4}$/ } },
      { env: { CODE: 'abc' }, exitOnFail: false }
    );
  }, 'match pattern');
});

test('string: passes regex pattern', () => {
  const config = guard(
    { CODE: { type: 'string', pattern: /^\d{4}$/ } },
    { env: { CODE: '1234' }, exitOnFail: false }
  );
  assertEqual(config.CODE, '1234');
});

test('number: validates min', () => {
  assertThrows(() => {
    guard(
      { WORKERS: { type: 'number', min: 1 } },
      { env: { WORKERS: '0' }, exitOnFail: false }
    );
  }, 'below minimum');
});

test('number: validates max', () => {
  assertThrows(() => {
    guard(
      { RETRIES: { type: 'number', max: 5 } },
      { env: { RETRIES: '10' }, exitOnFail: false }
    );
  }, 'exceeds maximum');
});

test('number: rejects non-numeric string', () => {
  assertThrows(() => {
    guard(
      { PORT: { type: 'number' } },
      { env: { PORT: 'abc' }, exitOnFail: false }
    );
  }, 'not a valid number');
});

test('url: validates valid URL', () => {
  const config = guard(
    { API: { type: 'url' } },
    { env: { API: 'https://api.example.com/v2' }, exitOnFail: false }
  );
  assertEqual(config.API, 'https://api.example.com/v2');
});

test('url: rejects invalid URL', () => {
  assertThrows(() => {
    guard(
      { API: { type: 'url' } },
      { env: { API: 'not-a-url' }, exitOnFail: false }
    );
  }, 'not a valid URL');
});

test('email: validates valid email', () => {
  const config = guard(
    { EMAIL: { type: 'email' } },
    { env: { EMAIL: 'user@example.com' }, exitOnFail: false }
  );
  assertEqual(config.EMAIL, 'user@example.com');
});

test('email: rejects invalid email', () => {
  assertThrows(() => {
    guard(
      { EMAIL: { type: 'email' } },
      { env: { EMAIL: 'not-an-email' }, exitOnFail: false }
    );
  }, 'not a valid email');
});

test('enum: accepts valid value', () => {
  const config = guard(
    { ENV: { type: 'enum', values: ['dev', 'prod', 'staging'] } },
    { env: { ENV: 'prod' }, exitOnFail: false }
  );
  assertEqual(config.ENV, 'prod');
});

test('enum: rejects invalid value', () => {
  assertThrows(() => {
    guard(
      { ENV: { type: 'enum', values: ['dev', 'prod'] } },
      { env: { ENV: 'production' }, exitOnFail: false }
    );
  }, 'must be one of');
});

test('json: parses valid JSON', () => {
  const config = guard(
    { OPTS: { type: 'json' } },
    { env: { OPTS: '{"timeout":30,"retry":3}' }, exitOnFail: false }
  );
  assertDeepEqual(config.OPTS, { timeout: 30, retry: 3 });
});

test('json: rejects invalid JSON', () => {
  assertThrows(() => {
    guard(
      { OPTS: { type: 'json' } },
      { env: { OPTS: '{bad json}' }, exitOnFail: false }
    );
  }, 'not valid JSON');
});

test('port: accepts valid port number', () => {
  const config = guard(
    { PORT: { type: 'port' } },
    { env: { PORT: '8443' }, exitOnFail: false }
  );
  assertEqual(config.PORT, 8443);
});

test('port: rejects out-of-range port', () => {
  assertThrows(() => {
    guard(
      { PORT: { type: 'port' } },
      { env: { PORT: '99999' }, exitOnFail: false }
    );
  }, 'out of valid port range');
});

test('port: rejects port 0', () => {
  assertThrows(() => {
    guard(
      { PORT: { type: 'port' } },
      { env: { PORT: '0' }, exitOnFail: false }
    );
  }, 'out of valid port range');
});

test('port: rejects non-integer', () => {
  assertThrows(() => {
    guard(
      { PORT: { type: 'port' } },
      { env: { PORT: '3000.5' }, exitOnFail: false }
    );
  });
});

test('port: accepts port 65535', () => {
  const config = guard(
    { PORT: { type: 'port' } },
    { env: { PORT: '65535' }, exitOnFail: false }
  );
  assertEqual(config.PORT, 65535);
});

// ─── Custom Validator Tests ───────────────────────────────────────────────────

test('custom validate: passes when returns null', () => {
  const config = guard(
    {
      CODE: {
        type: 'string',
        validate: (v) => v.startsWith('sk-') ? null : 'must start with sk-',
      },
    },
    { env: { CODE: 'sk-abc123' }, exitOnFail: false }
  );
  assertEqual(config.CODE, 'sk-abc123');
});

test('custom validate: fails when returns error string', () => {
  assertThrows(() => {
    guard(
      {
        CODE: {
          type: 'string',
          validate: (v) => v.startsWith('sk-') ? null : 'must start with sk-',
        },
      },
      { env: { CODE: 'not-valid' }, exitOnFail: false }
    );
  }, 'must start with sk-');
});

// ─── check() Tests ────────────────────────────────────────────────────────────

test('check: returns valid=true for passing env', () => {
  const result = check(
    { NAME: { type: 'string', required: true } },
    { env: { NAME: 'hello' } }
  );
  assertEqual(result.valid, true);
  assertEqual(result.errors.length, 0);
  assertEqual(result.config.NAME, 'hello');
});

test('check: returns valid=false for failing env', () => {
  const result = check(
    { SECRET: { type: 'string', required: true } },
    { env: {} }
  );
  assertEqual(result.valid, false);
  assertEqual(result.errors.length, 1);
  assertEqual(result.errors[0].key, 'SECRET');
});

test('check: collects multiple errors', () => {
  const result = check(
    {
      A: { type: 'string', required: true },
      B: { type: 'number', required: true },
      C: { type: 'string', default: 'ok' },
    },
    { env: {} }
  );
  assertEqual(result.valid, false);
  assertEqual(result.errors.length, 2);
});

test('check: returns frozen config on success', () => {
  const result = check(
    { X: { type: 'string', default: 'y' } },
    { env: {} }
  );
  assertEqual(result.valid, true);
  assertEqual(Object.isFrozen(result.config), true);
});

test('check: does not throw on invalid env', () => {
  let threw = false;
  try {
    check({ REQUIRED: { type: 'string', required: true } }, { env: {} });
  } catch {
    threw = true;
  }
  assertEqual(threw, false);
});

// ─── example() Tests ──────────────────────────────────────────────────────────

test('example: generates content with key names', () => {
  // capture stdout
  const chunks = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => { chunks.push(chunk); return true; };

  example({
    DATABASE_URL: { type: 'url', description: 'PostgreSQL URL' },
    PORT: { type: 'port', default: '3000' },
  });

  process.stdout.write = orig;
  const output = chunks.join('');
  assert.ok(output.includes('DATABASE_URL'), 'should include key name');
  assert.ok(output.includes('PORT'), 'should include PORT');
  assert.ok(output.includes('PostgreSQL URL'), 'should include description');
  assert.ok(output.includes('Generated by envguard'), 'should include header');
});

test('example: marks required fields', () => {
  const chunks = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => { chunks.push(chunk); return true; };

  example({ REQUIRED_KEY: { type: 'string', required: true } });

  process.stdout.write = orig;
  const output = chunks.join('');
  assert.ok(output.includes('required'), 'should mark required fields');
});

test('example: marks optional fields', () => {
  const chunks = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => { chunks.push(chunk); return true; };

  example({ OPTIONAL_KEY: { type: 'string', required: false } });

  process.stdout.write = orig;
  const output = chunks.join('');
  assert.ok(output.includes('optional'), 'should mark optional fields');
});

// ─── audit() Tests ────────────────────────────────────────────────────────────

test('audit: returns passed/failed/missing arrays', () => {
  // Suppress console output
  const origLog = console.log;
  console.log = () => {};

  const result = audit(
    {
      GOOD: { type: 'string' },
      BAD_NUM: { type: 'number' },
      ABSENT: { type: 'string', required: true },
    },
    { env: { GOOD: 'hello', BAD_NUM: 'not-a-number' }, color: false }
  );

  console.log = origLog;

  assert.ok(result.passed.includes('GOOD'), 'GOOD should be in passed');
  assert.ok(result.failed.includes('BAD_NUM'), 'BAD_NUM should be in failed');
  assert.ok(result.missing.includes('ABSENT'), 'ABSENT should be in missing');
});

test('audit: does not throw even with all vars missing', () => {
  const origLog = console.log;
  console.log = () => {};

  let threw = false;
  try {
    audit(
      {
        A: { type: 'string', required: true },
        B: { type: 'number', required: true },
      },
      { env: {}, color: false }
    );
  } catch {
    threw = true;
  }

  console.log = origLog;
  assertEqual(threw, false);
});

// ─── Edge Case Tests ──────────────────────────────────────────────────────────

test('edge: handles empty string as missing', () => {
  assertThrows(() => {
    guard(
      { KEY: { type: 'string', required: true } },
      { env: { KEY: '' }, exitOnFail: false }
    );
  }, 'missing');
});

test('edge: unknown type returns error', () => {
  assertThrows(() => {
    guard(
      { KEY: { type: 'unknowntype' } },
      { env: { KEY: 'value' }, exitOnFail: false }
    );
  }, 'unknown type');
});

test('edge: default value for number type is coerced', () => {
  const config = guard(
    { TIMEOUT: { type: 'number', default: '3000' } },
    { env: {}, exitOnFail: false }
  );
  assertEqual(config.TIMEOUT, 3000);
  assertEqual(typeof config.TIMEOUT, 'number');
});

test('edge: boolean default coercion', () => {
  const config = guard(
    { VERBOSE: { type: 'boolean', default: 'false' } },
    { env: {}, exitOnFail: false }
  );
  assertEqual(config.VERBOSE, false);
  assertEqual(typeof config.VERBOSE, 'boolean');
});

test('edge: custom env source takes precedence over process.env', () => {
  const originalVal = process.env.TEST_ENVGUARD_UNIQUE_KEY;
  process.env.TEST_ENVGUARD_UNIQUE_KEY = 'from-process';

  const config = guard(
    { TEST_ENVGUARD_UNIQUE_KEY: { type: 'string' } },
    { env: { TEST_ENVGUARD_UNIQUE_KEY: 'from-custom' }, exitOnFail: false }
  );

  if (originalVal === undefined) delete process.env.TEST_ENVGUARD_UNIQUE_KEY;
  else process.env.TEST_ENVGUARD_UNIQUE_KEY = originalVal;

  assertEqual(config.TEST_ENVGUARD_UNIQUE_KEY, 'from-custom');
});

test('edge: NO_COLOR env var disables colors', () => {
  process.env.NO_COLOR = '1';
  // Just ensure no crash
  const result = check(
    { X: { type: 'string', required: false } },
    { env: {} }
  );
  delete process.env.NO_COLOR;
  assertEqual(result.valid, true);
});

test('edge: handles large contract efficiently', () => {
  const contract = {};
  const envSrc = {};
  for (let i = 0; i < 50; i++) {
    contract[`VAR_${i}`] = { type: 'string', required: false, default: `default_${i}` };
  }
  const config = guard(contract, { env: envSrc, exitOnFail: false });
  assertEqual(config.VAR_0, 'default_0');
  assertEqual(config.VAR_49, 'default_49');
});

// ─── Real-World Scenario Tests ────────────────────────────────────────────────

test('scenario: web server config', () => {
  const config = guard(
    {
      PORT:        { type: 'port',   default: '3000' },
      HOST:        { type: 'string', default: '0.0.0.0' },
      DATABASE_URL:{ type: 'url',    required: true },
      NODE_ENV:    { type: 'enum',   values: ['development', 'production', 'test'], default: 'development' },
      JWT_SECRET:  { type: 'string', required: true, minLength: 32 },
      LOG_LEVEL:   { type: 'enum',   values: ['debug', 'info', 'warn', 'error'], default: 'info' },
      DEBUG:       { type: 'boolean', default: 'false' },
    },
    {
      env: {
        DATABASE_URL: 'postgresql://localhost:5432/myapp',
        JWT_SECRET:   'super-secret-key-that-is-at-least-32-chars-long',
        PORT:         '4000',
        NODE_ENV:     'production',
      },
      exitOnFail: false,
    }
  );
  assertEqual(config.PORT, 4000);
  assertEqual(config.HOST, '0.0.0.0');
  assertEqual(config.NODE_ENV, 'production');
  assertEqual(config.DEBUG, false);
  assertEqual(config.LOG_LEVEL, 'info');
});

test('scenario: api client config', () => {
  const config = guard(
    {
      API_BASE_URL:   { type: 'url',    required: true },
      API_KEY:        { type: 'string', required: true, minLength: 20 },
      API_TIMEOUT_MS: { type: 'number', default: '5000', min: 1000, max: 30000 },
      RETRY_COUNT:    { type: 'number', default: '3',    min: 0, max: 10 },
    },
    {
      env: {
        API_BASE_URL: 'https://api.stripe.com/v1',
        API_KEY:      'sk_test_abcdefghijklmnop123456',
        API_TIMEOUT_MS: '10000',
      },
      exitOnFail: false,
    }
  );
  assertEqual(config.API_TIMEOUT_MS, 10000);
  assertEqual(config.RETRY_COUNT, 3);
});

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log('\n  envguard test suite\n  ─────────────────────────────────────────────');
results.forEach(r => {
  const icon = r.status === 'pass' ? '  ✓' : '  ✗';
  const color = r.status === 'pass' ? '\x1b[32m' : '\x1b[31m';
  console.log(`${color}${icon}\x1b[0m  ${r.name}`);
  if (r.error) console.log(`      \x1b[90m↳ ${r.error}\x1b[0m`);
});

console.log(`\n  \x1b[1m${passed} passing\x1b[0m  \x1b[31m${failed} failing\x1b[0m\n`);

if (failed > 0) {
  process.exit(1);
}
