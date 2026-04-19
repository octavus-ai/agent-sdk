---
title: Structured Output
description: Rendering structured object responses with custom UI components.
---

# Structured Output

When an agent uses `responseType` on a `next-message` block, the client receives a `UIObjectPart` instead of a `UITextPart`. This enables rich, custom UI for typed responses.

## How It Works

1. The protocol defines a type and uses it as `responseType`:

```yaml
types:
  ChatResponse:
    content:
      type: string
      description: The main response text
    suggestions:
      type: array
      items:
        type: string
      description: Follow-up suggestions

handlers:
  user-message:
    Respond:
      block: next-message
      responseType: ChatResponse
```

2. The agent generates a JSON response matching the schema
3. The client SDK receives a `UIObjectPart` with progressive JSON parsing
4. Your app renders custom UI based on the `typeName`

## The UIObjectPart

```typescript
interface UIObjectPart {
  type: 'object';
  id: string;
  typeName: string; // Type name from protocol (e.g., "ChatResponse")
  partial?: unknown; // Partial object while streaming
  object?: unknown; // Final validated object when done
  status: 'streaming' | 'done' | 'error';
  error?: string; // Error message if parsing failed
  thread?: string;
}
```

During streaming, `partial` contains the progressively parsed object. When streaming completes, `object` contains the final validated result.

## Building a Renderer

Create a renderer component for each type you want to customize:

```tsx
import type { UIObjectPart } from '@octavus/react';

interface ChatResponse {
  content?: string;
  suggestions?: string[];
}

function ChatResponseRenderer({ part }: { part: UIObjectPart }) {
  // Use final object if available, otherwise partial
  const data = (part.object ?? part.partial) as ChatResponse | undefined;
  const isStreaming = part.status === 'streaming';

  if (!data) {
    return <LoadingIndicator />;
  }

  return (
    <div className="space-y-4">
      {/* Main content */}
      {data.content && (
        <p>
          {data.content}
          {isStreaming && <span className="animate-pulse">▌</span>}
        </p>
      )}

      {/* Suggestions */}
      {data.suggestions && data.suggestions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {data.suggestions.map((suggestion, i) => (
            <button key={i} className="px-3 py-1 bg-blue-100 rounded-full text-sm">
              {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

## Renderer Registry Pattern

For apps with multiple response types, use a registry to map type names to renderers:

```tsx
import type { ComponentType } from 'react';
import type { UIObjectPart } from '@octavus/react';

// Define props interface
interface ObjectRendererProps {
  part: UIObjectPart;
  onSuggestionClick?: (suggestion: string) => void;
}

// Registry type
type ObjectRendererRegistry = Record<string, ComponentType<ObjectRendererProps>>;

// Create registry for each agent
const productAdvisorRenderers: ObjectRendererRegistry = {
  ChatResponse: ChatResponseRenderer,
  ProductList: ProductListRenderer,
};

// Map agents to their renderers
const AGENT_RENDERERS: Record<string, ObjectRendererRegistry> = {
  'product-advisor': productAdvisorRenderers,
  'support-chat': supportChatRenderers,
};

// Get renderers for an agent
function getRenderers(agentSlug: string): ObjectRendererRegistry {
  return AGENT_RENDERERS[agentSlug] ?? {};
}
```

## Using in Part Renderer

Integrate with your part renderer:

```tsx
function PartRenderer({ part, agentSlug }: { part: UIMessagePart; agentSlug: string }) {
  if (part.type === 'object') {
    const renderers = getRenderers(agentSlug);
    const Renderer = renderers[part.typeName];

    if (Renderer) {
      return <Renderer part={part} />;
    }

    // Fallback: render as formatted JSON
    return (
      <pre className="text-sm bg-gray-100 p-3 rounded overflow-auto">
        {JSON.stringify(part.object ?? part.partial, null, 2)}
      </pre>
    );
  }

  // Handle other part types...
}
```

## Handling Streaming State

During streaming, the object is progressively parsed. Handle incomplete data gracefully:

```tsx
function ProductListRenderer({ part }: { part: UIObjectPart }) {
  const data = (part.object ?? part.partial) as ProductList | undefined;
  const isStreaming = part.status === 'streaming';

  return (
    <div className="grid grid-cols-2 gap-4">
      {data?.products?.map((product, i) => (
        <ProductCard
          key={product.id ?? i}
          product={product}
          // Show loading state for incomplete products
          isLoading={isStreaming && !product.name}
        />
      ))}

      {isStreaming && <div className="animate-pulse bg-gray-200 rounded h-32" />}
    </div>
  );
}
```

## Error Handling

If JSON parsing fails, `status` will be `'error'` with details in `error`:

```tsx
function ObjectPartRenderer({ part }: { part: UIObjectPart }) {
  if (part.status === 'error') {
    return (
      <div className="text-red-500 p-3 bg-red-50 rounded">
        <p className="font-medium">Failed to parse response</p>
        <p className="text-sm">{part.error}</p>
      </div>
    );
  }

  // Normal rendering...
}
```

## Complete Example

Here's a complete chat interface with structured output support:

```tsx
import { useMemo } from 'react';
import {
  useOctavusChat,
  createHttpTransport,
  type UIMessage,
  type UIMessagePart,
  type UIObjectPart,
} from '@octavus/react';

// Renderers for ChatResponse type
function ChatResponseRenderer({ part }: { part: UIObjectPart }) {
  const data = part.object ?? part.partial;
  const isStreaming = part.status === 'streaming';

  if (!data) {
    return <div className="animate-pulse h-20 bg-gray-200 rounded" />;
  }

  const { content, suggestions } = data as {
    content?: string;
    suggestions?: string[];
  };

  return (
    <div className="space-y-3">
      {content && (
        <p className="text-gray-800">
          {content}
          {isStreaming && <span className="animate-pulse ml-1">▌</span>}
        </p>
      )}

      {suggestions && suggestions.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-2 border-t">
          {suggestions.map((s, i) => (
            <span key={i} className="px-2 py-1 bg-blue-50 text-blue-700 rounded text-sm">
              {s}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// Part renderer with object support
function PartRenderer({ part }: { part: UIMessagePart }) {
  switch (part.type) {
    case 'text':
      return <p>{part.text}</p>;

    case 'object':
      if (part.typeName === 'ChatResponse') {
        return <ChatResponseRenderer part={part} />;
      }
      return <pre>{JSON.stringify(part.object ?? part.partial, null, 2)}</pre>;

    default:
      return null;
  }
}

// Message component
function Message({ message }: { message: UIMessage }) {
  return (
    <div className={message.role === 'user' ? 'text-right' : 'text-left'}>
      <div className="inline-block p-3 rounded-lg max-w-[80%]">
        {message.parts.map((part, i) => (
          <PartRenderer key={i} part={part} />
        ))}
      </div>
    </div>
  );
}

// Chat component
function Chat({ sessionId }: { sessionId: string }) {
  const transport = useMemo(
    () =>
      createHttpTransport({
        request: (payload, options) =>
          fetch('/api/trigger', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId, ...payload }),
            signal: options?.signal,
          }),
      }),
    [sessionId],
  );

  const { messages, status, send } = useOctavusChat({ transport });

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {messages.map((msg) => (
          <Message key={msg.id} message={msg} />
        ))}
      </div>

      {/* Input form... */}
    </div>
  );
}
```

## Best Practices

**Design types for progressive rendering:**

Structure your types so the most important fields stream first. Property order in YAML is preserved during streaming.

```yaml
types:
  ChatResponse:
    content: # Streams first - show immediately
      type: string
    suggestions: # Streams after content
      type: array
      items:
        type: string
```

**Keep renderers resilient:**

Handle missing fields gracefully since partial objects may have undefined properties:

```tsx
// Good - handles missing data
const name = product?.name ?? 'Loading...';

// Avoid - might crash on partial data
const name = product.name; // Error if product is undefined
```

**Use TypeScript for type safety:**

Define TypeScript interfaces matching your protocol types:

```typescript
// Match your protocol types
interface ChatResponse {
  content?: string;
  suggestions?: string[];
  recommendedProducts?: ProductSummary[];
}

interface ProductSummary {
  id?: string;
  name?: string;
  price?: number;
}
```

**Test with slow connections:**

Streaming is more noticeable on slow connections. Test your UI with network throttling to ensure a good experience.

## Type Requirements

The `responseType` in your protocol must be an **object type** (regular custom type with properties).

The following cannot be used directly as `responseType`:

- **Discriminated unions** - LLM providers don't allow `anyOf` at the schema root
- **Array types** - Must be wrapped in an object
- **Primitives** - `string`, `number`, etc. are not valid

If you need variant responses, wrap the discriminated union in an object:

```yaml
types:
  # ❌ Cannot use union directly as responseType
  ChatResponseUnion:
    anyOf: [ContentResponse, ProductResponse]
    discriminator: responseType

  # ✅ Wrap the union in an object
  ChatResponseWrapper:
    response:
      type: ChatResponseUnion
```

If you need the LLM to return an array, wrap it in an object:

```yaml
types:
  # ❌ Cannot use array type as responseType
  ProductList:
    type: array
    items:
      type: Product

  # ✅ Wrap the array in an object
  ProductListResponse:
    products:
      type: array
      items:
        type: Product
```

See [Types - Structured Output](/docs/protocol/types#structured-output) for more details on defining response types.
