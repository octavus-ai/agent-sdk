---
title: Skills
description: Using Octavus skills for code execution and specialized capabilities.
---

# Skills

Skills are knowledge packages that enable agents to execute code and generate files in isolated sandbox environments. Unlike external tools (which you implement in your backend), skills are self-contained packages with documentation and scripts that run in secure sandboxes.

## Overview

Octavus Skills provide **provider-agnostic** code execution. They work with any LLM provider (Anthropic, OpenAI, Google) by using explicit tool calls and system prompt injection.

### How Skills Work

1. **Skill Definition**: Skills are defined in the protocol's `skills:` section
2. **Skill Resolution**: Skills are resolved from available sources (see below)
3. **Sandbox Execution**: When a skill is used, code runs in an isolated sandbox environment
4. **File Generation**: Files saved to `/output/` are automatically captured and made available for download

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

### Display Modes

| Mode          | Behavior                                    |
| ------------- | ------------------------------------------- |
| `hidden`      | Skill usage not shown to users              |
| `name`        | Shows skill name while executing            |
| `description` | Shows description while executing (default) |
| `stream`      | Streams progress if available               |

## Enabling Skills

After defining skills in the `skills:` section, specify which skills are available for the chat thread in `agent.skills`:

```yaml
# All skills available to this agent (defined once at protocol level)
skills:
  qr-code:
    display: description
    description: Generating QR codes

# Skills available for this chat thread
agent:
  model: anthropic/claude-sonnet-4-5
  system: system
  tools: [get-user-account]
  skills: [qr-code] # Skills available for this thread
  agentic: true
```

## Skill Tools

When skills are enabled, the LLM has access to these tools:

| Tool                 | Purpose                                 |
| -------------------- | --------------------------------------- |
| `octavus_skill_read` | Read skill documentation (SKILL.md)     |
| `octavus_skill_list` | List available scripts in a skill       |
| `octavus_skill_run`  | Execute a pre-built script from a skill |
| `octavus_code_run`   | Execute arbitrary Python/Bash code      |
| `octavus_file_write` | Create files in the sandbox             |
| `octavus_file_read`  | Read files from the sandbox             |

The LLM learns about available skills through system prompt injection and can use these tools to interact with skills.

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

| Feature            | Octavus Skills    | External Tools      | Provider Tools/Skills |
| ------------------ | ----------------- | ------------------- | --------------------- |
| **Execution**      | Isolated sandbox  | Your backend        | Provider servers      |
| **Provider**       | Any (agnostic)    | N/A                 | Provider-specific     |
| **Code Execution** | Yes               | No                  | Yes (provider tools)  |
| **File Output**    | Yes               | No                  | Yes (provider skills) |
| **Implementation** | Skill packages    | Your code           | Built-in              |
| **Cost**           | Sandbox + LLM API | Your infrastructure | Included in API       |

## Uploading Custom Skills

You can upload custom skills to your organization:

1. Create a skill following the [Agent Skills](https://agentskills.io) format
2. Package it as a `.skill` bundle (ZIP file)
3. Upload via the platform UI
4. Reference by slug in your protocol

```yaml
skills:
  custom-analysis:
    display: description
    description: Custom analysis tool

agent:
  skills: [custom-analysis]
```

## Sandbox Timeout

The default sandbox timeout is 5 minutes. For long-running operations, you can configure a custom timeout using `sandboxTimeout` in the agent config:

```yaml
agent:
  model: anthropic/claude-sonnet-4-5
  skills: [data-analysis]
  sandboxTimeout: 1800000 # 30 minutes (in milliseconds)
```

`sandboxTimeout` Maximum: 1 hour (3,600,000 ms)

## Security

Skills run in isolated sandbox environments:

- **No network access** (unless explicitly configured)
- **No persistent storage** (sandbox destroyed after execution)
- **File output only** via `/output/` directory
- **Time limits** enforced (5-minute default, configurable via `sandboxTimeout`)

## Next Steps

- [Agent Config](/docs/protocol/agent-config) — Configuring skills in agent settings
- [Provider Options](/docs/protocol/provider-options) — Anthropic's built-in skills
- [Skills Advanced Guide](/docs/protocol/skills-advanced) — Best practices and advanced patterns
