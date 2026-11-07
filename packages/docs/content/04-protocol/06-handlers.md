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
  title: Summarizing the conversation # The card's label
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

### start-thread

Create a named conversation thread:

```yaml
Start summary thread:
  block: start-thread
  thread: summary # Thread name
  model: anthropic/claude-sonnet-4-5 # Optional: different model
  backupModel: openai/gpt-4o # Failover on provider errors
  thinking: low # Extended reasoning level
  cache: auto # auto (default) | extended | off
  maxSteps: 1 # Tool call limit
  system: escalation-summary # System prompt
  input: [COMPANY_NAME] # Variables for prompt
  mcpServers: [figma, browser] # MCP servers for this thread
  skills: [qr-code] # Octavus skills for this thread
  sandboxTimeout: 600000 # Skill sandbox timeout (default: 5 min, max: 1 hour)
  imageModel: openai/gpt-image-2.5-flare # Image generation model
```

The `cache` field controls prompt caching for this thread and defaults to `auto` when omitted. Threads do not inherit the agent's `cache` value - see [Prompt Caching](/docs/protocol/agent-config#prompt-caching).

The `model` field can also reference a variable for dynamic model selection. The `backupModel`, `temperature`, `thinking`, and `maxSteps` fields also support variable references - see [Dynamic Configuration](/docs/protocol/agent-config#dynamic-configuration).

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
  imageModel: openai/gpt-image-2.5-flare # Required image model
  aspectRatio: 16:9 # Aspect ratio (default 1:1)
  quality: low # OpenAI only: low | medium | high | auto
  outputFormat: jpeg # OpenAI only: png | jpeg | webp
  output: GENERATED_IMAGE # Store URL in variable
  title: Generating your image # The card's label
```

Edit an existing image using reference images:

```yaml
Edit image:
  block: generate-image
  prompt: EDIT_INSTRUCTIONS # e.g., "Remove the background"
  referenceImages: [SOURCE_IMAGE_URL] # Variable(s) containing image URLs
  imageModel: openai/gpt-image-2.5-flare
  output: EDITED_IMAGE
  title: Editing the image
```

| Field             | Required | Description                                                                                                                                                      |
| ----------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prompt`          | Yes      | Variable name containing the image prompt or edit instructions                                                                                                   |
| `imageModel`      | Yes      | Image model identifier (e.g., `openai/gpt-image-2.5-flare`)                                                                                                      |
| `aspectRatio`     | No       | Aspect ratio (default `1:1`); clamped to the model's supported set. See [Aspect Ratios and Resolution](/docs/protocol/agent-config#aspect-ratios-and-resolution) |
| `resolution`      | No       | Output resolution (`1K`, `2K`, `4K`) - Gemini 3 image models only; ignored elsewhere                                                                             |
| `quality`         | No       | Rendering quality (`low`, `medium`, `high`, `auto`) - OpenAI image models only; ignored elsewhere. When omitted the model picks (`auto`)                         |
| `outputFormat`    | No       | Output encoding (`png`, `jpeg`, `webp`) - OpenAI image models only; ignored elsewhere. When omitted the image is a PNG                                           |
| `referenceImages` | No       | Variable names containing image URLs for editing/transformation                                                                                                  |
| `output`          | No       | Variable name to store the generated image URL                                                                                                                   |
| `thread`          | No       | Thread to associate the output file with                                                                                                                         |
| `title`           | No       | The label of the block's card, live and after completion. Without one the card shows the block's name                                                            |

This block is for deterministic image generation pipelines where the prompt is constructed programmatically (e.g., via prompt engineering in a separate thread). When `referenceImages` are provided, the prompt describes how to modify those images.

On OpenAI image models, `quality: low` with `outputFormat: jpeg` is the fastest and smallest output - a good fit for thumbnails, avatars, and other images shown at small sizes. Leave both unset when detail or transparency matters.

For agentic image generation where the LLM decides when to generate, configure `imageModel` in the [agent config](/docs/protocol/agent-config#image-generation).

### generate-video

Generate a short video clip from a prompt variable:

```yaml
Generate clip:
  block: generate-video
  prompt: CLIP_PROMPT # Variable containing the prompt
  videoModel: google/gemini-omni-1.1-flash # Required video model
  aspectRatio: 16:9 # 16:9 (default) or 9:16
  durationSeconds: 6 # Clip length in seconds (3-10)
  output: CLIP_URL # Store the clip URL in a variable
  title: Generating your clip # The card's label
```

Animate a starting frame (image-to-video):

```yaml
Animate photo:
  block: generate-video
  prompt: MOTION_PROMPT # e.g., "The camera slowly pushes in as the leaves move"
  referenceImages: [PHOTO_URL] # First image is the starting frame
  videoModel: google/gemini-omni-1.1-flash
  output: ANIMATED_CLIP
```

| Field             | Required | Description                                                                                                              |
| ----------------- | -------- | ------------------------------------------------------------------------------------------------------------------------ |
| `prompt`          | Yes      | Variable name containing the clip prompt: scene, subject, motion, camera, mood, and the sound you want                   |
| `videoModel`      | Yes      | Video model identifier (e.g., `google/gemini-omni-1.1-flash`)                                                            |
| `aspectRatio`     | No       | `16:9` (default) or `9:16`; clamped to the model's supported set                                                         |
| `durationSeconds` | No       | Clip length in seconds; clamped to the model's window (3-10 s). When omitted the model's longest clip is generated       |
| `generateAudio`   | No       | Whether the clip has an audio track. Unset lets the model compose one from the prompt; `false` asks for a silent clip    |
| `referenceImages` | No       | Variable names containing image URLs: the first is the starting frame, any further image is a subject or style reference |
| `output`          | No       | Variable name to store the generated clip URL                                                                            |
| `thread`          | No       | Thread to associate the output file with                                                                                 |
| `title`           | No       | The label of the block's card. Without one the card shows the block's name                                               |

Generation runs a slow provider job inside the step (tens of seconds to a couple of minutes), and usage is token-metered per second of clip - see [Generating video](/docs/protocol/agent-config#generating-video) for the model table and pricing.

For agentic video generation where the LLM decides when to generate, configure `videoModel` in the [agent config](/docs/protocol/agent-config#generating-video).

### generate-speech

Generate spoken audio from a text variable:

```yaml
Read aloud:
  block: generate-speech
  text: ARTICLE_TEXT # Variable containing the text to speak
  speechModel: openai/gpt-4o-mini-tts # Required speech model
  voice: marin # Optional voice id
  format: mp3 # Optional output format (default mp3)
  output: NARRATION_URL # Store the audio file URL in a variable
  title: Generating audio # The card's label
```

| Field          | Required | Description                                                                |
| -------------- | -------- | -------------------------------------------------------------------------- |
| `text`         | Yes      | Variable name containing the text to convert to speech                     |
| `speechModel`  | Yes      | Speech model identifier (e.g., `openai/gpt-4o-mini-tts`)                   |
| `voice`        | No       | Voice id to speak with (provider-specific)                                 |
| `format`       | No       | Output audio format (`mp3`, `opus`, `aac`, `flac`, `wav`; default `mp3`)   |
| `instructions` | No       | Optional delivery instructions (model-dependent)                           |
| `language`     | No       | Optional ISO 639-1 language hint (model-dependent)                         |
| `speed`        | No       | Optional speech speed multiplier (0.25 - 4.0; model-dependent)             |
| `output`       | No       | Variable name to store the generated audio file URL                        |
| `thread`       | No       | Thread to associate the output file with                                   |
| `title`        | No       | The label of the block's card. Without one the card shows the block's name |

For agentic speech generation where the LLM decides when to speak, configure `speechModel` in the [agent config](/docs/protocol/agent-config#speech-generation).

### transcribe-audio

Transcribe an audio (or video) file referenced by a variable, storing the transcript text:

```yaml
Transcribe recording:
  block: transcribe-audio
  audio: RECORDING_FILE # Variable holding a file reference or URL
  transcriptionModel: openai/gpt-4o-transcribe # Required transcription model
  timestamps: true # Optional timestamped segments
  output: TRANSCRIPT # Store the transcript text in a variable
  title: Transcribing the audio # The card's label
```

| Field                | Required | Description                                                                |
| -------------------- | -------- | -------------------------------------------------------------------------- |
| `audio`              | Yes      | Variable name holding the audio/video file (a file reference or URL)       |
| `transcriptionModel` | Yes      | Transcription model identifier (e.g., `openai/gpt-4o-transcribe`)          |
| `language`           | No       | Optional ISO 639-1 language hint (default auto-detect)                     |
| `timestamps`         | No       | Request timestamped segments where the model supports them                 |
| `output`             | No       | Variable name to store the resulting transcript text                       |
| `thread`             | No       | Thread to attribute the block's events to                                  |
| `title`              | No       | The label of the block's card. Without one the card shows the block's name |

For agentic transcription where the LLM decides when to transcribe, configure `transcriptionModel` in the [agent config](/docs/protocol/agent-config#transcription).

## Display Modes

Every block has a `display` property with one of three modes. The label a visible block shows is its `title`; without one, the client derives a label from the block's name. A block's `description` is never shown.

| Mode     | Default For                                                                  | Behavior                                                                        |
| -------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `hidden` | add-message, start-thread, serialize-thread                                  | Nothing reaches the client                                                      |
| `title`  | tool-call, generate-image, generate-video, generate-speech, transcribe-audio | A labeled card; arguments and results stay on the server                        |
| `stream` | next-message, run-worker                                                     | Everything: streamed content, arguments and results, a worker's nested activity |

Blocks that produce an artifact (`generate-image`, `generate-video`, `generate-speech`, `transcribe-audio`, `serialize-thread`) render as an [operation card](/docs/client-sdk/execution-blocks) when visible. A `tool-call` block renders as a tool call; a `run-worker` block as a worker card; `next-message` streams the response itself.

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
      title: Summarizing your conversation
      independent: true
      output: SUMMARY

    # Step 5: Create support ticket
    Create ticket:
      block: tool-call
      tool: create-support-ticket
      input:
        summary: SUMMARY
        priority: medium
      output: TICKET

    # Step 6: Add directive for response
    Add directive:
      block: add-message
      role: user
      prompt: ticket-directive
      input: [TICKET_DETAILS: TICKET]
      visible: false

    # Step 7: Respond to user
    Respond:
      block: next-message
```

## Block Input Mapping

The `input` field on blocks controls which variables are passed to the prompt. Only variables listed in `input` are available for interpolation.

Variables can come from `protocol.input`, `protocol.variables`, `trigger.input`, or outputs from prior blocks.

```yaml
# Array format (same name)
input: [USER_MESSAGE, COMPANY_NAME]

# Array format (rename)
input:
  - CONVERSATION: CONVERSATION_TEXT  # Prompt sees CONVERSATION, value comes from CONVERSATION_TEXT
  - TICKET_DETAILS: TICKET

# Object format (rename)
input:
  CONVERSATION: CONVERSATION_TEXT
  TICKET_DETAILS: TICKET
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
