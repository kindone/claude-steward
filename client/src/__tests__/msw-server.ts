import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import type { Project, Session, FileEntry } from '../lib/api'

export const mockProjects: Project[] = [
  { id: 'proj-1', name: 'my-project', path: '/home/user/my-project', allow_all_tools: 0, permission_mode: 'acceptEdits', system_prompt: null, created_at: 1000 },
  { id: 'proj-2', name: 'other-project', path: '/home/user/other', allow_all_tools: 0, permission_mode: 'acceptEdits', system_prompt: null, created_at: 2000 },
]

export const mockSessions: Session[] = [
  { id: 'ses-1', title: 'First chat', claude_session_id: null, project_id: 'proj-1', system_prompt: null, permission_mode: 'acceptEdits', timezone: null, model: null, compacted_from: null, created_at: 1000, updated_at: 1000 },
  { id: 'ses-2', title: 'Second chat', claude_session_id: null, project_id: 'proj-1', system_prompt: null, permission_mode: 'acceptEdits', timezone: null, model: null, compacted_from: null, created_at: 2000, updated_at: 2000 },
]

export const mockFiles: FileEntry[] = [
  { name: 'src', type: 'directory', path: 'src' },
  { name: 'README.md', type: 'file', path: 'README.md' },
]

export const handlers = [
  http.get('/api/projects', () => HttpResponse.json(mockProjects)),

  http.post('/api/projects', async ({ request }) => {
    const body = await request.json() as { name: string; path: string }
    const project: Project = {
      id: 'new-proj-id',
      name: body.name,
      path: body.path,
      allow_all_tools: 0,
      permission_mode: 'acceptEdits',
      system_prompt: null,
      created_at: Date.now(),
    }
    return HttpResponse.json(project, { status: 201 })
  }),

  http.delete('/api/projects/:id', () => new HttpResponse(null, { status: 204 })),

  http.get('/api/sessions', () => HttpResponse.json(mockSessions)),

  http.post('/api/sessions', async ({ request }) => {
    const body = await request.json() as { projectId?: string }
    const session: Session = {
      id: 'new-ses-id',
      title: 'New Chat',
      claude_session_id: null,
      project_id: body.projectId ?? null,
      system_prompt: null,
      permission_mode: 'acceptEdits',
      timezone: null,
      model: null,
      compacted_from: null,
      created_at: Date.now(),
      updated_at: Date.now(),
    }
    return HttpResponse.json(session, { status: 201 })
  }),

  http.delete('/api/sessions/:id', () => new HttpResponse(null, { status: 204 })),

  http.get('/api/projects/:id/files', () => HttpResponse.json(mockFiles)),

  http.get('/api/projects/:id/files/content', () =>
    HttpResponse.json({ content: '# Hello\n', path: 'README.md' })
  ),
]

export const server = setupServer(...handlers)
