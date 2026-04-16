---
title: Quick Start
description: Get your first Octavus agent running in minutes.
---

# Quick Start

This guide will walk you through integrating Octavus into your application in under 10 minutes.

## Prerequisites

- Node.js 18+
- An Octavus account with API key
- A Next.js application (or any Node.js backend)

## Test Your Agent First

Before integrating with SDKs, use **Agent Preview** to test your agent directly in the platform:

1. Open your agent in the platform (navigate to your project, then select the agent)
2. Click the **Preview** tab
3. Configure session inputs and tool mock responses
4. Start a conversation to test agent behavior

Agent Preview supports all trigger types, file attachments, tool mocking, and real-time streaming. This is the fastest way to iterate on your agent logic before writing any integration code.

## Installation

Install the Octavus SDKs in your project:

```bash
# Server SDK for backend
npm install @octavus/server-sdk

# React bindings for frontend
npm install @octavus/react
```

## Backend Setup

### 1. Initialize the Client

Create an Octavus client instance in your backend:

```typescript
// lib/octavus.ts
import { OctavusClient } from '@octavus/server-sdk';

export const octavus = new OctavusClient({
  baseUrl: process.env.OCTAVUS_API_URL!,
  apiKey: process.env.OCTAVUS_API_KEY!,
});
```

### 2. Create a Session Endpoint

Create an API endpoint that creates sessions and returns the session ID:

```typescript
// app/api/chat/create/route.ts
import { NextResponse } from 'next/server';
import { octavus } from '@/lib/octavus';

// Agent ID - get from platform or CLI (see below)
const SUPPORT_AGENT_ID = process.env.OCTAVUS_SUPPORT_AGENT_ID!;

export async function POST(request: Request) {
  const { input } = await request.json();

  // Create a new session using the agent ID
  const sessionId = await octavus.agentSessions.create(SUPPORT_AGENT_ID, input);

  return NextResponse.json({ sessionId });
}
```

### Getting Your Agent ID

There are two ways to create and manage agents:

**Option 1: Platform UI (Recommended for getting started)**

1. Go to [octavus.ai](https://octavus.ai) and create an agent in the web editor
2. Copy the agent ID from the URL (e.g., `octavus.ai/projects/.../agents/clxyz123abc456`)
3. Add it to your `.env.local`: `OCTAVUS_SUPPORT_AGENT_ID=clxyz123abc456`

**Option 2: Local Development with CLI**

For version-controlled agent definitions, use the [Octavus CLI](/docs/server-sdk/cli):

```bash
npm install --save-dev @octavus/cli
octavus sync ./agents/support-chat
# Output: Agent ID: clxyz123abc456
```

The CLI approach is better for teams and CI/CD pipelines where you want agent definitions in your repository.

### 3. Create a Trigger Endpoint

Create an endpoint that handles triggers and streams responses:

```typescript
// app/api/trigger/route.ts
import { toSSEStream } from '@octavus/server-sdk';
import { octavus } from '@/lib/octavus';

export async function POST(request: Request) {
  const body = await request.json();
  const { sessionId, ...payload } = body;

  // Attach to session with tool handlers
  const session = octavus.agentSessions.attach(sessionId, {
    tools: {
      // Define tool handlers that run on your server
      'get-user-account': async (args) => {
        const userId = args.userId as string;
        // Fetch from your database
        return {
          name: 'Demo User',
          email: 'demo@example.com',
          plan: 'pro',
        };
      },
      'create-support-ticket': async (args) => {
        // Create ticket in your system
        return {
          ticketId: 'TICKET-123',
          estimatedResponse: '24 hours',
        };
      },
    },
  });

  // Execute the request and convert to SSE stream
  const events = session.execute(payload, { signal: request.signal });

  // Return as streaming response
  return new Response(toSSEStream(events), {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
```

## Frontend Setup

### 1. Create a Chat Component

Use the `useOctavusChat` hook with the HTTP transport:

```tsx
// components/chat.tsx
'use client';

import { useState, useMemo } from 'react';
import { useOctavusChat, createHttpTransport, type UIMessage } from '@octavus/react';

interface ChatProps {
  sessionId: string;
}

export function Chat({ sessionId }: ChatProps) {
  const [inputValue, setInputValue] = useState('');

  // Create a stable transport instance
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

  const { messages, status, error, send } = useOctavusChat({ transport });

  const isStreaming = status === 'streaming';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || isStreaming) return;

    const message = inputValue.trim();
    setInputValue('');

    // Add user message and trigger in one call
    await send('user-message', { USER_MESSAGE: message }, { userMessage: { content: message } });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="p-4 border-t">
        <div className="flex gap-2">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Type a message..."
            className="flex-1 px-4 py-2 border rounded-lg"
            disabled={isStreaming}
          />
          <button
            type="submit"
            disabled={isStreaming}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}

function MessageBubble({ message }: { message: UIMessage }) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`p-3 rounded-lg max-w-md ${isUser ? 'bg-blue-500 text-white' : 'bg-gray-100'}`}
      >
        {message.parts.map((part, i) => {
          if (part.type === 'text') {
            return <p key={i}>{part.text}</p>;
          }
          return null;
        })}

        {/* Streaming indicator */}
        {message.status === 'streaming' && (
          <span className="inline-block w-2 h-4 bg-gray-400 animate-pulse ml-1" />
        )}
      </div>
    </div>
  );
}
```

### 2. Create Session and Render Chat

```tsx
// app/chat/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { Chat } from '@/components/chat';

export default function ChatPage() {
  const [sessionId, setSessionId] = useState<string | null>(null);

  useEffect(() => {
    async function createSession() {
      const response = await fetch('/api/chat/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: {
            COMPANY_NAME: 'Acme Corp',
            PRODUCT_NAME: 'Widget Pro',
          },
        }),
      });
      const { sessionId } = await response.json();
      setSessionId(sessionId);
    }

    createSession();
  }, []);

  if (!sessionId) {
    return <div>Loading...</div>;
  }

  return <Chat sessionId={sessionId} />;
}
```

## Environment Variables

Add these to your `.env.local`:

```bash
OCTAVUS_API_URL=https://octavus.ai
OCTAVUS_API_KEY=your-api-key-here
```

## What's Next?

Now that you have a basic integration working:

- [Learn about the protocol](/docs/protocol/overview) to define custom agent behavior
- [Explore the Server SDK](/docs/server-sdk/overview) for advanced backend features
- [Build rich UIs](/docs/client-sdk/overview) with the Client SDK
- [Handle tools on the client](/docs/client-sdk/client-tools) for interactive UIs and browser APIs
