# File Browser, Viewer & Editor

Part of the [Server](server.md) (API routes) and [Client](client.md) (React components). Linked from [Architecture](architecture.md).

Lets users browse, view, and edit the files of any project without leaving the app. Designed as a read-mostly tool; Claude does most editing via chat sessions, but the viewer and editor are useful for quick inspection and small manual changes.

---

## Server Routes

All routes require authentication and live under `/api/projects/:id/files*`.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/projects/:id/files?path=` | Directory listing (dotfiles hidden) |
| `GET` | `/api/projects/:id/files/content?path=` | UTF-8 file content + `lastModified` mtime (1 MB cap) |
| `GET` | `/api/projects/:id/files/raw?path=` | Binary file served with detected MIME type; used for image preview |
| `PATCH` | `/api/projects/:id/files` | Write new content atomically (see below) |
| `POST` | `/api/projects/:id/files/upload` | Multipart file upload (multer); max 50 MB / 20 files |

All paths are validated through `safeResolvePath()`, which calls `path.resolve(projectRoot, userPath)` and rejects anything whose resolved form doesn't start with the resolved project root. This prevents directory traversal.

### Directory listing

Returns `FileEntry[]`:

```ts
type FileEntry = { name: string; path: string; type: 'file' | 'directory' }
```

Dotfiles are filtered out of the response. Directories must be expanded one level at a time; the tree component calls the endpoint recursively on expand.

### Raw endpoint

Used exclusively for image preview — the content endpoint reads with `utf8` which corrupts binary data. The raw endpoint reads the file as a `Buffer` and sets an appropriate `Content-Type` from a local extension map (png, jpg, gif, svg, webp, avif, ico, bmp, pdf). Non-image types get `application/octet-stream`.

### File upload (`POST /upload`)

Accepts `multipart/form-data` with a `files` field (up to 20 files, 50 MB each) and an optional `targetPath` field specifying the subdirectory within the project to upload into. The target directory is created recursively if it doesn't exist. Filenames are sanitized (path separators replaced with `_`). Returns `{ uploaded: [{ name, path, size }] }`.

nginx must have `client_max_body_size 55m` (or higher) to avoid 413 errors before the request reaches Express.

### Raw endpoint with download mode

The raw endpoint accepts an optional `?download=1` query parameter which adds a `Content-Disposition: attachment` header, triggering a browser download dialog instead of inline display.

### Atomic write with optimistic locking (`PATCH`)

Body: `{ path: string, content: string, lastModified?: number, force?: boolean }`

The write is always atomic: content is written to a `.steward-tmp` sibling file, then `fs.renameSync` moves it into place. This prevents partial writes visible to Claude or other processes.

**Optimistic locking:** if `lastModified` is supplied and `force` is not set, the server compares `Math.floor(fs.statSync(path).mtimeMs)` against `Math.floor(lastModified)`. A mismatch means the file changed on disk since the client last fetched it; the server returns `409 Conflict`. The client then shows a banner with two options:

- **Overwrite** — re-sends the request with `force: true`, skipping the mtime check
- **Reload file** — fetches fresh content, updates `lastModified`, discards the user's draft

On success the server responds with `{ lastModified: number }` (the new mtime after write) so the client can update its reference without a separate fetch.

---

## Client Components

### `FileTree`

Located in `SessionSidebar` as the **Files** tab content. Two rendering modes:

- **`alwaysExpanded`** (Files tab) — fills full sidebar height; no toggle button; scrollable
- **Collapsed by default** (Sessions tab) — toggle button + 200px max-height; kept for quick reference

Lazily loads one directory level at a time via `listFiles()`. Expanded directories are tracked in a `Set<string>` state.

File entries dispatch `openFile(path)` on click. Directories dispatch `toggleDir(path)`.

### `FileViewer`

Rendered via `createPortal(…, document.body)` to escape the sidebar's CSS `transform` containing block (the mobile slide animation). Without the portal, `position: fixed` would be relative to the sidebar rather than the viewport.

**Modal dimensions:** `min(96vw, 1200px)` × `min(92dvh, 900px)`. Overlay padding `p-2` on mobile, `p-6` on desktop.

**View modes by file type:**

| File type | Rendering |
|---|---|
| Images (`png/jpg/gif/svg/webp/avif/ico/bmp`) | `<img src="/files/raw?path=…">` — skips content fetch entirely |
| Markdown (`.md/.mdx`) | `marked.parse(content)` rendered as HTML with `.prose` styles |
| Code / text | `hljs.highlight(content, { language })` or `hljs.highlightAuto()`; line-number gutter |

The language badge in the header shows the detected language (mapped from file extension). Escape closes the modal (unless editing with unsaved changes).

### Edit mode

Triggered by the **Edit** button (not shown for images). Switches the body to a full-height monospace `<textarea>`. A `●` dot appears in the header when the draft differs from the saved content.

- **Save** — calls `patchFile(projectId, path, draft, lastModified)`
- **Cancel** — prompts `window.confirm` if there are unsaved changes
- **Cmd/Ctrl+S** — saves while editing
- **Escape** — cancels without prompt if the draft is clean; stays open if dirty

On `409 Conflict`, a yellow banner appears offering Overwrite or Reload. On other errors, a red banner shows the message.

After a successful save, `displayContent` and `lastModified` are updated in local state. The next open of the same file re-fetches from disk.

---

## API Functions (`api.ts`)

| Function | Description |
|---|---|
| `listFiles(projectId, path?)` | `GET /files` — returns `FileEntry[]` |
| `getFileContent(projectId, path)` | Returns `{ content: string, lastModified: number }` |
| `patchFile(projectId, path, content, lastModified?, force?)` | Returns `{ lastModified: number }`; throws `FileConflictError` on 409 |
| `uploadFiles(projectId, files, targetPath?, onProgress?)` | `POST /files/upload`; uses XHR for upload progress; returns `{ uploaded: UploadedFile[] }` |

`FileConflictError` extends `Error` with `name = 'FileConflictError'` for `instanceof` checks.

---

## Upload & Download UI

### FileTree upload

Both rendering modes (alwaysExpanded and collapsed) show an **↑ Upload** button in the header. The Files tab also supports **drag-and-drop** — dropping files onto the tree uploads them to the currently viewed directory. A progress bar appears during upload, and the directory listing refreshes automatically on completion.

### FileViewer download

The file viewer modal header includes a **↓ Download** link that opens the raw endpoint with `?download=1`.

### Chat file attachment (MessageInput)

The message input has a **📎 paperclip** button and accepts **drag-and-drop** on the textarea container. Selected files appear as removable chips below the input. On send:

1. Files are uploaded to the project's `uploads/` directory via `uploadFiles()`
2. The user's text message (or auto-generated "Please read and analyze…") is prepended with file paths
3. Claude receives the message and can read the uploaded files using its `Read` tool (which is multimodal — supports images, PDFs, etc.)
