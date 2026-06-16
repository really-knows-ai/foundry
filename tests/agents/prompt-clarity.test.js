import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const AGENTS_DIR = join(REPO_ROOT, 'src', 'agents');

const ALL_AGENTS = [
  'foundry-guide',
  'foundry-admin',
  'foundry-forge',
  'foundry-appraise',
  'foundry-assay',
];

function readAgent(name) {
  return readFileSync(join(AGENTS_DIR, `${name}.md`), 'utf8');
}

function parseFrontmatter(text) {
  return matter(text);
}

function getBody(text) {
  const parsed = matter(text);
  return parsed.content;
}

/**
 * Return lines from the body, excluding fenced code blocks.
 */
function getNonCodeLines(body) {
  const lines = body.split('\n');
  const result = [];
  let inFence = false;
  for (const line of lines) {
    if (/^```/.test(line.trim())) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) result.push(line);
  }
  return result;
}

describe('prompt clarity — role definition', () => {
  for (const name of ALL_AGENTS) {
    test(`${name} states its role in one clear paragraph`, () => {
      const text = readAgent(name);
      const body = getBody(text);
      // The role section must exist. Look for a "## Your role" heading
      // and check it is followed by text within the same section.
      const roleMatch = body.match(/## Your role\s*\n\n(.+?)(?:\n\n|##)/s);
      assert.ok(
        roleMatch,
        `${name} must have a "## Your role" section with a description`
      );
      const roleText = roleMatch[1].trim();
      assert.ok(
        roleText.length > 0,
        `${name} role section must contain text`
      );
      // Role paragraph should be no more than a few sentences — one paragraph.
      // A paragraph with more than 10 lines likely spans multiple paragraphs.
      const roleLines = roleText.split('\n');
      assert.ok(
        roleLines.length <= 10,
        `${name} role section should be one paragraph (got ${roleLines.length} lines)`
      );
    });

    test(`${name} role states what the agent does affirmatively`, () => {
      const text = readAgent(name);
      const body = getBody(text);
      const roleMatch = body.match(/## Your role\s*\n\n(.+?)(?:\n\n|##)/s);
      assert.ok(roleMatch, `${name} must have a "## Your role" section`);
      const roleText = roleMatch[1];
      // The role should describe the agent in affirmative terms:
      // "You manage...", "You produce...", "You evaluate...", "You run..."
      // Cast the description in the positive, not by what the agent avoids.
      // The role description should start with a verb that captures
      // the agent's responsibility. Some role sections cast the
      // description in the second person, others state the action
      // directly. Both forms are affirmative.
      const affirmativePatterns = [
        /^You (manage|produce|evaluate|run|execute|guide|generate|revise)/i,
        /^(Generate|Produce|Evaluate|Execute|Guide|Run|Revise|Manage)/,
      ];
      const matchesAffirmative = affirmativePatterns.some(p => p.test(roleText));
      assert.ok(
        matchesAffirmative,
        `${name} role must describe what the agent does affirmatively (got: "${roleText.slice(0, 80)}...")`
      );
    });
  }
});

describe('prompt clarity — tool permissions match the stated role', () => {
  for (const name of ALL_AGENTS) {
    test(`${name} permissions align with its role responsibilities`, () => {
      const text = readAgent(name);
      const parsed = parseFrontmatter(text);
      const permissions = parsed.data.permission || {};
      const body = getBody(text);

      // Every agent with bash: deny should not instruct the agent to call
      // shell commands or present bash as an available workflow tool.
      if (permissions.bash === 'deny') {
        const lines = getNonCodeLines(body);
        for (const line of lines) {
          // Allow "bash: deny" in a tool-permissions listing but not
          // active instructions that present bash as available.
          const activeBash = /\b(?:shell access|use bash|run bash|call bash)\b/i;
          if (activeBash.test(line)) {
            const isProhibition = /denied|deny|must not|not available|not permitted/i.test(line);
            assert.ok(
              isProhibition,
              `${name} prompt must not present bash as an active tool: "${line.trim()}"`
            );
          }
        }
      }

      // Agents without foundry_git_branch: allow must not reference the tool
      // as something they would call.
      if (permissions.foundry_git_branch !== 'allow') {
        assert.ok(
          !body.includes('foundry_git_branch'),
          `${name} must not contain foundry_git_branch when not permitted`
        );
      }

      // Agents without foundry_git_finish: allow must not reference the tool
      // as something they would call.
      if (permissions.foundry_git_finish !== 'allow') {
        assert.ok(
          !body.includes('foundry_git_finish'),
          `${name} must not contain foundry_git_finish when not permitted`
        );
      }
    });
  }
});

describe('prompt clarity — no unavailable tool instructions', () => {
  for (const name of ALL_AGENTS) {
    test(`${name} does not instruct calling tools it does not have permission for`, () => {
      const text = readAgent(name);
      const parsed = parseFrontmatter(text);
      const permissions = parsed.data.permission || {};
      const body = getBody(text);
      const nonCodeLines = getNonCodeLines(body);

      // A list of known foundry_ tools. If a tool is mentioned outside
      // a code fence and is not in the agent's permissions as "allow",
      // flag it as an instruction to call an unavailable tool.
      const knownFoundryTools = [
        'foundry_git_branch',
        'foundry_git_finish',
        'foundry_cycle_run',
        'foundry_cycle_continue',
        'foundry_stage_begin',
        'foundry_stage_end',
        'foundry_stage_retry',
        'foundry_config_write_file',
        'foundry_config_add_dependency',
        'foundry_config_git_log',
        'foundry_config_run_validator',
        'foundry_config_run_validator_test',
        'foundry_assay_run',
      ];

      for (const line of nonCodeLines) {
        for (const tool of knownFoundryTools) {
          if (line.includes(tool)) {
            const isPermitted = permissions[tool] === 'allow';
            const isInToolTable = /^\|/.test(line.trim());
            // Exclude tool references in markdown tables that describe
            // available tool lists, and references in code fences (already excluded).
            if (!isPermitted && !isInToolTable) {
              // Check if this is describing a prohibition or constraint
              const isProhibition = /must not|prohibit|not (have|permitted|available)|removed|refuse/i.test(line);
              assert.ok(
                isProhibition,
                `${name} must not instruct use of "${tool}" without permission: "${line.trim()}"`
              );
            }
          }
        }
      }
    });
  }
});

describe('prompt clarity — no pseudo-tool call syntax in prose', () => {
  for (const name of ALL_AGENTS) {
    test(`${name} does not contain pseudo-tool call syntax`, () => {
      const text = readAgent(name);
      const body = getBody(text);
      const nonCodeLines = getNonCodeLines(body);

      // Pseudo-tool calls are tool-like syntax embedded in narrative
      // prose that the model might copy verbatim into a user-facing
      // response. The problematic patterns are:
      //   - task({ agent: "foundry-admin" }) — pseudo-call in prose
      //   - writeFile(...) — pseudo-call in prose
      //
      // Legitimate patterns that are NOT pseudo-calls:
      //   - Numbered step-by-step tool API docs (e.g. "1. Call `toolName({...})`")
      //   - Tool signatures in markdown tables
      //   - Tool names inside backticks (these are precise references)
      //
      // We look for bare tool-call patterns outside numbered lists and
      // backtick-delimited references.
      const pseudoCallPatterns = [
        /\btask\(\{/,         // task({ — pseudo delegation call
        /\bwriteFile\(/,      // writeFile( — pseudo file write call
      ];

      for (const line of nonCodeLines) {
        // Skip numbered list items that document tool APIs
        if (/^\s*\d+\.\s/.test(line)) continue;
        // Skip lines where the pseudo-call is inside backticks
        const stripped = line.replace(/`[^`]+`/g, '');
        for (const pattern of pseudoCallPatterns) {
          if (pattern.test(stripped)) {
            const isToolTable = /^\s*\|/.test(line);
            if (!isToolTable) {
              assert.fail(
                `${name} must not include pseudo-tool call syntax in prose: "${line.trim()}"`
              );
            }
          }
        }
      }
    });
  }
});

describe('prompt clarity — stop conditions are stated', () => {
  for (const name of ALL_AGENTS) {
    test(`${name} states when to stop and report a blocker`, () => {
      const text = readAgent(name);
      const body = getBody(text);

      // All agents should have some form of stop-or-report guidance.
      // The exact language varies by agent role. Auto-dispatched
      // stage agents (forge, appraise, assay) communicate blockers
      // through the stage lifecycle and dispatch prompt rather than
      // direct user reporting.
      const isAutoDispatched = name === 'foundry-forge' ||
        name === 'foundry-appraise' ||
        name === 'foundry-assay';

      const stopPatterns = [
        /(stop|report).*(error|blocker|failure|violation|issue)/i,
        /if.*(error|fail|block).*(stop|report)/i,
        /(error|failure|violation).*(stop|report)/i,
        /must not.*(continue|proceed).*(without|unless)/i,
      ];

      const hasStopCondition = stopPatterns.some(pattern => pattern.test(body));

      // Auto-dispatched agents may use alternative patterns: they
      // follow the dispatch prompt and the stage lifecycle, which
      // handles blocker propagation implicitly.
      const lifecyclePatterns = [
        /foundry_stage_end/,
        /stage lifecycle/,
        /dispatch prompt/i,
      ];
      const hasLifecycleGuidance = lifecyclePatterns.some(p => p.test(body));

      const ok = isAutoDispatched
        ? hasStopCondition || hasLifecycleGuidance
        : hasStopCondition;

      assert.ok(
        ok,
        `${name} prompt must state when to stop and report a blocker`
      );
    });
  }
});

describe('prompt clarity — user-facing vs delegated decisions', () => {
  for (const name of ALL_AGENTS) {
    test(`${name} distinguishes user-facing decisions from delegated execution`, () => {
      const text = readAgent(name);
      const body = getBody(text);

      if (name === 'foundry-guide') {
        // The guide distinguishes user-facing decisions (wizard protocol,
        // user confirmation before delegating) from delegated execution
        // (admin task delegation, auto-dispatched sub-agents).
        const delegationPatterns = [
          /user confirm/i,
          /ask.*question/i,
          /delegate.*(admin|task)/i,
          /user.*(proceed|confirm|approve)/i,
        ];
        const hasDelegationDistinction = delegationPatterns.some(p => p.test(body));
        assert.ok(
          hasDelegationDistinction,
          'guide prompt must distinguish user-facing decisions from delegated execution'
        );
      } else if (name === 'foundry-admin') {
        // Admin operates entirely through delegation from guide.
        // The prompt should make clear that admin decisions are execution
        // decisions, not user-facing workflow choices.
        assert.ok(
          body.includes('invoked via `task`') || body.includes('guide agent'),
          'admin prompt must state it is invoked via delegation from the guide'
        );

        // Admin should not present itself as making user-facing decisions.
        // Instead it executes the spec and reports results.
        const userFacingPhrases = [
          /ask the user/i,
          /present.*option/i,
          /would you like/i,
        ];
        for (const phrase of userFacingPhrases) {
          assert.ok(
            !phrase.test(body),
            `admin prompt must not present user-facing decision language: "${phrase.source}"`
          );
        }
      } else if (name === 'foundry-forge') {
        // Forge is auto-dispatched by the flow execution system.
        // Its decisions follow the dispatch prompt.
        assert.ok(
          body.includes('dispatch prompt') || body.includes('auto-dispatched') ||
            body.includes('auto-dispatched'),
          'forge prompt must state it follows the dispatch prompt or is auto-dispatched'
        );
      } else if (name === 'foundry-appraise') {
        // Appraise is auto-dispatched by the flow execution system.
        // Its decisions follow the dispatch prompt.
        assert.ok(
          body.includes('dispatch prompt') || body.includes('auto-dispatched') ||
            body.includes('dispatching') || body.includes('provided'),
          'appraise prompt must state it follows the dispatch prompt or is auto-dispatched'
        );
      } else if (name === 'foundry-assay') {
        // Assay is auto-dispatched by the flow execution system.
        // Its decisions follow the dispatch prompt.
        assert.ok(
          body.includes('dispatch prompt') || body.includes('auto-dispatched') ||
            body.includes('dispatching') || body.includes('provided'),
          'assay prompt must state it follows the dispatch prompt or is auto-dispatched'
        );
      }
    });
  }
});

describe('prompt clarity — frontmatter completeness', () => {
  for (const name of ALL_AGENTS) {
    test(`${name} has a non-empty description in frontmatter`, () => {
      const text = readAgent(name);
      const parsed = parseFrontmatter(text);
      assert.ok(
        parsed.data.description && parsed.data.description.length > 0,
        `${name} frontmatter must have a non-empty description`
      );
    });

    test(`${name} frontmatter has a permission section`, () => {
      const text = readAgent(name);
      const parsed = parseFrontmatter(text);
      assert.ok(
        parsed.data.permission && typeof parsed.data.permission === 'object',
        `${name} frontmatter must have a permission section`
      );
    });
  }
});
