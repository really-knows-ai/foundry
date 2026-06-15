// scripts/lib/command-parser.js
//
// Command-string scanner and parser for the Foundry config command runner.
// Splits a command string into an argv array with shell-like quoting rules,
// rejecting shell features such as pipes, redirects, glob patterns, and
// command substitution.

const SINGLE_CHAR_SHELL = {
  '|': 'pipe |',
  ';': 'semicolon ;',
  '`': 'backtick',
  '\n': 'newline (command chaining)',
  '\r': 'carriage return',
  '*': 'glob pattern',
  '?': 'glob pattern',
  '[': 'glob bracket expression',
  ']': 'glob bracket expression',
  '>': 'redirect >',
  '<': 'redirect <',
};

const TWO_CHAR_FEATURES = {
  '$(': 'command substitution $(',
  '&&': '&&',
};

// ---------------------------------------------------------------------------
// parseCommand helpers
// ---------------------------------------------------------------------------

function shellError(feature) {
  return { ok: false, error: `shell feature not allowed: ${feature}`, reason: 'shell_feature_denied' };
}

function isEmptyCommand(command) {
  return !command || command.trim() === '';
}

function checkFeature(ch, next) {
  const msg = SINGLE_CHAR_SHELL[ch];
  if (msg) return msg;
  if (next === undefined) return null;
  return TWO_CHAR_FEATURES[ch + next] || null;
}

function isRedirectToken(token) {
  return /^>|^<|^\d+>|^\d+<|^&>|^&</.test(token);
}

function rejectRedirects(argv) {
  for (const token of argv) {
    if (isRedirectToken(token)) return shellError(`redirect '${token}'`);
  }
  return null;
}

function rejectFirstEnvAssign(argv) {
  if (argv.length > 0) {
    if (/^[A-Za-z_]\w*=/.test(argv[0])) return shellError('environment assignment');
  }
  return null;
}

function handleInSingle(ch, state) {
  if (ch === "'") { state.inSingle = false; return; }
  state.current += ch;
}

function handleInDouble(ch, state) {
  if (ch === '"') { state.inDouble = false; }
  else if (ch === '\\') { state.escaped = true; }
  else { state.current += ch; }
}

function handleStatefulChar(ch, state) {
  if (state.escaped) { state.current += ch; state.escaped = false; return true; }
  if (state.inSingle) { handleInSingle(ch, state); return true; }
  if (state.inDouble) { handleInDouble(ch, state); return true; }
  return false;
}

function handleQuoteChar(ch, state) {
  if (ch === '\\') { state.escaped = true; return true; }
  if (ch === "'") { state.inSingle = true; return true; }
  if (ch === '"') { state.inDouble = true; return true; }
  return false;
}

function handleWhitespace(ch, state) {
  if (!/\s/.test(ch)) return false;
  if (state.current) { state.argv.push(state.current); state.current = ''; }
  return true;
}

function advanceChar(ch, next, state) {
  if (handleStatefulChar(ch, state)) return null;
  if (handleQuoteChar(ch, state)) return null;

  const feature = checkFeature(ch, next);
  if (feature) return shellError(feature);

  if (handleWhitespace(ch, state)) return null;

  state.current += ch;
  return null;
}

function scanTokens(command) {
  const state = { argv: [], current: '', inSingle: false, inDouble: false, escaped: false };

  for (let i = 0; i < command.length; i++) {
    const err = advanceChar(command[i], command[i + 1], state);
    if (err) return err;
  }

  if (state.current) state.argv.push(state.current);
  return state.argv;
}

/**
 * Parse a command string into an argv array using shell-like quoting rules.
 * Rejects shell features with a structured error reason.
 *
 * @param {string} command - Raw command string
 * @returns {{ ok: true, argv: string[] } | { ok: false, error: string, reason: string }}
 */
export function parseCommand(command) {
  if (isEmptyCommand(command)) {
    return { ok: false, error: 'command string is empty', reason: 'empty_command' };
  }

  const argv = scanTokens(command);
  if (!Array.isArray(argv)) return argv;

  const bad = rejectRedirects(argv);
  if (bad) return bad;

  const envBad = rejectFirstEnvAssign(argv);
  return envBad || { ok: true, argv };
}
