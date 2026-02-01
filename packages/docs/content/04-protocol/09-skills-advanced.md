---
title: Skills Advanced Guide
description: Best practices and advanced patterns for using Octavus skills.
---

# Skills Advanced Guide

This guide covers advanced patterns and best practices for using Octavus skills in your agents.

## When to Use Skills

Skills are ideal for:

- **Code execution** - Running Python/Bash scripts
- **File generation** - Creating images, PDFs, reports
- **Data processing** - Analyzing, transforming, or visualizing data
- **Provider-agnostic needs** - Features that should work with any LLM

Use external tools instead when:

- **Simple API calls** - Database queries, external services
- **Authentication required** - Accessing user-specific resources
- **Backend integration** - Tight coupling with your infrastructure

## Skill Selection Strategy

### Defining Available Skills

Define all skills available to this agent in the `skills:` section. Then specify which skills are available for the chat thread in `agent.skills`:

```yaml
# All skills available to this agent (defined once at protocol level)
skills:
  qr-code:
    display: description
    description: Generating QR codes
  pdf-processor:
    display: description
    description: Processing PDFs
  data-analysis:
    display: description
    description: Analyzing data

# Skills available for this chat thread
agent:
  model: anthropic/claude-sonnet-4-5
  system: system
  skills: [qr-code] # Skills available for this thread
```

### Match Skills to Use Cases

Define all skills available to this agent in the `skills:` section. Then specify which skills are available for the chat thread based on use case:

```yaml
# All skills available to this agent (defined once at protocol level)
skills:
  qr-code:
    display: description
    description: Generating QR codes
  data-analysis:
    display: description
    description: Analyzing data and generating reports
  visualization:
    display: description
    description: Creating charts and visualizations

# Skills available for this chat thread (support use case)
agent:
  model: anthropic/claude-sonnet-4-5
  system: system
  skills: [qr-code] # Skills available for this thread
```

For a data analysis thread, you would specify `[data-analysis, visualization]` in `agent.skills`, but still define all available skills in the `skills:` section above.

## Display Mode Strategy

Choose display modes based on user experience:

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

### Guidelines

- **`hidden`**: Background work that doesn't need user awareness
- **`description`**: User-facing operations (default)
- **`name`**: Quick operations where name is sufficient
- **`stream`**: Long-running operations where progress matters

## System Prompt Integration

Skills are automatically injected into the system prompt. The LLM learns:

1. **Available skills** - List of enabled skills with descriptions
2. **How to use skills** - Instructions for using skill tools
3. **Tool reference** - Available skill tools (`octavus_skill_read`, `octavus_code_run`, etc.)

You don't need to manually document skills in your system prompt. However, you can guide the LLM:

```markdown
<!-- prompts/system.md -->

You are a helpful assistant that can generate QR codes.

## When to Generate QR Codes

Generate QR codes when users want to:

- Share URLs easily
- Provide contact information
- Share WiFi credentials
- Create scannable data

Use the qr-code skill for all QR code generation tasks.
```

## Error Handling

Skills handle errors gracefully:

```yaml
# Skill execution errors are returned to the LLM
# The LLM can retry or explain the error to the user
```

Common error scenarios:

1. **Invalid skill slug** - Skill not found in organization
2. **Code execution errors** - Syntax errors, runtime exceptions
3. **Missing dependencies** - Required packages not installed
4. **File I/O errors** - Permission issues, invalid paths

The LLM receives error messages and can:

- Retry with corrected code
- Explain errors to users
- Suggest alternatives

## File Output Patterns

### Single File Output

```python
# Save single file to /output/
import qrcode
import os

output_dir = os.environ.get('OUTPUT_DIR', '/output')
qr = qrcode.QRCode()
qr.add_data('https://example.com')
img = qr.make_image()
img.save(f'{output_dir}/qrcode.png')
```

### Multiple Files

```python
# Save multiple files
import os

output_dir = os.environ.get('OUTPUT_DIR', '/output')

# Generate multiple outputs
for i in range(3):
    filename = f'{output_dir}/output_{i}.png'
    # ... generate file ...
```

### Structured Output

```python
# Save structured data + files
import json
import os

output_dir = os.environ.get('OUTPUT_DIR', '/output')

# Save metadata
metadata = {
    'files': ['chart.png', 'data.csv'],
    'summary': 'Analysis complete'
}
with open(f'{output_dir}/metadata.json', 'w') as f:
    json.dump(metadata, f)

# Save actual files
# ... generate chart.png and data.csv ...
```

## Performance Considerations

### Lazy Initialization

Sandboxes are created only when a skill tool is first called:

```yaml
# Sandbox not created until LLM calls a skill tool
agent:
  skills: [qr-code] # Sandbox created on first use
```

This means:

- No cost if skills aren't used
- Fast startup (no sandbox creation delay)
- Sandbox reused for all skill calls in a trigger

### Timeout Limits

Sandboxes have a 5-minute default timeout, which can be configured via `sandboxTimeout`:

```yaml
agent:
  model: anthropic/claude-sonnet-4-5
  skills: [data-analysis]
  sandboxTimeout: 1800000 # 30 minutes for long-running analysis
```

`sandboxTimeout` Maximum: 1 hour (3,600,000 ms)

**Timeout guidelines:**

- **Short operations** (default 5 min): QR codes, simple calculations
- **Medium operations** (10-30 min): Data analysis, report generation
- **Long operations** (30+ min): Complex processing, large dataset analysis

### Sandbox Lifecycle

Each trigger execution gets a fresh sandbox:

- **Clean state** - No leftover files from previous executions
- **Isolated** - No interference between sessions
- **Destroyed** - Sandbox cleaned up after trigger completes

## Combining Skills with Tools

Skills and tools can work together:

```yaml
tools:
  get-user-data:
    description: Fetch user data from database
    parameters:
      userId: { type: string }

skills:
  data-analysis:
    display: description
    description: Analyzing data

agent:
  tools: [get-user-data]
  skills: [data-analysis]
  agentic: true

handlers:
  analyze-user:
    Get user data:
      block: tool-call
      tool: get-user-data
      input:
        userId: USER_ID
      output: USER_DATA

    Analyze:
      block: next-message
      # LLM can use data-analysis skill with USER_DATA
```

Pattern:

1. Fetch data via tool (from your backend)
2. LLM uses skill to analyze/process the data
3. Generate outputs (files, reports)

## Skill Development Tips

### Writing SKILL.md

Focus on **when** and **how** to use the skill:

```markdown
---
name: qr-code
description: >
  Generate QR codes from text, URLs, or data. Use when the user needs to create
  a QR code for any purpose - sharing links, contact information, WiFi credentials,
  or any text data that should be scannable.
---

# QR Code Generator

## When to Use

Use this skill when users want to:

- Share URLs easily
- Provide contact information
- Create scannable data

## Quick Start

[Clear examples of how to use the skill]
```

### Script Organization

Organize scripts logically:

```
skill-name/
├── SKILL.md
└── scripts/
    ├── generate.py      # Main script
    ├── utils.py         # Helper functions
    └── requirements.txt # Dependencies
```

### Error Messages

Provide helpful error messages:

```python
try:
    # ... code ...
except ValueError as e:
    print(f"Error: Invalid input - {e}")
    sys.exit(1)
```

The LLM sees these errors and can retry or explain to users.

## Security Considerations

### Sandbox Isolation

- **No network access** (unless explicitly configured)
- **No persistent storage** (sandbox destroyed after execution)
- **File output only** via `/output/` directory
- **Time limits** enforced (5-minute default, configurable via `sandboxTimeout`)

### Input Validation

Skills should validate inputs:

```python
import sys

if not data:
    print("Error: Data is required")
    sys.exit(1)

if len(data) > 1000:
    print("Error: Data too long (max 1000 characters)")
    sys.exit(1)
```

### Resource Limits

Be aware of:

- **File size limits** - Large files may fail to upload
- **Execution time** - 5-minute sandbox timeout
- **Memory limits** - Sandbox environment constraints

## Debugging Skills

### Check Skill Documentation

The LLM can read skill docs:

```python
# LLM calls octavus_skill_read to see skill instructions
```

### Test Locally

Test skills before uploading:

```bash
# Test skill locally
python scripts/generate.py --data "test"
```

### Monitor Execution

Check execution logs in the platform debug view:

- Tool calls and arguments
- Code execution results
- File outputs
- Error messages

## Common Patterns

### Pattern 1: Generate and Return

```yaml
# User asks for QR code
# LLM generates QR code
# File automatically available for download
```

### Pattern 2: Analyze and Report

```yaml
# User provides data
# LLM analyzes with skill
# Generates report file
# Returns summary + file link
```

### Pattern 3: Transform and Save

```yaml
# User uploads file (via tool)
# LLM processes with skill
# Generates transformed file
# Returns new file link
```

## Best Practices Summary

1. **Enable only needed skills** - Don't overwhelm the LLM
2. **Choose appropriate display modes** - Match user experience needs
3. **Write clear skill descriptions** - Help LLM understand when to use
4. **Handle errors gracefully** - Provide helpful error messages
5. **Test skills locally** - Verify before uploading
6. **Monitor execution** - Check logs for issues
7. **Combine with tools** - Use tools for data, skills for processing
8. **Consider performance** - Be aware of timeouts and limits

## Next Steps

- [Skills](/docs/protocol/skills) - Basic skills documentation
- [Agent Config](/docs/protocol/agent-config) - Configuring skills
- [Tools](/docs/protocol/tools) - External tools integration
