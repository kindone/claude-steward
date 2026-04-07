/**
 * Manages the lifecycle of a steward schedule for an artifact's automatic refresh.
 *
 * When an artifact has both `refresh_schedule` (cron) and `refresh_command` in its
 * metadata, a schedule is created (or updated) that fires at that cron time and
 * instructs Claude to run the command and write the result to the artifact file.
 *
 * When either field is cleared, or when the artifact is deleted, the schedule is removed.
 */

import crypto from 'node:crypto'
import path from 'node:path'
import { artifactQueries, scheduleQueries, sessionQueries, projectQueries } from '../db/index.js'
import { nextFireAt } from './scheduler.js'

const REFRESH_LABEL_PREFIX = 'artifact:refresh:'

function refreshLabel(artifactId: string): string {
  return REFRESH_LABEL_PREFIX + artifactId
}

/**
 * Called after artifact metadata is updated.
 * Creates, updates, or deletes the steward schedule for this artifact's refresh.
 */
export function syncArtifactSchedule(artifactId: string): void {
  const artifact = artifactQueries.findById(artifactId)
  if (!artifact) return

  const label = refreshLabel(artifactId)

  // Parse refresh fields from metadata
  let refreshCommand = ''
  let refreshSchedule = ''
  if (artifact.metadata) {
    try {
      const m = JSON.parse(artifact.metadata) as Record<string, unknown>
      refreshCommand = (m.refresh_command as string) ?? ''
      refreshSchedule = (m.refresh_schedule as string) ?? ''
    } catch { /* ignore parse errors */ }
  }

  const existing = scheduleQueries.findByLabel(label)

  // If no schedule needed, delete existing if any
  if (!refreshCommand || !refreshSchedule) {
    if (existing) scheduleQueries.delete(existing.id)
    return
  }

  // Get project info for file paths
  const project = projectQueries.findById(artifact.project_id)
  if (!project) return

  const absPath = path.join(project.path, artifact.path)

  // Build the prompt Claude will execute when the schedule fires
  const prompt = [
    `Refresh artifact "${artifact.name}":`,
    `Run \`${refreshCommand}\` in directory \`${project.path}\` and write the stdout output to \`${absPath}\`.`,
    `If the command fails, write the error to stderr only and do not modify the artifact file.`,
    `Do not explain or add commentary — just execute silently.`,
  ].join('\n')

  if (existing) {
    // Update in place
    const nextRun = nextFireAt(refreshSchedule)
    scheduleQueries.update(existing.id, {
      cron: refreshSchedule,
      prompt,
      enabled: true,
      nextRunAt: nextRun,
    })
    return
  }

  // Need a session to attach the schedule to.
  // Find or create a background refresh session for this project.
  const sessionId = getOrCreateRefreshSession(artifact.project_id)

  scheduleQueries.create(
    crypto.randomUUID(),
    sessionId,
    refreshSchedule,
    prompt,
    nextFireAt(refreshSchedule),
    false,   // once
    label,   // label — the unique upsert key
    null,    // condition
    null,    // expires_at
  )
}

/**
 * Deletes the schedule for an artifact (if one exists).
 * Call before deleting the artifact.
 */
export function cleanupArtifactSchedule(artifactId: string): void {
  const label = refreshLabel(artifactId)
  const existing = scheduleQueries.findByLabel(label)
  if (existing) scheduleQueries.delete(existing.id)
}

/**
 * Finds or creates a background session for artifact refresh jobs in this project.
 * Uses a stable title so we can recognise it on subsequent lookups.
 */
const REFRESH_SESSION_TITLE = '__artifact_refresh__'

function getOrCreateRefreshSession(projectId: string): string {
  // Look for an existing background refresh session for this project
  const existing = sessionQueries
    .listByProject(projectId)
    .find((s) => s.title === REFRESH_SESSION_TITLE)

  if (existing) return existing.id

  const id = crypto.randomUUID()
  sessionQueries.create(id, REFRESH_SESSION_TITLE, projectId, null)
  return id
}
