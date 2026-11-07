# Octavus JavaScript SDK

Official JavaScript/TypeScript SDKs for building applications with [Octavus AI](https://octavus.ai) agents.

## Packages

| Package                                        | Description                        | npm                                                                                                           |
| ---------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| [`@octavus/core`](./packages/core)             | Shared types and utilities         | [![npm](https://img.shields.io/npm/v/@octavus/core)](https://www.npmjs.com/package/@octavus/core)             |
| [`@octavus/server-sdk`](./packages/server-sdk) | Server SDK for backend integration | [![npm](https://img.shields.io/npm/v/@octavus/server-sdk)](https://www.npmjs.com/package/@octavus/server-sdk) |
| [`@octavus/client-sdk`](./packages/client-sdk) | Framework-agnostic client SDK      | [![npm](https://img.shields.io/npm/v/@octavus/client-sdk)](https://www.npmjs.com/package/@octavus/client-sdk) |
| [`@octavus/react`](./packages/react)           | React hooks and bindings           | [![npm](https://img.shields.io/npm/v/@octavus/react)](https://www.npmjs.com/package/@octavus/react)           |
| [`@octavus/cli`](./packages/cli)               | CLI for agent management           | [![npm](https://img.shields.io/npm/v/@octavus/cli)](https://www.npmjs.com/package/@octavus/cli)               |
| [`@octavus/docs`](./packages/docs)             | Documentation content              | [![npm](https://img.shields.io/npm/v/@octavus/docs)](https://www.npmjs.com/package/@octavus/docs)             |

## Quick Start

### Server-Side (Node.js)

```bash
npm install @octavus/server-sdk
```

```typescript
import { OctavusClient } from '@octavus/server-sdk';

const client = new OctavusClient({
  apiKey: process.env.OCTAVUS_API_KEY,
});

// Create a session
const { id: sessionId } = await client.sessions.create('your-agent-id', {
  COMPANY_NAME: 'Acme Inc',
});

// Attach to session and trigger
const session = client.sessions.attach(sessionId, {
  tools: {
    'get-user-account': async ({ userId }) => {
      return { name: 'John Doe', email: 'john@example.com' };
    },
  },
});

// Execute a trigger and stream the response
const stream = await session.trigger('user-message', {
  USER_MESSAGE: 'Hello!',
});

for await (const event of stream) {
  if (event.type === 'text-delta') {
    process.stdout.write(event.delta);
  }
}
```

### Client-Side (React)

```bash
npm install @octavus/react
```

```tsx
import { useOctavusChat, createHttpTransport } from '@octavus/react';

function Chat({ sessionId }) {
  const transport = useMemo(
    () =>
      createHttpTransport({
        triggerRequest: (triggerName, input) =>
          fetch('/api/trigger', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId, triggerName, input }),
          }),
      }),
    [sessionId],
  );

  const { messages, status, send } = useOctavusChat({ transport });

  return (
    <div>
      {messages.map((msg) => (
        <div key={msg.id}>{/* Render message parts */}</div>
      ))}
      <button onClick={() => send('user-message', { USER_MESSAGE: 'Hello' })}>Send</button>
    </div>
  );
}
```

## Documentation

Full documentation is available at [octavus.ai/docs](https://octavus.ai/docs).

- [Getting Started](https://octavus.ai/docs/getting-started/introduction)
- [Server SDK Guide](https://octavus.ai/docs/server-sdk/overview)
- [Client SDK Guide](https://octavus.ai/docs/client-sdk/overview)
- [Protocol Reference](https://octavus.ai/docs/protocol/overview)
- [API Reference](https://octavus.ai/docs/api-reference/overview)

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) 20.0.0+
- [pnpm](https://pnpm.io/) 10.0.0+

### Setup

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run linting
pnpm lint

# Run type checking
pnpm type-check

# Format code
pnpm format
```

### Package Structure

```
packages/
├── core/           # Shared types for client/server communication
├── server-sdk/     # Server SDK for backend integration
├── client-sdk/     # Framework-agnostic client SDK
├── react/          # React bindings (hooks)
├── cli/            # CLI for agent management
└── docs/           # Documentation content
```

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

## License

MIT © [Octavus AI](https://octavus.ai)
