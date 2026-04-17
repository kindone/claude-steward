import { Router } from 'express'
import { renderMdArt } from 'mdart'

const router = Router()

/** POST /api/mdart/render — render mdart source to SVG */
router.post('/render', (req, res) => {
  const { source } = req.body as { source?: string }
  if (typeof source !== 'string') {
    res.status(400).json({ error: 'source string required' })
    return
  }
  try {
    const svg = renderMdArt(source)
    res.json({ svg })
  } catch (err) {
    res.status(422).json({ error: String(err) })
  }
})

export default router
