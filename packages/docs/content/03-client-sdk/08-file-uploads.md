---
title: File Uploads
description: Uploading images and files for vision models and document processing.
---

# File Uploads

The Client SDK supports uploading images and documents that can be sent with messages. This enables vision model capabilities (analyzing images) and document processing.

## Overview

File uploads follow a two-step flow:

1. **Request upload URLs** from the platform via your backend
2. **Upload files directly to S3** using presigned URLs
3. **Send file references** with your message

This architecture keeps your API key secure on the server while enabling fast, direct uploads.

## Setup

### Backend: Upload URLs Endpoint

Create an endpoint that proxies upload URL requests to the Octavus platform:

```typescript
// app/api/upload-urls/route.ts (Next.js)
import { NextResponse } from 'next/server';
import { octavus } from '@/lib/octavus';

export async function POST(request: Request) {
  const { sessionId, files } = await request.json();

  // Get presigned URLs from Octavus
  const result = await octavus.files.getUploadUrls(sessionId, files);

  return NextResponse.json(result);
}
```

### Client: Configure File Uploads

Pass `requestUploadUrls` to the chat hook:

```tsx
import { useMemo, useCallback } from 'react';
import { useOctavusChat, createHttpTransport } from '@octavus/react';

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

  // Request upload URLs from your backend
  const requestUploadUrls = useCallback(
    async (files: { filename: string; mediaType: string; size: number }[]) => {
      const response = await fetch('/api/upload-urls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, files }),
      });
      return response.json();
    },
    [sessionId],
  );

  const { messages, status, send, uploadFiles } = useOctavusChat({
    transport,
    requestUploadUrls,
    // Optional: configure upload timeout and retry behavior
    uploadOptions: {
      timeoutMs: 60_000, // Per-file timeout (default: 60s, set to 0 to disable)
      maxRetries: 2, // Retry attempts on transient failures (default: 2)
      retryDelayMs: 1_000, // Delay between retries (default: 1s)
    },
  });

  // ...
}
```

## Uploading Files

### Method 1: Upload Before Sending

For the best UX (showing upload progress), upload files first, then send:

```tsx
import { useState, useRef } from 'react';
import type { FileReference } from '@octavus/react';

function ChatInput({ sessionId }: { sessionId: string }) {
  const [pendingFiles, setPendingFiles] = useState<FileReference[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { send, uploadFiles } = useOctavusChat({
    transport,
    requestUploadUrls,
  });

  async function handleFileSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const files = event.target.files;
    if (!files?.length) return;

    setUploading(true);
    try {
      // Upload files with progress tracking
      const fileRefs = await uploadFiles(files, (fileIndex, progress) => {
        console.log(`File ${fileIndex}: ${progress}%`);
      });
      setPendingFiles((prev) => [...prev, ...fileRefs]);
    } finally {
      setUploading(false);
    }
  }

  async function handleSend(message: string) {
    await send(
      'user-message',
      {
        USER_MESSAGE: message,
        FILES: pendingFiles.length > 0 ? pendingFiles : undefined,
      },
      {
        userMessage: {
          content: message,
          files: pendingFiles.length > 0 ? pendingFiles : undefined,
        },
      },
    );
    setPendingFiles([]);
  }

  return (
    <div>
      {/* File preview */}
      {pendingFiles.map((file) => (
        <img key={file.id} src={file.url} alt={file.filename} className="h-16" />
      ))}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,.pdf"
        multiple
        onChange={handleFileSelect}
        className="hidden"
      />

      <button onClick={() => fileInputRef.current?.click()} disabled={uploading}>
        {uploading ? 'Uploading...' : 'Attach'}
      </button>
    </div>
  );
}
```

### Method 2: Upload on Send (Automatic)

For simpler implementations, pass `File` objects directly:

```tsx
async function handleSend(message: string, files?: File[]) {
  await send(
    'user-message',
    { USER_MESSAGE: message, FILES: files },
    { userMessage: { content: message, files } },
  );
}
```

The SDK automatically uploads the files before sending. Note: This doesn't provide upload progress.

## Upload Reliability

Uploads include built-in timeout and retry logic for handling transient failures (network errors, server issues, mobile network switches).

**Default behavior:**

- **Timeout**: 60 seconds per file — prevents uploads from hanging on stalled connections
- **Retries**: 2 automatic retries on transient failures (network errors, 5xx, 429)
- **Retry delay**: 1 second between retries
- **Non-retryable errors** (4xx like 403, 404) fail immediately without retrying

Only the S3 upload is retried — the presigned URL stays valid for 15 minutes. On retry, the progress callback resets to 0%.

Configure via `uploadOptions`:

```typescript
const { send, uploadFiles } = useOctavusChat({
  transport,
  requestUploadUrls,
  uploadOptions: {
    timeoutMs: 120_000, // 2 minutes for large files
    maxRetries: 3,
    retryDelayMs: 2_000,
  },
});
```

To disable timeout or retries:

```typescript
uploadOptions: {
  timeoutMs: 0,    // No timeout
  maxRetries: 0,   // No retries
}
```

### Using `OctavusChat` Directly

When using the `OctavusChat` class directly (without the React hook), pass `uploadOptions` in the constructor:

```typescript
const chat = new OctavusChat({
  transport,
  requestUploadUrls,
  uploadOptions: { timeoutMs: 120_000, maxRetries: 3 },
});
```

## FileReference Type

File references contain metadata and URLs:

```typescript
interface FileReference {
  /** Unique file ID (platform-generated) */
  id: string;
  /** IANA media type (e.g., 'image/png', 'application/pdf') */
  mediaType: string;
  /** Presigned download URL (S3) */
  url: string;
  /** Original filename */
  filename?: string;
  /** File size in bytes */
  size?: number;
}
```

## Protocol Integration

To accept files in your agent protocol, use the `file[]` type:

```yaml
triggers:
  user-message:
    input:
      USER_MESSAGE:
        type: string
        description: The user's message
      FILES:
        type: file[]
        optional: true
        description: User-attached images for vision analysis

handlers:
  user-message:
    Add user message:
      block: add-message
      role: user
      prompt: user-message
      input:
        - USER_MESSAGE
      files:
        - FILES # Attach files to the message
      display: hidden

    Respond to user:
      block: next-message
```

The `file` type is a built-in type representing uploaded files. Use `file[]` for arrays of files.

## Supported File Types

| Type      | Media Types                                                          |
| --------- | -------------------------------------------------------------------- |
| Images    | `image/jpeg`, `image/png`, `image/gif`, `image/webp`                 |
| Video     | `video/mp4`, `video/webm`, `video/quicktime`, `video/mpeg`           |
| Documents | `application/pdf`, `text/plain`, `text/markdown`, `application/json` |

## File Limits

| Limit                 | Value      |
| --------------------- | ---------- |
| Max file size         | 100 MB     |
| Max total per request | 200 MB     |
| Upload URL expiry     | 15 minutes |
| Download URL expiry   | 24 hours   |

## Rendering User Files

User-uploaded files appear as `UIFilePart` in user messages:

```tsx
function UserMessage({ message }: { message: UIMessage }) {
  return (
    <div>
      {message.parts.map((part, i) => {
        if (part.type === 'file') {
          if (part.mediaType.startsWith('image/')) {
            return (
              <img
                key={i}
                src={part.url}
                alt={part.filename || 'Uploaded image'}
                className="max-h-48 rounded-lg"
              />
            );
          }
          return (
            <a key={i} href={part.url} className="text-blue-500">
              📄 {part.filename}
            </a>
          );
        }
        if (part.type === 'text') {
          return <p key={i}>{part.text}</p>;
        }
        return null;
      })}
    </div>
  );
}
```

## Server SDK: Files API

The Server SDK provides direct access to the Files API:

```typescript
import { OctavusClient } from '@octavus/server-sdk';

const client = new OctavusClient({
  baseUrl: 'https://octavus.ai',
  apiKey: 'your-api-key',
});

// Get presigned upload URLs
const { files } = await client.files.getUploadUrls(sessionId, [
  { filename: 'photo.jpg', mediaType: 'image/jpeg', size: 102400 },
  { filename: 'doc.pdf', mediaType: 'application/pdf', size: 204800 },
]);

// files[0].id - Use in FileReference
// files[0].uploadUrl - PUT to this URL to upload
// files[0].downloadUrl - Use as FileReference.url
```

## Complete Example

Here's a full chat input component with file upload:

```tsx
'use client';

import { useState, useRef, useMemo, useCallback } from 'react';
import { useOctavusChat, createHttpTransport, type FileReference } from '@octavus/react';

interface PendingFile {
  file: File;
  id: string;
  status: 'uploading' | 'done' | 'error';
  progress: number;
  fileRef?: FileReference;
  error?: string;
}

export function Chat({ sessionId }: { sessionId: string }) {
  const [input, setInput] = useState('');
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileIdCounter = useRef(0);

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

  const requestUploadUrls = useCallback(
    async (files: { filename: string; mediaType: string; size: number }[]) => {
      const res = await fetch('/api/upload-urls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, files }),
      });
      return res.json();
    },
    [sessionId],
  );

  const { messages, status, send, uploadFiles } = useOctavusChat({
    transport,
    requestUploadUrls,
  });

  const isUploading = pendingFiles.some((f) => f.status === 'uploading');
  const hasErrors = pendingFiles.some((f) => f.status === 'error');
  const allReady = pendingFiles.every((f) => f.status === 'done');

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    e.target.value = '';

    const newPending: PendingFile[] = files.map((file) => ({
      file,
      id: `pending-${++fileIdCounter.current}`,
      status: 'uploading',
      progress: 0,
    }));

    setPendingFiles((prev) => [...prev, ...newPending]);

    for (const pending of newPending) {
      try {
        const [fileRef] = await uploadFiles([pending.file], (_, progress) => {
          setPendingFiles((prev) =>
            prev.map((f) => (f.id === pending.id ? { ...f, progress } : f)),
          );
        });
        setPendingFiles((prev) =>
          prev.map((f) => (f.id === pending.id ? { ...f, status: 'done', fileRef } : f)),
        );
      } catch (err) {
        setPendingFiles((prev) =>
          prev.map((f) =>
            f.id === pending.id ? { ...f, status: 'error', error: String(err) } : f,
          ),
        );
      }
    }
  }

  async function handleSubmit() {
    if ((!input.trim() && !pendingFiles.length) || !allReady) return;

    const fileRefs = pendingFiles.filter((f) => f.fileRef).map((f) => f.fileRef!);

    await send(
      'user-message',
      {
        USER_MESSAGE: input,
        FILES: fileRefs.length > 0 ? fileRefs : undefined,
      },
      {
        userMessage: {
          content: input,
          files: fileRefs.length > 0 ? fileRefs : undefined,
        },
      },
    );

    setInput('');
    setPendingFiles([]);
  }

  return (
    <div>
      {/* Messages */}
      {messages.map((msg) => (
        <div key={msg.id}>{/* ... render message */}</div>
      ))}

      {/* Pending files */}
      {pendingFiles.length > 0 && (
        <div className="flex gap-2">
          {pendingFiles.map((f) => (
            <div key={f.id} className="relative">
              <img
                src={URL.createObjectURL(f.file)}
                alt={f.file.name}
                className="h-16 w-16 object-cover rounded"
              />
              {f.status === 'uploading' && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                  <span className="text-white text-xs">{f.progress}%</span>
                </div>
              )}
              <button
                onClick={() => setPendingFiles((prev) => prev.filter((p) => p.id !== f.id))}
                className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="flex gap-2">
        <input type="file" ref={fileInputRef} onChange={handleFileSelect} hidden />
        <button onClick={() => fileInputRef.current?.click()}>📎</button>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message..."
          className="flex-1"
        />
        <button onClick={handleSubmit} disabled={isUploading || hasErrors}>
          {isUploading ? 'Uploading...' : 'Send'}
        </button>
      </div>
    </div>
  );
}
```
