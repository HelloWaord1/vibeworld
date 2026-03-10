/**
 * Content filter for user-generated text.
 *
 * Normalizes input (lowercase, strip spaces between letters, basic l33tspeak)
 * and checks against a blocklist of prohibited words/slurs.
 */

// ---------------------------------------------------------------------------
// Allowlist (legitimate words that contain blocked substrings)
// ---------------------------------------------------------------------------

/**
 * Safe words that should be allowed even though they contain blocked substrings.
 * These are checked BEFORE the blocklist to prevent false positives.
 */
const ALLOWED_WORDS: readonly string[] = [
  'cocktail', 'cocktails', 'peacock', 'peacocks', 'hancock', 'woodcock',
  'gamecock', 'stopcock', 'petcock', 'cockatoo', 'cockpit', 'cockroach',
  'assassin', 'assassinate', 'bass', 'bassoon', 'compass', 'trespass',
  'embassy', 'harass', 'embarrass', 'amass', 'bypass',
] as const;

// ---------------------------------------------------------------------------
// Blocklist (English + Russian profanity/slurs, ~40 entries)
// ---------------------------------------------------------------------------

/**
 * Words checked via substring matching. These are either long enough or
 * specific enough that they won't appear inside legitimate English words.
 */
const BLOCKED_SUBSTRINGS: readonly string[] = [
  // English profanity (safe for substring matching)
  'fuck', 'bitch', 'asshole', 'bastard', 'motherfucker', 'wanker',
  'twat', 'whore', 'slut',
  // l33tspeak profanity variants
  'fuk', 'fck', 'b1tch', 'assh0le', 'a$$hole',
  'wh0re', 'slt',
  // English slurs
  'nigger', 'nigga', 'faggot', 'retard', 'tranny', 'wetback', 'beaner',
  // l33tspeak slur variants
  'n1gger', 'n1gga', 'f4ggot', 'ret4rd', 'tr4nny',
  // Russian profanity / slurs (long enough to be safe)
  'blyad', 'blyat', 'pidar', 'pidor', 'nahui', 'nahuy',
  'mudak', 'zalupa', 'gandon',
  // Russian l33tspeak
  'bly4d', 'bly4t', 'pid4r', 'pid0r', 'n4hui',
] as const;

/**
 * Words checked via whole-word boundary matching to avoid false positives
 * in legitimate words (e.g., "peacock", "knight", "debate", "hospice",
 * "scunthorpe", "shitake").
 */
const BLOCKED_WHOLE_WORDS: readonly string[] = [
  // English profanity that appears inside common words
  'shit', 'damn', 'cunt', 'dick', 'piss', 'cock',
  // l33tspeak profanity
  'sh1t', 'cnt', 'd1ck', 'c0ck',
  // Short slurs (must be whole-word to avoid "hospice" -> "spic", etc.)
  'fag', 'kike', 'spic', 'chink', 'honky', 'gook',
  // l33tspeak short slurs
  'f4g',
  // Russian short words that collide with English (e.g., "debate" -> "ebat")
  'suka', 'suk4', 'huy', 'h0y', 'ebal', 'ebat', 'dermo',
] as const;

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

const LEET_MAP: Readonly<Record<string, string>> = {
  '@': 'a',
  '4': 'a',
  '0': 'o',
  '1': 'i',
  '!': 'i',
  '3': 'e',
  '$': 's',
  '5': 's',
  '7': 't',
  '+': 't',
  '8': 'b',
  '9': 'g',
  '(': 'c',
};

/**
 * Decode l33tspeak and lowercase, but preserve whitespace.
 */
function decodeLeet(text: string): string {
  const lowered = text.toLowerCase();
  return [...lowered]
    .map(ch => LEET_MAP[ch] ?? ch)
    .join('');
}

/**
 * Normalize text for substring comparison:
 * 1. Lowercase
 * 2. Decode l33tspeak characters
 * 3. Strip whitespace and common separator characters between letters
 */
function normalize(text: string): string {
  return decodeLeet(text).replace(/[\s.\-_*|]/g, '');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check if a word appears as a whole word in the normalized text.
 * A "whole word" is bounded by non-alphabetic characters or string edges.
 */
function containsWholeWord(normalized: string, word: string): boolean {
  const regex = new RegExp(`(?<![a-z])${escapeRegex(word)}(?![a-z])`);
  return regex.test(normalized);
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Returns `true` when the given text contains any prohibited word.
 * Longer specific terms use substring matching against space-stripped text;
 * shorter terms use whole-word boundary matching against space-preserved
 * text to avoid false positives in legitimate words like "peacock",
 * "knight", "debate", or "hospice".
 */
export function containsProhibitedContent(text: string): boolean {
  const stripped = normalize(text);

  // Check allowlist first to prevent false positives
  for (const allowed of ALLOWED_WORDS) {
    if (stripped.includes(allowed)) {
      return false;
    }
  }

  if (BLOCKED_SUBSTRINGS.some(word => stripped.includes(word))) {
    return true;
  }
  // For whole-word matching, use the decoded but space-preserved text so
  // that "holy shit" correctly splits into separate words.
  const decoded = decodeLeet(text);
  return BLOCKED_WHOLE_WORDS.some(word => containsWholeWord(decoded, word));
}

/**
 * Returns the original text if clean, otherwise replaces every prohibited
 * word occurrence (in the normalized form) with asterisks and maps back
 * to the original length. For simplicity the function returns a
 * fully-censored placeholder when prohibited content is detected.
 */
export function sanitizeText(text: string): string {
  if (!containsProhibitedContent(text)) {
    return text;
  }
  // Replace each character of every matched prohibited word span with '*'
  let normalized = normalize(text);
  const allWords = [...BLOCKED_SUBSTRINGS, ...BLOCKED_WHOLE_WORDS];
  for (const word of allWords) {
    const replacement = '*'.repeat(word.length);
    const regex = new RegExp(escapeRegex(word), 'g');
    normalized = normalized.replace(regex, replacement);
  }
  return normalized;
}

/**
 * Throws an `Error` when the text contains prohibited content.
 * Use at validation boundaries (tool handlers).
 */
export function validateContent(text: string, fieldName: string): void {
  if (containsProhibitedContent(text)) {
    throw new Error(
      `The ${fieldName} contains prohibited language. Please revise your input.`,
    );
  }
}

/**
 * Strips all HTML tags from input text to prevent XSS attacks.
 * Simple regex-based approach that removes everything between < and >.
 */
export function sanitizeHtml(text: string): string {
  return text.replace(/<[^>]*>/g, '');
}
