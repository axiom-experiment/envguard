/**
 * envguard - Runtime .env Contract Enforcer
 * TypeScript type definitions
 */

export type EnvType = 'string' | 'number' | 'boolean' | 'url' | 'email' | 'enum' | 'json' | 'port';

export interface FieldSpec {
  /** The expected type of the environment variable */
  type?: EnvType;
  /** Whether this variable is required (default: true) */
  required?: boolean;
  /** Default value if not set */
  default?: string | number | boolean;
  /** Human-readable description (used in .env.example output) */
  description?: string;
  /** Minimum length (strings only) */
  minLength?: number;
  /** Maximum length (strings only) */
  maxLength?: number;
  /** Regex pattern (strings only) */
  pattern?: RegExp | string;
  /** Minimum value (numbers only) */
  min?: number;
  /** Maximum value (numbers only) */
  max?: number;
  /** Allowed values (enum only) */
  values?: string[];
  /** Example value for .env.example generation */
  example?: string;
  /** Custom validation function. Return error string or null. */
  validate?: (value: string) => string | null;
}

export type Contract = Record<string, FieldSpec>;

/** Infer the TypeScript type from a FieldSpec */
type InferType<S extends FieldSpec> =
  S['type'] extends 'number' ? number :
  S['type'] extends 'boolean' ? boolean :
  S['type'] extends 'port' ? number :
  S['type'] extends 'json' ? unknown :
  S['type'] extends 'enum' ? (S['values'] extends string[] ? S['values'][number] : string) :
  string;

/** Infer whether a field is optional */
type IsOptional<S extends FieldSpec> =
  S['required'] extends false ? true :
  S['default'] extends undefined ? false :
  true;

/** Infer the full config type from a contract */
export type InferConfig<C extends Contract> = {
  [K in keyof C as IsOptional<C[K]> extends true ? never : K]: InferType<C[K]>
} & {
  [K in keyof C as IsOptional<C[K]> extends true ? K : never]?: InferType<C[K]>
};

export interface CheckResult<C extends Contract> {
  valid: boolean;
  errors: Array<{ key: string; error: string }>;
  config: Partial<InferConfig<C>>;
}

export interface AuditResult {
  passed: string[];
  failed: string[];
  missing: string[];
}

export interface GuardOptions {
  /** Custom env source (default: process.env) */
  env?: Record<string, string | undefined>;
  /** Enable colored terminal output (default: true) */
  color?: boolean;
  /** Call process.exit(1) on failure (default: true) */
  exitOnFail?: boolean;
}

export interface CheckOptions {
  /** Custom env source (default: process.env) */
  env?: Record<string, string | undefined>;
}

export interface AuditOptions {
  /** Custom env source (default: process.env) */
  env?: Record<string, string | undefined>;
  /** Enable colored terminal output (default: true) */
  color?: boolean;
}

/**
 * Validate environment variables against a contract.
 * Returns a frozen, typed config object.
 * Exits the process (or throws) if validation fails.
 *
 * @example
 * const config = guard({
 *   DATABASE_URL: { type: 'url', required: true },
 *   PORT: { type: 'port', default: '3000' },
 *   NODE_ENV: { type: 'enum', values: ['development', 'production'] },
 * });
 * config.PORT // number
 */
export function guard<C extends Contract>(contract: C, options?: GuardOptions): InferConfig<C>;

/**
 * Validate without throwing. Returns a result object.
 *
 * @example
 * const { valid, errors, config } = check({ PORT: { type: 'port' } });
 */
export function check<C extends Contract>(contract: C, options?: CheckOptions): CheckResult<C>;

/**
 * Generate .env.example content from a contract.
 * Writes to stdout and returns the string.
 *
 * @example
 * example({ DATABASE_URL: { type: 'url', description: 'PostgreSQL connection string' } });
 * // DATABASE_URL=https://example.com
 */
export function example(contract: Contract): string;

/**
 * Show current env status without crashing. For debugging.
 *
 * @example
 * audit({ PORT: { type: 'port' }, DATABASE_URL: { type: 'url' } });
 * // prints a table of pass/fail/missing
 */
export function audit(contract: Contract, options?: AuditOptions): AuditResult;
