/**
 * Slug utilities for generating shell-safe, git-ref-safe identifiers.
 */

/**
 * Convert an arbitrary string into a URL/git-branch-friendly slug.
 *
 * Rules:
 * - Strips diacritics (e.g. "café" → "cafe")
 * - Lowercases
 * - Replaces any run of non-[a-z0-9] characters with a single dash
 * - Trims leading/trailing dashes
 *
 * Throws if the input is not a string or if the resulting slug is empty.
 */
export function slugify(input) {
  if (typeof input !== 'string') {
    throw new TypeError(`slugify: expected string, got ${typeof input}`);
  }

  const slug = input
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (slug.length === 0) {
    throw new Error(`slugify: input produced empty slug (input: ${JSON.stringify(input)})`);
  }

  return slug;
}
