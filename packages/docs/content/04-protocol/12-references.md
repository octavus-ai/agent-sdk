---
title: References
description: Using references for on-demand context loading in agents.
---

# References

References are markdown documents that agents can fetch on demand. Instead of loading everything into the system prompt upfront, references let the agent decide what context it needs and load it when relevant.

## Overview

References are useful for:

- **Large context** — Documents too long to include in every system prompt
- **Selective loading** — Let the agent decide which context is relevant
- **Shared knowledge** — Reusable documents across threads

### How References Work

1. **Definition**: Reference files live in the `references/` directory alongside your agent
2. **Configuration**: List available references in `agent.references` or `start-thread.references`
3. **Discovery**: The agent sees reference names and descriptions in its system prompt
4. **Fetching**: The agent calls reference tools to read the full content when needed

## Creating References

Each reference is a markdown file with YAML frontmatter in the `references/` directory:

```
my-agent/
├── settings.json
├── protocol.yaml
├── prompts/
│   └── system.md
└── references/
    ├── api-guidelines.md
    └── error-codes.md
```

### Reference Format

```markdown
---
description: >
  API design guidelines including naming conventions,
  error handling patterns, and pagination standards.
---

# API Guidelines

## Naming Conventions

Use lowercase with dashes for URL paths...

## Error Handling

All errors return a standard error envelope...
```

The `description` field is required. It tells the agent what the reference contains so it can decide when to fetch it.

### Naming Convention

Reference filenames use `lowercase-with-dashes`:

- `api-guidelines.md`
- `error-codes.md`
- `coding-standards.md`

The filename (without `.md`) becomes the reference name used in the protocol.

## Enabling References

After creating reference files, specify which references are available in the protocol.

### Interactive Agents

List references in `agent.references`:

```yaml
agent:
  model: anthropic/claude-sonnet-4-5
  system: system
  references: [api-guidelines, error-codes]
  agentic: true
```

### Workers and Named Threads

List references per-thread in `start-thread.references`:

```yaml
steps:
  Start thread:
    block: start-thread
    thread: worker
    model: anthropic/claude-sonnet-4-5
    system: system
    references: [api-guidelines]
    maxSteps: 10
```

Different threads can have different references.

## Reference Tools

When references are enabled, the agent has access to two tools:

| Tool                     | Purpose                                         |
| ------------------------ | ----------------------------------------------- |
| `octavus_reference_list` | List all available references with descriptions |
| `octavus_reference_read` | Read the full content of a specific reference   |

The agent also sees reference names and descriptions in its system prompt, so it knows what's available without calling `octavus_reference_list`.

## Example

```yaml
agent:
  model: anthropic/claude-sonnet-4-5
  system: system
  tools: [review-pull-request]
  references: [coding-standards, api-guidelines]
  agentic: true

handlers:
  user-message:
    Add message:
      block: add-message
      role: user
      prompt: user-message
      input: [USER_MESSAGE]

    Respond:
      block: next-message
```

With `references/coding-standards.md`:

```markdown
---
description: >
  Team coding standards including naming conventions,
  code organization, and review checklist.
---

# Coding Standards

## Naming Conventions

- Files: kebab-case
- Variables: camelCase
- Constants: UPPER_SNAKE_CASE
  ...
```

When a user asks the agent to review code, the agent will:

1. See "coding-standards" and "api-guidelines" in its system prompt
2. Decide which references are relevant to the review
3. Call `octavus_reference_read` to load the relevant reference
4. Use the loaded context to provide an informed review

## Validation

The CLI and platform validate references during sync and deployment:

- **Undefined references** — Referencing a name that doesn't have a matching file in `references/`
- **Unused references** — A reference file exists but isn't listed in any `agent.references` or `start-thread.references`
- **Invalid names** — Names that don't follow the `lowercase-with-dashes` convention
- **Missing description** — Reference files without the required `description` in frontmatter

## References vs Skills

| Aspect        | References                    | Skills                          |
| ------------- | ----------------------------- | ------------------------------- |
| **Purpose**   | On-demand context documents   | Code execution and file output  |
| **Content**   | Markdown text                 | Documentation + scripts         |
| **Execution** | Synchronous text retrieval    | Sandboxed code execution (E2B)  |
| **Scope**     | Per-agent (stored with agent) | Per-organization (shared)       |
| **Tools**     | List and read (2 tools)       | Read, list, run, code (6 tools) |

Use **references** when the agent needs access to text-based knowledge. Use **skills** when the agent needs to execute code or generate files.

## Next Steps

- [Agent Config](/docs/protocol/agent-config) — Configuring references in agent settings
- [Skills](/docs/protocol/skills) — Code execution and knowledge packages
- [Workers](/docs/protocol/workers) — Using references in worker agents
