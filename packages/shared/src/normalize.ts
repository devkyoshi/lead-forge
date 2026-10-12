/** Lowercase, strip punctuation/diacritics and common business suffixes. */
export function normalizeName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(the|ltd|llc|inc|co|pvt|private|limited|restaurant|hotel)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function normalizeAddress(address: string): string {
  return address
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\bstreet\b/g, "st")
    .replace(/\broad\b/g, "rd")
    .replace(/\bavenue\b/g, "ave")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Digits only; keeps a leading + as part of a country code. Returns null if too short. */
export function normalizePhone(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7) return null;
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
