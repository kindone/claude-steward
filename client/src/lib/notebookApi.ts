/**
 * Client API for project-embedded notebooks.
 *
 * Notebooks live at <projectPath>/notebooks/<name>/
 * Cells live at <projectPath>/notebooks/<name>/cells/<prefix>_<cellName>.<ext>
 */

export interface NotebookInfo {
  name: string
}

export interface CellInfo {
  filename: string
  prefix: string
  name: string
  ext: string
}

export interface SaveCellResult {
  filename: string
  notebookName: string
  path: string  // relative to project: e.g. "notebooks/analysis/cells/01_load.py"
}

export async function listNotebooks(projectId: string): Promise<NotebookInfo[]> {
  const res = await fetch(`/api/projects/${projectId}/notebooks`, {
    credentials: 'include',
  })
  if (!res.ok) throw new Error(`Failed to list notebooks: ${res.statusText}`)
  return res.json() as Promise<NotebookInfo[]>
}

export async function createNotebook(projectId: string, name: string): Promise<NotebookInfo> {
  const res = await fetch(`/api/projects/${projectId}/notebooks`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? `Failed to create notebook: ${res.statusText}`)
  }
  return res.json() as Promise<NotebookInfo>
}

export async function listCells(projectId: string, notebookName: string): Promise<CellInfo[]> {
  const res = await fetch(
    `/api/projects/${projectId}/notebooks/${encodeURIComponent(notebookName)}/cells`,
    { credentials: 'include' }
  )
  if (!res.ok) throw new Error(`Failed to list cells: ${res.statusText}`)
  return res.json() as Promise<CellInfo[]>
}

export async function saveCell(
  projectId: string,
  notebookName: string,
  opts: { cellName: string; code: string; language: string },
): Promise<SaveCellResult> {
  const res = await fetch(
    `/api/projects/${projectId}/notebooks/${encodeURIComponent(notebookName)}/cells`,
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts),
    }
  )
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? `Failed to save cell: ${res.statusText}`)
  }
  return res.json() as Promise<SaveCellResult>
}
