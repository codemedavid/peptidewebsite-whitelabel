import type { SignUpGender } from "@contract";

/**
 * Client copies of the server's sign-up rules (src/lib/mobile/sign-up-details.ts
 * and lib/storefront/customer-account.ts). The server re-checks everything;
 * these only keep the Create account button honest.
 */

export const PASSWORD_MIN = 8;
export const AGE_MIN = 18;
const AGE_DIGITS_MAX = 3;
const PHONE_DIGITS_MIN = 7;

/** null = "Prefer not to say" — gender is optional. */
export const GENDER_OPTIONS: readonly { key: SignUpGender | null; label: string }[] = [
  { key: "female", label: "Female" },
  { key: "male", label: "Male" },
  { key: "other", label: "Other" },
  { key: null, label: "Prefer not to say" },
];

/** Keep only digits as the age is typed (paste-safe), max 3. */
export const ageInput = (v: string): string => v.replace(/\D/g, "").slice(0, AGE_DIGITS_MAX);

export const phoneLooksComplete = (v: string): boolean => v.replace(/\D/g, "").length >= PHONE_DIGITS_MIN;

export const ageTooYoung = (age: string): boolean => age.length > 0 && Number(age) < AGE_MIN;
