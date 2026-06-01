/**
 * Parse a "provider/model-id" string into providerID and modelID.
 * Splits on the first '/'. When there is no '/', defaults the providerID
 * to an empty string and the modelID to the whole string.
 * Returns null for empty input.
 *
 * @param {string} str - Model identifier, e.g. "opencode-go/deepseek-v4-flash"
 * @returns {{ providerID: string, modelID: string } | null}
 */
export function parseModelId(str) {
  if (!str || typeof str !== 'string') return null;
  const idx = str.indexOf('/');
  if (idx === -1) return { providerID: '', modelID: str };
  return {
    providerID: str.slice(0, idx),
    modelID: str.slice(idx + 1),
  };
}
