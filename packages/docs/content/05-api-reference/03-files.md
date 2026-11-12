---
title: Files
description: Upload files once as project resources and reference them anywhere a protocol takes a file.
---

# Files

A file is a resource of your project. Reserve it with the Files API, upload the bytes straight to storage, and pass the resulting `FileReference` wherever a protocol takes a `file` - a session input, a trigger input, a worker run's input, or a [Workforce dispatch](/docs/workforce-agents/api-reference). No session is needed to upload, and uploading consumes none.

Files are uploaded directly to storage through presigned URLs; the bytes never pass through the platform.

## Create Uploads

Reserve files in the project and get presigned URLs to upload them with.

```
POST /api/v1/files
```

Requires a project key with the Sessions permission, or an [ephemeral credential](/docs/authentication/ephemeral-tokens) of the project (the files are created under its scope).

### Request Body

```json
{
  "files": [
    {
      "filename": "photo.jpg",
      "mediaType": "image/jpeg",
      "size": 102400
    }
  ]
}
```

| Field               | Type   | Required | Description                         |
| ------------------- | ------ | -------- | ----------------------------------- |
| `files`             | array  | Yes      | Array of file metadata (1-20 files) |
| `files[].filename`  | string | Yes      | Original filename                   |
| `files[].mediaType` | string | Yes      | MIME type (e.g., `image/png`)       |
| `files[].size`      | number | Yes      | File size in bytes                  |

### Response

`201`:

```json
{
  "files": [
    {
      "id": "1762900000000-k3x9q2p",
      "uploadUrl": "https://s3.amazonaws.com/bucket/key?...",
      "downloadUrl": "https://s3.amazonaws.com/bucket/key?..."
    }
  ]
}
```

### Upload Flow

1. Request upload URLs
2. PUT each file's content to its `uploadUrl` with the declared `Content-Type` header (the URL is valid for 15 minutes)
3. Build the `FileReference`: `{ id, mediaType, url: downloadUrl, filename, size }` (add `width` and `height` for an image when you know them)
4. Pass the reference wherever the protocol takes a `file`

The reference is accepted by any session, run, or dispatch of the project the credential can reach. The platform checks the file exists where it is used: a reserved slot whose bytes never landed is refused.

## Get File

Read a file with a fresh download URL - the way to refresh a reference whose URL aged out.

```
GET /api/v1/files/:id
```

### Response

```json
{
  "id": "1762900000000-k3x9q2p",
  "filename": "photo.jpg",
  "mediaType": "image/jpeg",
  "size": 102400,
  "status": "uploaded",
  "downloadUrl": "https://s3.amazonaws.com/bucket/key?...",
  "createdAt": "2026-11-11T10:30:00.000Z"
}
```

| Field         | Description                                                                      |
| ------------- | -------------------------------------------------------------------------------- |
| `status`      | `pending` until the upload is confirmed (checked on read), `uploaded` afterwards |
| `size`        | The declared size while `pending`; the stored object's size once `uploaded`      |
| `downloadUrl` | A freshly signed URL, valid for 7 days                                           |

A file of another project, or one outside the credential's scope, is `404`: knowing an id is never, by itself, access.

## File References

A `FileReference` is accepted in a session input, a trigger input, a worker input, a tool result's `files`, and a Workforce dispatch's `files`:

```typescript
interface FileReference {
  id: string; // The file id (platform-generated for a platform file)
  mediaType: string; // IANA media type
  url: string; // The download URL
  filename?: string;
  size?: number;
  width?: number; // Image dimensions, when known
  height?: number;
}
```

Every reference is validated where it enters, so a session only ever holds files its project owns:

| The reference points at                                                                      | Rule                                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A file uploaded through the Files API, the session uploads route, or a Workforce files route | Must be a file of the caller's project that the credential can read, with its bytes uploaded. The platform rewrites the URL with its own signature and takes the filename, media type, and size from its record           |
| A file an agent of the project produced (a skill output, a recording)                        | Must belong to a session of the caller's project that the credential can read. Agent-produced files stay usable as inputs                                                                                                 |
| A URL you host yourself (`https:` only)                                                      | Accepted as it is, without fetching. The platform reads it only when a model needs the bytes, through its SSRF guard and within the 100 MB limit; it never re-signs, copies, or archives it, so its availability is yours |

A refused reference is `400` with the code `INVALID_FILE_REFERENCE`, naming the input and the file id:

```json
{
  "error": "Invalid file reference in \"FILES[0]\" (file 1762900000000-k3x9q2p): the file has not been uploaded",
  "code": "INVALID_FILE_REFERENCE",
  "type": "validation_error",
  "retryable": false,
  "requestId": "req_8f2c41d07a9b4e6c"
}
```

### Scoped Credentials

An [ephemeral credential](/docs/authentication/ephemeral-tokens) reads the files it could already reach: an agent-scoped token, the files created under its agent's scope and the files its agent's sessions use or produced; a session-scoped token, the files created under or used by its one session. A project key reads every file of the project. Files are created under the scope of the credential that reserved them, so a browser holding a session-scoped token can upload for its session and nothing else.

## Supported Types

| Category         | Media Types                                                                                                                                                                                                                                                                                                                                                             |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Images           | `image/jpeg`, `image/png`, `image/gif`, `image/webp`, `image/svg+xml`                                                                                                                                                                                                                                                                                                   |
| Video            | `video/mp4`, `video/webm`, `video/quicktime`, `video/mpeg`                                                                                                                                                                                                                                                                                                              |
| Audio            | `audio/mpeg`, `audio/wav`, `audio/webm`, `audio/mp4`, `audio/x-m4a`                                                                                                                                                                                                                                                                                                     |
| Documents        | `application/pdf`, `text/plain`, `text/markdown`, `text/csv`, `text/html`, `application/json`, `application/yaml`, `text/yaml`, `application/x-yaml`, `application/xml`, `application/zip`, `application/octet-stream`                                                                                                                                                  |
| Code             | `text/x-python`, `text/javascript`, `text/typescript`                                                                                                                                                                                                                                                                                                                   |
| Office documents | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` (`.docx`), `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` (`.xlsx`), `application/vnd.openxmlformats-officedocument.presentationml.presentation` (`.pptx`), `application/msword` (`.doc`), `application/vnd.ms-excel` (`.xls`), `application/vnd.ms-powerpoint` (`.ppt`) |

## Limits

| Limit                 | Value      |
| --------------------- | ---------- |
| Max file size         | 100 MB     |
| Max total per request | 200 MB     |
| Max files per request | 20         |
| Upload URL expiry     | 15 minutes |
| Download URL expiry   | 7 days     |

Files live with their project; nothing deletes them. The upload size is enforced when the file is confirmed, so an object larger than the limit is refused where it is used.
