/**
 * Form primitives for the account surface.
 *
 * The reference has no account forms (its login is a toast), so these are built
 * to the storefront's existing token set — `--red`, `--line`, `--navy`,
 * `--muted`, radius 14 — rather than invented. Every field owns its own error
 * text and `aria-describedby` wiring, because a field that renders an error
 * without associating it is invisible to a screen reader.
 */

'use client';

import { useId, useState } from 'react';

import { cn } from '@/lib/utils';

interface FieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'email' | 'tel' | 'password' | 'number';
  /** Shown under the field when there is no error. */
  hint?: string;
  /** Shown in place of the hint, in the error colour. */
  error?: string;
  placeholder?: string;
  autoComplete?: string;
  required?: boolean;
  disabled?: boolean;
  inputMode?: 'text' | 'numeric' | 'tel' | 'email';
  maxLength?: number;
  /** Renders a show/hide toggle. Only meaningful for `type="password"`. */
  revealable?: boolean;
  showLabel?: string;
  hideLabel?: string;
  onBlur?: () => void;
}

export function Field({
  label,
  value,
  onChange,
  type = 'text',
  hint,
  error,
  placeholder,
  autoComplete,
  required,
  disabled,
  inputMode,
  maxLength,
  revealable,
  showLabel = 'Show',
  hideLabel = 'Hide',
  onBlur,
}: FieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;

  const [revealed, setRevealed] = useState(false);
  const isPassword = type === 'password';
  const resolvedType = isPassword && revealed ? 'text' : type;

  const describedBy = error ? errorId : hint ? hintId : undefined;

  return (
    <div className="acct-field">
      <label htmlFor={id} className="acct-label">
        {label}
        {required && (
          <span aria-hidden="true" className="acct-req">
            *
          </span>
        )}
      </label>

      <div className={cn('acct-input-wrap', error && 'has-error')}>
        <input
          id={id}
          type={resolvedType}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
          placeholder={placeholder}
          autoComplete={autoComplete}
          required={required}
          disabled={disabled}
          inputMode={inputMode}
          maxLength={maxLength}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className="acct-input"
        />

        {isPassword && revealable && (
          <button
            type="button"
            className="acct-reveal"
            onClick={() => setRevealed((prev) => !prev)}
            aria-label={revealed ? hideLabel : showLabel}
            aria-pressed={revealed}
            tabIndex={0}
          >
            {revealed ? hideLabel : showLabel}
          </button>
        )}
      </div>

      {error ? (
        <p id={errorId} className="acct-error" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="acct-hint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

interface SelectFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  disabled?: boolean;
}

export function SelectField({
  label,
  value,
  onChange,
  options,
  placeholder,
  error,
  hint,
  required,
  disabled,
}: SelectFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = error ? errorId : hint ? hintId : undefined;

  return (
    <div className="acct-field">
      <label htmlFor={id} className="acct-label">
        {label}
        {required && (
          <span aria-hidden="true" className="acct-req">
            *
          </span>
        )}
      </label>

      <div className={cn('acct-input-wrap', error && 'has-error')}>
        <select
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          required={required}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className="acct-input acct-select"
        >
          {placeholder && <option value="">{placeholder}</option>}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {error ? (
        <p id={errorId} className="acct-error" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="acct-hint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

interface TextAreaFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  error?: string;
  placeholder?: string;
  rows?: number;
  maxLength?: number;
  required?: boolean;
}

export function TextAreaField({
  label,
  value,
  onChange,
  hint,
  error,
  placeholder,
  rows = 3,
  maxLength,
  required,
}: TextAreaFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = error ? errorId : hint ? hintId : undefined;

  return (
    <div className="acct-field">
      <label htmlFor={id} className="acct-label">
        {label}
        {required && (
          <span aria-hidden="true" className="acct-req">
            *
          </span>
        )}
      </label>

      <div className={cn('acct-input-wrap', error && 'has-error')}>
        <textarea
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          rows={rows}
          maxLength={maxLength}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className="acct-input acct-textarea"
        />
      </div>

      {error ? (
        <p id={errorId} className="acct-error" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="acct-hint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** A form-level error banner — for a failure that is not tied to one field. */
export function FormAlert({
  tone = 'error',
  children,
}: {
  tone?: 'error' | 'success' | 'info';
  children: React.ReactNode;
}) {
  return (
    <div className={cn('acct-alert', `acct-alert-${tone}`)} role="alert">
      {children}
    </div>
  );
}
