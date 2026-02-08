---
title: Handlers
description: Defining execution handlers with blocks.
---

# Handlers

Handlers define what happens when a trigger fires. They contain execution blocks that run in sequence.

## Handler Structure

```yaml
handlers:
  trigger-name:
    Block Name:
      block: block-kind
      # block-specific properties

    Another Block:
      block: another-kind
      # ...
```

Each block has a human-readable name (shown in debug UI) and a `block` field that determines its behavior.

## Block Kinds

### next-message

Generate a response from the LLM:

```yaml
handlers:
  user-message:
    Respond to user:
      block: next-message
      # Uses main conversation thread by default
      # Display defaults to 'stream'
```

With options:

```yaml
Generate summary:
  block: next-message
  thread: summary # Use named thread
  display: stream # Show streaming content
  independent: true # Don't add to main chat
  output: SUMMARY # Store output in variable
  description: Generating summary # Shown in UI
```

For structured output (typed JSON response):

```yaml
Respond with suggestions:
  block: next-message
  responseType: ChatResponse # Type defined in types section
  output: RESPONSE # Stores the parsed object
```

When `responseType` is specified:

- The LLM generates JSON matching the type schema
- The `output` variable receives the parsed object (not plain text)
- The client receives a `UIObjectPart` for custom rendering

See [Types](/docs/protocol/types#structured-output) for more details.

### add-message

Add a message to the conversation:

```yaml
Add user message:
  block: add-message
  role: user # user | assistant | system
  prompt: user-message # Reference to prompt file
  input: [USER_MESSAGE] # Variables to interpolate
  display: hidden # Don't show in UI
```

For internal directives (LLM sees it, user doesn't):

```yaml
Add internal directive:
  block: add-message
  role: user
  prompt: ticket-directive
  input: [TICKET_DETAILS]
  visible: false # LLM sees this, user doesn't
```

For structured user input (object shown in UI, prompt for LLM context):

```yaml
Add user message:
  block: add-message
  role: user
  prompt: user-message # Rendered for LLM context (hidden from UI)
  input: [USER_INPUT]
  uiContent: USER_INPUT # Variable shown in UI (object → object part)
  display: hidden
```

When `uiContent` is set:

- The variable value is shown in the UI (string → text part, object → object part)
- The prompt text is hidden from the UI but kept for LLM context
- Useful for rich UI interactions where the visual differs from the LLM context

### tool-call

Call a tool deterministically:

```yaml
Create ticket:
  block: tool-call
  tool: create-support-ticket
  input:
    summary: SUMMARY # Variable reference
    priority: medium # Literal value
  output: TICKET # Store result
```

### set-resource

Update a persistent resource:

```yaml
Save summary:
  block: set-resource
  resource: CONVERSATION_SUMMARY
  value: SUMMARY # Variable to save
  display: name # Show block name
```

### start-thread

Create a named conversation thread:

```yaml
Start summary thread:
  block: start-thread
  thread: summary # Thread name
  model: anthropic/claude-sonnet-4-5 # Optional: different model
  thinking: low # Extended reasoning level
  maxSteps: 1 # Tool call limit
  system: escalation-summary # System prompt
  input: [COMPANY_NAME] # Variables for prompt
```

The `model` field can also reference a variable for dynamic model selection:

```yaml
Start summary thread:
  block: start-thread
  thread: summary
  model: SUMMARY_MODEL # Resolved from input variable
  system: escalation-summary
```

### serialize-thread

Convert conversation to text:

```yaml
Serialize conversation:
  block: serialize-thread
  thread: main # Which thread (default: main)
  format: markdown # markdown | json
  output: CONVERSATION_TEXT # Variable to store result
```

### generate-image

Generate an image from a prompt variable:

```yaml
Generate image:
  block: generate-image
  prompt: OPTIMIZED_PROMPT # Variable containing the prompt
  imageModel: google/gemini-2.5-flash-image # Required image model
  size: 1024x1024 # 1024x1024 | 1792x1024 | 1024x1792
  output: GENERATED_IMAGE # Store URL in variable
  description: Generating your image... # Shown in UI
```

Edit an existing image using reference images:

```yaml
Edit image:
  block: generate-image
  prompt: EDIT_INSTRUCTIONS # e.g., "Remove the background"
  referenceImages: [SOURCE_IMAGE_URL] # Variable(s) containing image URLs
  imageModel: google/gemini-2.5-flash-image
  output: EDITED_IMAGE
  description: Editing image...
```

| Field             | Required | Description                                                      |
| ----------------- | -------- | ---------------------------------------------------------------- |
| `prompt`          | Yes      | Variable name containing the image prompt or edit instructions   |
| `imageModel`      | Yes      | Image model identifier (e.g., `google/gemini-2.5-flash-image`)  |
| `size`            | No       | Image dimensions: `1024x1024`, `1792x1024`, or `1024x1792`      |
| `referenceImages` | No       | Variable names containing image URLs for editing/transformation  |
| `output`          | No       | Variable name to store the generated image URL                   |
| `thread`          | No       | Thread to associate the output file with                         |
| `description`     | No       | Description shown in the UI during generation                    |

This block is for deterministic image generation pipelines where the prompt is constructed programmatically (e.g., via prompt engineering in a separate thread). When `referenceImages` are provided, the prompt describes how to modify those images.

For agentic image generation where the LLM decides when to generate, configure `imageModel` in the [agent config](/docs/protocol/agent-config#image-generation).

## Display Modes

Every block has a `display` property:

| Mode          | Default For               | Behavior          |
| ------------- | ------------------------- | ----------------- |
| `hidden`      | add-message               | Not shown to user |
| `name`        | set-resource              | Shows block name  |
| `description` | tool-call, generate-image | Shows description |
| `stream`      | next-message              | Streams content   |

## Complete Example

```yaml
handlers:
  user-message:
    # Add the user's message to conversation
    Add user message:
      block: add-message
      role: user
      prompt: user-message
      input: [USER_MESSAGE]
      display: hidden

    # Generate response (LLM may call tools)
    Respond to user:
      block: next-message
      # display: stream (default)

  request-human:
    # Step 1: Serialize conversation for summary
    Serialize conversation:
      block: serialize-thread
      format: markdown
      output: CONVERSATION_TEXT

    # Step 2: Create separate thread for summarization
    Start summary thread:
      block: start-thread
      thread: summary
      model: anthropic/claude-sonnet-4-5
      thinking: low
      system: escalation-summary
      input: [COMPANY_NAME]

    # Step 3: Add request to summary thread
    Add summarize request:
      block: add-message
      thread: summary
      role: user
      prompt: summarize-request
      input:
        - CONVERSATION: CONVERSATION_TEXT

    # Step 4: Generate summary
    Generate summary:
      block: next-message
      thread: summary
      display: stream
      description: Summarizing your conversation
      independent: true
      output: SUMMARY

    # Step 5: Save to resource
    Save summary:
      block: set-resource
      resource: CONVERSATION_SUMMARY
      value: SUMMARY

    # Step 6: Create support ticket
    Create ticket:
      block: tool-call
      tool: create-support-ticket
      input:
        summary: SUMMARY
        priority: medium
      output: TICKET

    # Step 7: Add directive for response
    Add directive:
      block: add-message
      role: user
      prompt: ticket-directive
      input: [TICKET_DETAILS: TICKET]
      visible: false

    # Step 8: Respond to user
    Respond:
      block: next-message
```

## Block Input Mapping

Map variables to block inputs:

```yaml
# Simple list (variable name = prompt variable)
input: [USER_MESSAGE, COMPANY_NAME]

# Mapping (different names)
input:
  - CONVERSATION: CONVERSATION_TEXT  # CONVERSATION in prompt = CONVERSATION_TEXT
  - TICKET_DETAILS: TICKET
```

## Independent Blocks

Use `independent: true` for content that shouldn't go to the main chat:

```yaml
Generate summary:
  block: next-message
  thread: summary
  independent: true # Output stored in variable, not main chat
  output: SUMMARY
```

This is useful for:

- Background processing
- Summarization in separate threads
- Generating content for tools
