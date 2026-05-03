---
title: Skills
description: Using Octavus skills for code execution and specialized capabilities.
---

# Skills

Skills are knowledge packages that enable agents to execute code and generate files. Unlike external tools (which you implement in your backend), skills are self-contained packages with documentation and scripts. By default, skills run in isolated sandbox environments, but they can also run directly on the agent's computer.

## Overview

Octavus Skills provide **provider-agnostic** code execution. They work with any LLM provider (Anthropic, OpenAI, Google) by using explicit tool calls and system prompt injection.

### How Skills Work

1. **Skill Definition**: Skills are defined in the protocol's `skills:` section
2. **Skill Resolution**: Skills are resolved from available sources (see below)
3. **Execution**: Code runs in an isolated sandbox (default) or on the agent's computer
4. **File Generation**: Files saved to `/output/` are automatically captured and made available for download (sandbox skills)

### Skill Sources

Skills come from two sources, visible in the Skills tab of your organization:

| Source      | Badge in UI | Visibility                     | Example            |
| ----------- | ----------- | ------------------------------ | ------------------ |
| **Octavus** | `Octavus`   | Available to all organizations | `qr-code`          |
| **Custom**  | None        | Private to your organization   | `my-company-skill` |

When you reference a skill in your protocol, Octavus resolves it from your available skills. If you create a custom skill with the same name as an Octavus skill, your custom skill takes precedence.

## Defining Skills

Define skills in the protocol's `skills:` section:

```yaml
skills:
  qr-code:
    display: description
    description: Generating QR codes
  data-analysis:
    display: description
    description: Analyzing data and generating reports
```

### Skill Fields

| Field         | Required | Description                                                                           |
| ------------- | -------- | ------------------------------------------------------------------------------------- |
| `display`     | No       | How to show in UI: `hidden`, `name`, `description`, `stream` (default: `description`) |
| `description` | No       | Custom description shown to users (overrides skill's built-in description)            |
| `execution`   | No       | Where the skill runs: `sandbox` (default) or `device`                                 |

### Display Modes

| Mode          | Behavior                                    |
| ------------- | ------------------------------------------- |
| `hidden`      | Skill usage not shown to users              |
| `name`        | Shows skill name while executing            |
| `description` | Shows description while executing (default) |
| `stream`      | Streams progress if available               |

## Enabling Skills

After defining skills in the `skills:` section, specify which skills are available. Skills work in both interactive agents and workers.

### Interactive Agents

Reference skills in `agent.skills`:

```yaml
skills:
  qr-code:
    display: description
    description: Generating QR codes

agent:
  model: anthropic/claude-sonnet-4-5
  system: system
  tools: [get-user-account]
  skills: [qr-code]
  agentic: true
```

### Workers and Named Threads

Reference skills per-thread in `start-thread.skills`:

```yaml
skills:
  qr-code:
    display: description
    description: Generating QR codes

steps:
  Start thread:
    block: start-thread
    thread: worker
    model: anthropic/claude-sonnet-4-5
    system: system
    skills: [qr-code]
    maxSteps: 10
```

This also works for named threads in interactive agents, allowing different threads to have different skills.

## Skill Tools

When skills are enabled, the LLM has access to these tools:

| Tool                  | Purpose                                         | Availability                   |
| --------------------- | ----------------------------------------------- | ------------------------------ |
| `octavus_skill_read`  | Read skill documentation (SKILL.md)             | All skills                     |
| `octavus_skill_list`  | List available scripts in a skill               | All skills                     |
| `octavus_skill_run`   | Execute a pre-built script from a skill         | All skills                     |
| `octavus_skill_setup` | Install a skill on the device for file browsing | Device skills only             |
| `octavus_code_run`    | Execute arbitrary Python/Bash code              | Sandbox skills (standard) only |
| `octavus_file_write`  | Create files in the sandbox                     | Sandbox skills (standard) only |
| `octavus_file_read`   | Read files from the sandbox                     | Sandbox skills (standard) only |

The LLM learns about available skills through system prompt injection and can use these tools to interact with skills.

Skills that have [secrets](#skill-secrets) configured run in **secure mode**, where only `octavus_skill_read`, `octavus_skill_list`, and `octavus_skill_run` are available. See [Skill Secrets](#skill-secrets) below.

## Device Execution

By default, skills run in an isolated sandbox. When `execution: device` is set, the skill runs on the agent's computer (VM or desktop) instead.

```yaml
skills:
  deploy-tool:
    display: description
    description: Deploy applications to production
    execution: device
  qr-code:
    display: description
    description: Generating QR codes
    # execution defaults to sandbox
```

### How Device Skills Work

Device skills are installed on the agent's computer so the agent can browse their files and run their scripts directly. After attaching a skill via integrations, the agent uses `octavus_skill_setup` to install it on the device. Once installed, the agent can:

- Read the skill's documentation with `octavus_skill_read`
- List available scripts with `octavus_skill_list`
- Run pre-built scripts with `octavus_skill_run`

The generic workspace tools (`octavus_code_run`, `octavus_file_write`, `octavus_file_read`) are **not available** for device skills. Instead, the agent uses the device's own shell and filesystem MCP servers to interact with files and run commands.

### Sandbox vs Device Skills

| Aspect              | Sandbox (default)                  | Device                                                 |
| ------------------- | ---------------------------------- | ------------------------------------------------------ |
| **Environment**     | Isolated sandbox                   | Agent's computer (VM or desktop)                       |
| **Available tools** | All 6 skill tools                  | `skill_read`, `skill_list`, `skill_run`, `skill_setup` |
| **File access**     | Via `octavus_file_read/write`      | Via device filesystem MCP                              |
| **Code execution**  | Via `octavus_code_run`             | Via device shell MCP                                   |
| **Isolation**       | Fully sandboxed                    | Runs alongside other device processes                  |
| **File output**     | `/output/` directory auto-captured | Files written to device filesystem                     |

### When to Use Device Execution

Use `execution: device` when the skill needs to:

- Access the agent's local filesystem or running processes
- Use tools or CLIs installed on the device
- Interact with services running on the device
- Persist files beyond a single execution cycle

## Example: QR Code Generation

```yaml
skills:
  qr-code:
    display: description
    description: Generating QR codes

agent:
  model: anthropic/claude-sonnet-4-5
  system: system
  skills: [qr-code]
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

When a user asks "Create a QR code for octavus.ai", the LLM will:

1. Recognize the task matches the `qr-code` skill
2. Call `octavus_skill_read` to learn how to use the skill
3. Execute code (via `octavus_code_run` or `octavus_skill_run`) to generate the QR code
4. Save the image to `/output/` in the sandbox
5. The file is automatically captured and made available for download

## File Output

Files saved to `/output/` in the sandbox are automatically:

1. **Captured** after code execution
2. **Uploaded** to S3 storage
3. **Made available** via presigned URLs
4. **Included** in the message as file parts

Files persist across page refreshes and are stored in the session's message history.

## Skill Format

Skills follow the [Agent Skills](https://agentskills.io) open standard:

- `SKILL.md` - Required skill documentation with YAML frontmatter
- `scripts/` - Optional executable code (Python/Bash)
- `references/` - Optional documentation loaded as needed
- `assets/` - Optional files used in outputs (templates, images)

### SKILL.md Format

````yaml
---
name: qr-code
description: >
  Generate QR codes from text, URLs, or data. Use when the user needs to create
  a QR code for any purpose - sharing links, contact information, WiFi credentials,
  or any text data that should be scannable.
version: 1.0.0
license: MIT
author: Octavus Team
---

# QR Code Generator

## Overview

This skill creates QR codes from text data using Python...

## Quick Start

Generate a QR code with Python:

```python
import qrcode
import os

output_dir = os.environ.get('OUTPUT_DIR', '/output')
# ... code to generate QR code ...
````

## Scripts Reference

### scripts/generate.py

Main script for generating QR codes...

````

### Frontmatter Fields

| Field         | Required | Description                                            |
| ------------- | -------- | ------------------------------------------------------ |
| `name`        | Yes      | Skill slug (lowercase, hyphens)                        |
| `description` | Yes      | What the skill does (shown to the LLM)                 |
| `version`     | No       | Semantic version string                                |
| `license`     | No       | License identifier                                     |
| `author`      | No       | Skill author                                           |
| `secrets`     | No       | Array of secret declarations (enables secure mode)     |

## Best Practices

### 1. Clear Descriptions

Provide clear, purpose-driven descriptions:

```yaml
skills:
  # Good - clear purpose
  qr-code:
    description: Generating QR codes for URLs, contact info, or any text data

  # Avoid - vague
  utility:
    description: Does stuff
````

### 2. When to Use Skills vs Tools

| Use Skills When          | Use Tools When               |
| ------------------------ | ---------------------------- |
| Code execution needed    | Simple API calls             |
| File generation          | Database queries             |
| Complex calculations     | External service integration |
| Data processing          | Authentication required      |
| Provider-agnostic needed | Backend-specific logic       |

### 3. Skill Selection

Define all skills available to this agent in the `skills:` section. Then specify which skills are available for the chat thread in `agent.skills`:

```yaml
# All skills available to this agent (defined once at protocol level)
skills:
  qr-code:
    display: description
    description: Generating QR codes
  data-analysis:
    display: description
    description: Analyzing data
  pdf-processor:
    display: description
    description: Processing PDFs

# Skills available for this chat thread
agent:
  model: anthropic/claude-sonnet-4-5
  system: system
  skills: [qr-code, data-analysis] # Skills available for this thread
```

### 4. Display Modes

Choose appropriate display modes based on user experience:

```yaml
skills:
  # Background processing - hide from user
  data-analysis:
    display: hidden

  # User-facing generation - show description
  qr-code:
    display: description

  # Interactive progress - stream updates
  report-generation:
    display: stream
```

## Comparison: Skills vs Tools vs Provider Options

| Feature            | Octavus Skills              | External Tools      | Provider Tools/Skills |
| ------------------ | --------------------------- | ------------------- | --------------------- |
| **Execution**      | Sandbox or agent's computer | Your backend        | Provider servers      |
| **Provider**       | Any (agnostic)              | N/A                 | Provider-specific     |
| **Code Execution** | Yes                         | No                  | Yes (provider tools)  |
| **File Output**    | Yes                         | No                  | Yes (provider skills) |
| **Implementation** | Skill packages              | Your code           | Built-in              |
| **Cost**           | Sandbox + LLM API           | Your infrastructure | Included in API       |

## Uploading Custom Skills

You can upload custom skills to your organization using the CLI or the platform UI.

### Via CLI (Recommended)

Use [`octavus skills sync`](/docs/server-sdk/cli#octavus-skills-sync-path) to package and upload a skill directory. If the skill has a `.env` file, secrets are pushed alongside the bundle:

```bash
octavus skills sync ./skills/my-skill
```

### Skill Directory Structure

```
my-skill/
├── SKILL.md          # Required: Skill documentation with frontmatter
├── scripts/          # Optional: Executable scripts
│   ├── run.py
│   └── requirements.txt
├── references/       # Optional: Additional documentation
├── assets/           # Optional: Templates, images
└── .env              # Optional: Secrets (not included in bundle)
```

Once uploaded, reference the skill by slug in your protocol:

```yaml
skills:
  my-skill:
    display: description
    description: Custom analysis tool

agent:
  skills: [my-skill]
```

## On-Demand Skills

On-demand skills (`onDemandSkills`) also support the `execution` field:

```yaml
onDemandSkills:
  display: description
  execution: device
```

When `execution: device` is set on the on-demand skills declaration, any skill attached at runtime via integrations runs on the agent's computer instead of in a sandbox.

## Sandbox Timeout

The default sandbox timeout is 5 minutes (applies to sandbox skills only). You can configure a custom timeout using `sandboxTimeout` in the agent config or on individual `start-thread` blocks:

```yaml
# Agent-level timeout (applies to main thread)
agent:
  model: anthropic/claude-sonnet-4-5
  skills: [data-analysis]
  sandboxTimeout: 1800000 # 30 minutes (in milliseconds)
```

```yaml
# Thread-level timeout (overrides agent-level for this thread)
steps:
  Start thread:
    block: start-thread
    thread: analysis
    model: anthropic/claude-sonnet-4-5
    skills: [data-analysis]
    sandboxTimeout: 3600000 # 1 hour
```

Thread-level `sandboxTimeout` takes priority over agent-level. Maximum: 1 hour (3,600,000 ms).

## Skill Secrets

Skills can declare secrets they need to function. When an organization configures those secrets, the skill runs in **secure mode** with additional isolation.

### Declaring Secrets

Add a `secrets` array to your SKILL.md frontmatter:

```yaml
---
name: github
description: >
  Run GitHub CLI (gh) commands to manage repos, issues, PRs, and more.
secrets:
  - name: GITHUB_TOKEN
    description: GitHub personal access token with repo access
    required: true
  - name: GITHUB_ORG
    description: Default GitHub organization
    required: false
---
```

Each secret declaration has:

| Field         | Required | Description                                                 |
| ------------- | -------- | ----------------------------------------------------------- |
| `name`        | Yes      | Environment variable name (uppercase, e.g., `GITHUB_TOKEN`) |
| `description` | No       | Explains what this secret is for (shown in the UI)          |
| `required`    | No       | Whether the secret is required (defaults to `true`)         |

Secret names must match the pattern `^[A-Z_][A-Z0-9_]*$` (uppercase letters, digits, and underscores).

### Configuring Secrets

Organization admins configure secret values through the skill editor in the platform UI. Each organization maintains its own independent set of secrets for each skill.

Secrets are encrypted at rest and only decrypted at execution time.

### Secure Mode

When a skill has secrets configured for the organization, it automatically runs in **secure mode**:

- The skill gets its own **isolated sandbox** (separate from other skills)
- Secrets are injected as **environment variables** available to all scripts
- Only `octavus_skill_read`, `octavus_skill_list`, and `octavus_skill_run` are available - `octavus_code_run`, `octavus_file_write`, and `octavus_file_read` are blocked
- Scripts receive input as **JSON via stdin** (using the `input` parameter on `octavus_skill_run`) instead of CLI args
- All output (stdout/stderr) is **automatically redacted** for secret values before being returned to the LLM

### Writing Scripts for Secure Skills

Scripts in secure skills read input from stdin as JSON and access secrets from environment variables:

```python
import json
import os
import sys

input_data = json.load(sys.stdin)
token = os.environ.get('GITHUB_TOKEN')

# Use the token and input_data to perform the task
```

For standard skills (without secrets), scripts receive input as CLI arguments. For secure skills, always use stdin JSON.

## Security

Sandbox skills run in isolated environments:

- **No network access** (unless explicitly configured)
- **No persistent storage** (sandbox destroyed after each `next-message` execution)
- **File output only** via `/output/` directory
- **Time limits** enforced (5-minute default, configurable via `sandboxTimeout`)
- **Secret redaction** - output from secure skills is automatically scanned for secret values

Device skills run on the agent's computer and share its environment. They do not have sandbox isolation but benefit from restricted tool access (only slug-bearing tools are available).

## Next Steps

- [Agent Config](/docs/protocol/agent-config) - Configuring skills in agent settings
- [Provider Options](/docs/protocol/provider-options) - Anthropic's built-in skills
- [Skills Advanced Guide](/docs/protocol/skills-advanced) - Best practices and advanced patterns
