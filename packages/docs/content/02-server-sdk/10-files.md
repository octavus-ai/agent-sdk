---
title: Files
description: Upload a file once and reference it anywhere a protocol takes a file.
---

# Files

A file is a resource of your project, not of a session. Upload it once, with the key you already have, and pass the `FileReference` wherever the protocol takes a `file`: a session input, a trigger input, a worker run's input, or a [Workforce dispatch](/docs/workforce-agents/sdk). No session has to exist first, and uploading consumes none.

```typescript
import { OctavusClient } from '@octavus/server-sdk';

const client = new OctavusClient({ apiKey: process.env.OCTAVUS_API_KEY });

const image = await client.files.upload(screenshotBytes, {
  filename: 'screenshot.png',
  mediaType: 'image/png',
});

const { output } = await client.workers.generate(graderId, { IMAGE: image });
```

Files are uploaded directly to storage through presigned URLs; the bytes never pass through the platform.

## Uploading

### One Call

`upload()` creates a file, PUTs the bytes, and returns the reference to pass on. The bytes can be a `Blob` (a `File` included), a `Uint8Array` (a `Buffer` included), or an `ArrayBuffer`. For an image, the pixel dimensions are read from its header and set on the reference.

```typescript
import { readFile } from 'node:fs/promises';

const report = await client.files.upload(await readFile('report.pdf'), {
  filename: 'report.pdf',
  mediaType: 'application/pdf',
});
// { id, mediaType: 'application/pdf', url, filename: 'report.pdf', size }
```

### Two Steps

When something else holds the bytes (a browser, another service), create the files and upload separately:

```typescript
const { files } = await client.files.create([
  { filename: 'photo.jpg', mediaType: 'image/jpeg', size: 102400 },
  { filename: 'doc.pdf', mediaType: 'application/pdf', size: 204800 },
]);

for (const [index, file] of files.entries()) {
  await fetch(file.uploadUrl, {
    method: 'PUT',
    body: bytes[index],
    headers: { 'Content-Type': requests[index].mediaType },
  });
}

const reference = {
  id: files[0].id,
  mediaType: 'image/jpeg',
  url: files[0].downloadUrl,
  filename: 'photo.jpg',
  size: 102400,
};
```

`uploadUrl` is valid for 15 minutes; `downloadUrl` for 7 days. A file is `pending` until its bytes land and `uploaded` once they are confirmed. The [Client SDK](/docs/client-sdk/file-uploads) uses this two-step flow: your backend creates the files and the browser PUTs the bytes.

### For a Session

Both `create` and `upload` take a `sessionId` option, which records the session the file is uploaded for. It matters when the credential that will use the file is narrower than yours: an [ephemeral token](/docs/authentication/ephemeral-tokens) scoped to a session or an agent reaches only the files tied to its session or agent, so a file your project key created without a session is out of its reach, while one created for the session is not. Pass it when your backend uploads on behalf of a browser that triggers the platform directly with a session-scoped token (or let the browser create the file with its own token, which creates it under that scope). The session must be yours and active.

```typescript
const { files } = await client.files.create(
  [{ filename: 'photo.jpg', mediaType: 'image/jpeg', size: 102400 }],
  { sessionId },
);
```

## Where a File Goes

The same reference is accepted everywhere a protocol declares a `file` or `file[]`, including inside custom types:

```typescript
// A session input, on create()
const session = await client.sessions.create(agentId, { CONTRACT: contract });

// The first message of start(), with no session created before it
const chat = client.sessions.start({ agentId, input: { CONTRACT: contract } });
await chat.execute({ type: 'trigger', triggerName: 'user-message', input: { FILES: [photo] } });

// A trigger on an existing session
await session.execute({ type: 'trigger', triggerName: 'user-message', input: { FILES: [photo] } });

// A worker run
const { output } = await client.workers.generate(workerId, { IMAGE: photo });
```

Inside a run nothing is uploaded: an agent that delegates to a worker passes the file by its id, and the platform resolves it from the conversation. Files an agent produced (skill outputs, recordings) arrive as file parts and can be handed back as inputs the same way.

## Refreshing a Reference

A download URL ages out after 7 days. `get()` reads a file of the project with a fresh URL:

```typescript
const file = await client.files.get(reference.id);
// { id, filename, mediaType, size, status, downloadUrl, createdAt }

const refreshed = { ...reference, url: file.downloadUrl };
```

`status` is `pending` until the bytes have landed (checked when the file is read or used) and `uploaded` afterwards. A file of another project, or one outside the credential's scope, is not found.

## What the Platform Accepts

Every reference is validated where it enters, so a session only ever holds files its project owns:

- **A platform file** - uploaded through the Files API (or the session uploads route), or produced by an agent of the project - must be one the credential can reach, with its bytes uploaded. The platform rewrites the URL with its own signature and, for an uploaded file, takes the filename, media type, and size from its record.
- **A file you host yourself** is accepted too. Pass `{ id, mediaType, url }` with an `https:` URL and your own `id` (unique within the conversation). The platform accepts it without fetching, reads it only when a model needs the bytes - through its SSRF guard, which refuses private and internal addresses and re-validates every redirect, within the 100 MB limit - and never re-signs, copies, or archives it: the URL's availability and lifetime are yours, and `get()` does not know it.

A refused reference fails the call with an `OctavusError` coded `INVALID_FILE_REFERENCE`, naming the input and the file id:

```typescript
import { INVALID_FILE_REFERENCE_CODE, OctavusError } from '@octavus/server-sdk';

try {
  await client.workers.generate(workerId, { IMAGE: reference });
} catch (error) {
  if (error instanceof OctavusError && error.code === INVALID_FILE_REFERENCE_CODE) {
    // the file was never uploaded, belongs to another project, or is an http: URL
  }
}
```

With an [ephemeral credential](/docs/authentication/ephemeral-tokens), a file is created under the credential's scope and read by the credentials whose scope reaches it: an agent-scoped token reads the files created under its agent's scope and the files its agent's sessions uploaded or use, a session-scoped token the files of its one session, a project key every file of the project. To hand a scoped token a file your backend uploads, create it [for its session](#for-a-session).

## Limits and Types

| Limit                 | Value      |
| --------------------- | ---------- |
| Max file size         | 100 MB     |
| Max total per request | 200 MB     |
| Max files per request | 20         |
| Upload URL expiry     | 15 minutes |
| Download URL expiry   | 7 days     |

The supported media types are listed in the [API reference](/docs/api-reference/files#supported-types). Images, video, PDFs, and text are delivered to the model as file parts; office documents are surfaced to the agent as download URLs to process with code or skills.

## FilesApi Reference

```typescript
class FilesApi {
  // Upload one file and get its FileReference
  upload(
    data: Blob | Uint8Array | ArrayBuffer,
    meta: FileUploadMeta,
    options?: CreateFilesOptions,
  ): Promise<FileReference>;

  // Create files and get presigned upload + download URLs
  create(files: FileUploadRequest[], options?: CreateFilesOptions): Promise<UploadUrlsResponse>;

  // Read a file with a fresh download URL
  get(fileId: string): Promise<FileResource>;

  // A short-lived view URL for a file a session shows (null to fall back to the download URL)
  getViewUrl(sessionId: string, fileUrl: string): Promise<string | null>;

  /** @deprecated Use create(files, { sessionId }) */
  getUploadUrls(sessionId: string, files: FileUploadRequest[]): Promise<UploadUrlsResponse>;
}

interface FileUploadMeta {
  filename: string;
  mediaType: string; // the size is read from the data
}

interface CreateFilesOptions {
  sessionId?: string; // the session the files are uploaded for
}

interface FileUploadRequest {
  filename: string;
  mediaType: string;
  size: number;
}

interface UploadUrlsResponse {
  files: { id: string; uploadUrl: string; downloadUrl: string }[];
}

interface FileResource {
  id: string;
  filename: string;
  mediaType: string;
  size: number;
  status: 'pending' | 'uploaded';
  downloadUrl: string;
  createdAt: string;
}
```

## Next Steps

- [Workers](/docs/server-sdk/workers) - File inputs on worker runs
- [Client SDK File Uploads](/docs/client-sdk/file-uploads) - Uploading from the browser
- [Workforce Agents](/docs/workforce-agents/sdk) - Hosting files for a dispatch
