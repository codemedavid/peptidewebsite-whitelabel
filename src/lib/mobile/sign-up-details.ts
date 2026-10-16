import type { Parsed } from "@/lib/storefront/customer-account";
import type { SignUpGender } from "./contract";

/**
 * The personal details the app's create-account screen asks for, on top of the
 * website's sign-up (email + password, parsed by parseCustomerSignUp): first
 * and last name, mobile number and age are required; gender is optional.
 * Pure — no DB, no I/O. Gate: npm run test:signup-details.
 *
 * The app mirrors SIGN_UP_AGE_MIN and SIGN_UP_GENDERS
 * (mobile/src/features/session/sign-up/rules.ts).
 */

/** Matches the privacy policy: the Services are for adults 18 and over. */
export const SIGN_UP_AGE_MIN = 18;
const SIGN_UP_AGE_MAX = 120;
export const SIGN_UP_GENDERS: readonly SignUpGender[] = ["female", "male", "other"];
/** Each part stays short enough that "first last" fits the 80-char customer name. */
const NAME_PART_MAX = 39;
const PHONE_MAX = 40;
const PHONE_DIGITS_MIN = 7;
const PHONE_DIGITS_MAX = 15;

export type SignUpDetails = {
  firstName: string;
  lastName: string;
  /** "first last" — the customer's name everywhere it is shown. */
  name: string;
  phone: string;
  age: number;
  gender: SignUpGender | null;
};

const text = (v: unknown): string => (typeof v === "string" ? v : "");
const namePart = (v: unknown): string => text(v).trim().replace(/\s+/g, " ").slice(0, NAME_PART_MAX);

function parseAge(v: unknown): Parsed<number> {
  const raw = typeof v === "number" ? String(v) : text(v).trim();
  if (!raw) return { ok: false, error: "Please enter your age." };
  if (!/^\d{1,3}$/.test(raw)) return { ok: false, error: "Please enter a valid age." };
  const age = Number(raw);
  if (age > SIGN_UP_AGE_MAX) return { ok: false, error: "Please enter a valid age." };
  if (age < SIGN_UP_AGE_MIN) return { ok: false, error: `You must be at least ${SIGN_UP_AGE_MIN} to create an account.` };
  return { ok: true, value: age };
}

function parsePhone(v: unknown): Parsed<string> {
  const phone = text(v).trim().slice(0, PHONE_MAX);
  if (!phone) return { ok: false, error: "Please enter your mobile number." };
  const digits = phone.replace(/\D/g, "").length;
  // Digits plus the usual separators only: "+63 (917) 555-0101" yes, words no.
  if (!/^[\d\s()+.-]+$/.test(phone) || digits < PHONE_DIGITS_MIN || digits > PHONE_DIGITS_MAX) {
    return { ok: false, error: "Please enter a valid mobile number." };
  }
  return { ok: true, value: phone };
}

function parseGender(v: unknown): Parsed<SignUpGender | null> {
  const raw = text(v).trim();
  if (!raw) return { ok: true, value: null };
  const gender = SIGN_UP_GENDERS.find((g) => g === raw);
  return gender ? { ok: true, value: gender } : { ok: false, error: "Please choose a gender from the list, or leave it blank." };
}

export function parseSignUpDetails(input: unknown): Parsed<SignUpDetails> {
  const o = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const firstName = namePart(o.firstName);
  const lastName = namePart(o.lastName);
  if (!firstName) return { ok: false, error: "Please enter your first name." };
  if (!lastName) return { ok: false, error: "Please enter your last name." };
  const phone = parsePhone(o.phone);
  if (!phone.ok) return phone;
  const age = parseAge(o.age);
  if (!age.ok) return age;
  const gender = parseGender(o.gender);
  if (!gender.ok) return gender;
  return {
    ok: true,
    value: { firstName, lastName, name: `${firstName} ${lastName}`, phone: phone.value, age: age.value, gender: gender.value },
  };
}
