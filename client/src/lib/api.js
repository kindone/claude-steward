const API_KEY = import.meta.env.VITE_API_KEY;
const authHeaders = () => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${API_KEY}`,
});
// ── Projects ──────────────────────────────────────────────────────────────────
export async function listProjects() {
    const res = await fetch('/api/projects', { headers: authHeaders() });
    if (!res.ok)
        throw new Error('Failed to list projects');
    return res.json();
}
export async function createProject(name, path) {
    const res = await fetch('/api/projects', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ name, path }),
    });
    if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(body.error ?? 'Failed to create project');
    }
    return res.json();
}
export async function fetchMeta() {
    const res = await fetch('/api/meta');
    if (!res.ok)
        throw new Error('Failed to fetch meta');
    return res.json();
}
export async function updateProject(projectId, patch) {
    const res = await fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify(patch),
    });
    if (!res.ok)
        throw new Error('Failed to update project');
    return res.json();
}
export async function deleteProject(projectId) {
    const res = await fetch(`/api/projects/${projectId}`, {
        method: 'DELETE',
        headers: authHeaders(),
    });
    if (!res.ok)
        throw new Error('Failed to delete project');
}
export async function listFiles(projectId, filePath = '') {
    const url = `/api/projects/${projectId}/files${filePath ? `?path=${encodeURIComponent(filePath)}` : ''}`;
    const res = await fetch(url, { headers: authHeaders() });
    if (!res.ok)
        throw new Error('Failed to list files');
    return res.json();
}
export async function getFileContent(projectId, filePath) {
    const res = await fetch(`/api/projects/${projectId}/files/content?path=${encodeURIComponent(filePath)}`, { headers: authHeaders() });
    if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(body.error ?? 'Failed to load file');
    }
    const data = await res.json();
    return data.content;
}
// ── Sessions ──────────────────────────────────────────────────────────────────
export async function createSession(projectId) {
    const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ projectId }),
    });
    if (!res.ok)
        throw new Error('Failed to create session');
    return res.json();
}
export async function listSessions(projectId) {
    const url = projectId ? `/api/sessions?projectId=${projectId}` : '/api/sessions';
    const res = await fetch(url, { headers: authHeaders() });
    if (!res.ok)
        throw new Error('Failed to list sessions');
    return res.json();
}
export async function getMessages(sessionId) {
    const res = await fetch(`/api/sessions/${sessionId}/messages`, { headers: authHeaders() });
    if (!res.ok)
        throw new Error('Failed to load messages');
    return res.json();
}
export async function renameSession(sessionId, title) {
    const res = await fetch(`/api/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ title }),
    });
    if (!res.ok)
        throw new Error('Failed to rename session');
    return res.json();
}
export async function updateSystemPrompt(sessionId, systemPrompt) {
    const res = await fetch(`/api/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ systemPrompt }),
    });
    if (!res.ok)
        throw new Error('Failed to update system prompt');
    return res.json();
}
export async function updatePermissionMode(sessionId, permissionMode) {
    const res = await fetch(`/api/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ permissionMode }),
    });
    if (!res.ok)
        throw new Error('Failed to update permission mode');
    return res.json();
}
export async function deleteSession(sessionId) {
    const res = await fetch(`/api/sessions/${sessionId}`, {
        method: 'DELETE',
        headers: authHeaders(),
    });
    if (!res.ok)
        throw new Error('Failed to delete session');
}
// Connect to the app-level SSE stream. Reconnects automatically on drop.
// Returns a cancel function to close the connection.
export function subscribeToAppEvents(handlers) {
    let cancelled = false;
    let controller = new AbortController();
    async function connect() {
        if (cancelled)
            return;
        controller = new AbortController();
        try {
            const res = await fetch('/api/events', {
                headers: authHeaders(),
                signal: controller.signal,
            });
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            while (true) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() ?? '';
                let pendingEvent = '';
                for (const line of lines) {
                    if (line.startsWith('event: ')) {
                        pendingEvent = line.slice(7).trim();
                        continue;
                    }
                    if (line.startsWith('data: ')) {
                        if (pendingEvent === 'reload')
                            handlers.onReload?.();
                        pendingEvent = '';
                    }
                }
            }
        }
        catch (err) {
            if (err.name === 'AbortError')
                return;
        }
        // Reconnect after 3s on unexpected drop
        if (!cancelled)
            setTimeout(connect, 3000);
    }
    connect();
    return () => { cancelled = true; controller.abort(); };
}
export function sendMessage(sessionId, message, handlers) {
    const controller = new AbortController();
    fetch('/api/chat', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ sessionId, message }),
        signal: controller.signal,
    })
        .then(async (res) => {
        if (!res.ok) {
            const body = await res.text();
            handlers.onError(`HTTP ${res.status}: ${body}`, 'http_error');
            return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let activityFired = false;
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            if (!activityFired) {
                activityFired = true;
                handlers.onActivity?.();
            }
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';
            let pendingEvent = '';
            for (const line of lines) {
                if (line.startsWith('event: ')) {
                    pendingEvent = line.slice(7).trim();
                }
                else if (line.startsWith('data: ')) {
                    const raw = line.slice(6);
                    if (pendingEvent === 'done') {
                        handlers.onDone();
                    }
                    else if (pendingEvent === 'title') {
                        try {
                            const payload = JSON.parse(raw);
                            handlers.onTitle?.(payload.title);
                        }
                        catch { /* ignore */ }
                    }
                    else if (pendingEvent === 'error') {
                        try {
                            const payload = JSON.parse(raw);
                            handlers.onError(payload.message, payload.code);
                        }
                        catch {
                            handlers.onError(raw);
                        }
                    }
                    else if (pendingEvent === 'chunk') {
                        try {
                            const chunk = JSON.parse(raw);
                            if (chunk.type === 'stream_event') {
                                const evt = chunk.event;
                                if (evt?.type === 'content_block_start' && evt.content_block?.type === 'tool_use') {
                                    handlers.onToolActivity?.(evt.content_block.name ?? 'tool');
                                }
                                else if (evt?.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
                                    handlers.onToolActivity?.(null); // clear indicator when text arrives
                                    handlers.onTextDelta(evt.delta.text);
                                }
                            }
                        }
                        catch {
                            // ignore malformed chunks
                        }
                    }
                    pendingEvent = '';
                }
            }
        }
    })
        .catch((err) => {
        if (err.name !== 'AbortError') {
            handlers.onError(err.message);
        }
    });
    return () => controller.abort();
}
