---
planId: "b473615c-82bd-4b48-a2b5-4df052bc75fc"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Add skill:{name} slash command support. Skills already exist in src/skills/ with SKILL.md files, and listSkills() already loads them. Pi handles skill invocation by wrapping the markdown content in a &lt;skill&gt; XML block and sending it as a regular user message to the LLM (which then follows the skill's instructions). The model sees it as conversation context, not a special tool call. Implementation needs: (1) populate autocomplete with skill:{name} commands using existing listSkills(), (2) add skill expansion in slash-dispatch similar to Pi's _expandSkillCommand that reads the SKILL.md file and formats it as a &lt;skill&gt; block, (3) send the expanded skill content as a user message to the active agent."
affectedPaths:
    - "src/shared/interactive/slash-dispatch.js"
    - "src/shared/interactive/chat-session.js"
    - "src/shared/session/session.js"
    - "src/skills/"
createdAt: "2026-05-11T00:00:00.000Z"
updatedAt: "2026-07-17T04:40:58.897Z"
status: "verified"
origin: "internal"
workRecord:
    status: "generated"
    recordId: "e2729721-fe76-4b8f-8016-bf2c0a6661f8"
    path: "docs/work-records/2026-07-17-add-skill-slash-commands.md"
    lastAttemptAt: "2026-07-17T04:40:52.144Z"
---

# Add /skill:{name} Slash Command Support

## Context

Harns already has skills in `src/skills/` (diagnose, grill-with-docs, ketch, prototype, improve-codebase-architecture,
write-a-skill) with `SKILL.md` files, and `listSkills()` already loads them for the system prompt. The request is to
expose them as interactive `/skill:{name}` slash commands with autocomplete — matching Pi's convention (Pi expands
`/skill:diagnose` to a `<skill>` XML block sent as a user message to the LLM).

## Objective

1. Autocomplete shows skills as `skill:{name}` alongside existing built-in commands and prompt templates.
2. When user submits `/skill:{name} [args]`, read its `SKILL.md`, strip frontmatter, wrap in
   `<skill name="..." location="...">...</skill>` XML, and append optional user instructions.
3. Send the expanded skill content as a user message via `runAgentSession()` (transient agent session, same as prompt
   templates).

## Approach

Modeled after Pi's `_expandSkillCommand()` in `agent-session.ts` (reference):

```ts
// Pi's expansion format:
// 1. Parse: split on first space → skillName + args
// 2. Lookup: find skill by name in resourceLoader.getSkills().skills
// 3. Read: readFileSync(skill.filePath, "utf-8")
// 4. Strip: stripFrontmatter(content).trim()
// 5. Format: <skill name="..." location="...">\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>
// 6. Append: if args exist, append "\n\n${args}" after the skill block
```

## Files to Modify

| File                                       | Change                                                                                            |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `src/shared/interactive/chat-session.js`   | Fetch skills, add to autocomplete provider, pass skills list to `handleSlashCommand`              |
| `src/shared/interactive/slash-dispatch.js` | Add `SkillMeta` type, `skill:` prefix check in `handleSlashCommand()`, `dispatchSkill()` function |
| `src/shared/session/session.js`            | Add `expandSkillCommand()` helper (mirrors Pi's implementation)                                   |

## Detailed Implementation Steps

### Step 1 — Add `expandSkillCommand()` helper (`session.js`)

Add a new exported function at the end of `session.js` (before `getFilePathForTool`):

```js
/**
 * Expand a /skill:{name} command into an XML <skill> block.
 * Modeled after Pi's _expandSkillCommand() in agent-session.ts.
 *
 * @param {string} skillName
 * @param {string} [additionalInstructions]
 * @returns {Promise<string>} Formatted skill block string
 */
export async function expandSkillCommand(skillName, additionalInstructions) {
    const skills = await listSkills();
    const skill = skills.find((s) => s.name === skillName);
    if (!skill) {
        throw new Error(`Unknown skill: ${skillName}`);
    }

    try {
        const raw = await Deno.readTextFile(skill.path);
        let body = raw;

        // Strip YAML frontmatter if present
        if (hasFrontMatter(raw)) {
            body = extractYaml(raw).body;
        }
        body = body.trim();

        // Build the XML block (matches Pi's format exactly)
        const skillBlock = `<skill name="${skill.name}" location="${skill.path}">\nReferences are relative to ${
            skill.path.replace(/\/SKILL\.md$/, "")
        }.\n\n${body}\n</skill>`;

        // Append user instructions after the skill block
        if (additionalInstructions) {
            return `${skillBlock}\n\n${additionalInstructions}`;
        }
        return skillBlock;
    } catch (err) {
        throw new Error(`Failed to read skill "${skill.name}": ${err.message}`);
    }
}
```

### Step 2 — Add skills to autocomplete (`chat-session.js`)

In `startInteractiveSession()`, after the prompt templates are fetched (around line 354):

```js
// Load skills metadata once per interactive session.
const skills = await listSkills();
```

Then add skills to the `CombinedAutocompleteProvider` (around line 380), after the prompt template entries:

```js
const autocompleteProvider = new CombinedAutocompleteProvider(
    [
        ...Array.from(CHAT_BUILTIN_SLASH_NAMES).map((name) => {
            return {
                name,
                description: commandRegistry[name].description,
                getArgumentCompletions: commandRegistry[name].getArgumentCompletions,
            };
        }),
        ...invokablePromptTemplates.map((template) => ({
            name: template.name,
            argumentHint: template.argumentHint,
            description: template.description,
        })),
        // ── Skill commands ──
        ...skills
            .filter((skill) => skill.description && skill.description !== "No description provided")
            .map((skill) => ({
                name: `skill:${skill.name}`,
                description: skill.description,
            })),
    ],
    Deno.cwd(),
    "fd",
);
```

Pass the skills list to `handleSlashCommand()` (around line 515, where `handleSlashCommand` is called):

```js
const handledSlash = await handleSlashCommand({
    userRequest,
    savedImages,
    uiAPI,
    editor,
    tui,
    sessionStartedAt,
    originalHandleInput,
    builtinNames: CHAT_BUILTIN_SLASH_NAMES,
    promptTemplateByName,
    skills, // ← NEW: pass skills list
    chatPromptAgentName: CHAT_PROMPT_AGENT_NAME,
    resolveTemplateModel,
    setActiveAgent,
    applyPendingRootSwap,
    generationGuard,
    registerOperationCancel: (cancel) => {
        activeOperationCancel = cancel;
    },
});
```

### Step 3 — Update `SlashContext` and add skill dispatch (`slash-dispatch.js`)

Add `SkillMeta` type and `skills` field to `SlashContext` typedef:

```js
/**
 * @typedef {Object} SkillMeta
 * @property {string} name
 * @property {string} description
 * @property {string} path
 * @property {"local" | "home" | "bundled"} source
 */

/**
 * @typedef {Object} SlashContext
 * // ... existing fields ...
 * @property {SkillMeta[]} skills
 */
```

Add skill dispatch in `handleSlashCommand()`, after the template check (around line 55):

```js
// Skill commands (/skill:{name})
if (command.startsWith("skill:")) {
    const skillName = command.slice(6);
    const skill = ctx.skills.find((s) => s.name === skillName);
    if (skill) {
        await dispatchSkill(ctx, skill, args.join(" "), thisGen);
        return true;
    }
    // Skill name doesn't match any known skill → fall through to unknown command
}
```

Add the `dispatchSkill()` function:

```js
/**
 * @param {SlashContext} ctx
 * @param {SkillMeta} skill
 * @param {string} additionalInstructions
 * @param {number} thisGen
 */
async function dispatchSkill(ctx, skill, additionalInstructions, thisGen) {
    const {
        uiAPI,
        savedImages,
        chatPromptAgentName,
        generationGuard,
    } = ctx;

    try {
        const expandedText = await expandSkillCommand(skill.name, additionalInstructions || undefined);

        uiAPI.appendUserMessage?.(expandedText);
        savedImages.forEach((img) => {
            if (uiAPI.appendImage) uiAPI.appendImage(img.base64, img.mimeType);
        });

        await runAgentSession({
            agentName: chatPromptAgentName,
            userRequest: expandedText,
            images: savedImages,
            uiAPI,
            sessionManager: getRootSessionManager() || undefined,
        });
    } catch (err) {
        if (generationGuard.isCurrent(thisGen)) {
            uiAPI.appendSystemMessage(
                `Error: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
    }
}
```

Add the import for `expandSkillCommand` at the top:

```js
import { abortActiveSession, expandSkillCommand, runAgentSession } from "../session/session.js";
```

## Verification Plan

### Automated

- Run `deno run ci` — ensure no test regressions

### Manual flow

1. Start `hns` interactively
2. Type `/` — verify skills appear as `skill:diagnose`, `skill:ketch`, `skill:prototype`, etc. in autocomplete
3. Type `/skill:diagnose` and press Enter — verify the agent receives the skill XML and follows the instructions
4. Type `/skill:diagnose "my bug"` — verify the bug description is appended after the skill block
5. Type `/skill:nonexistent` — verify "Unknown command: /skill:nonexistent" message (no crash)

## Edge Cases & Considerations

- **Unknown skill name**: `command.startsWith("skill:")` matches but no skill found → falls through to the
  `Unknown command:` fallback in the existing code
- **Unreadable SKILL.md file**: `expandSkillCommand()` wraps the error and `dispatchSkill()` catches it, showing an
  error message via `uiAPI.appendSystemMessage()` — session stays healthy
- **Skills with no description**: Filtered out from autocomplete (consistent with prompt template behavior in
  boot-banner)
- **Skill / template name collision**: Prompt template check comes first in `handleSlashCommand()` — templates take
  priority over skills with the same name
- **Bundled skills extraction**: `listSkills()` calls `extractBundledSkills()` internally, so bundled skills (from
  `src/skills/`) are properly extracted to `~/.hns/bundled-skills/` on first use
- **Multiple skills**: Each skill is a separate autocomplete entry; no combined `/skills` command needed
