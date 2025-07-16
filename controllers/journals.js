const { verifyToken } = require('../utils/auth')
const { pool } = require('../utils/config')
const { getEmotion } = require('../utils/services/emotion')
const journalRouter = require('express').Router()

journalRouter.get('/', verifyToken, async (request, response) => {
  try {
    // Get user_id from authenticated user
    const firebaseUid = request.user.uid

    const userResult = await pool.query('SELECT id FROM users WHERE firebase_uid = $1', [firebaseUid])

    if (userResult.rows.length === 0) {
      return response.status(404).json({ error: 'User not found' })
    }

    const userId = userResult.rows[0].id

    const { rows } = await pool.query('SELECT * FROM journal_entries WHERE user_id = $1 ORDER BY created_at DESC', [userId])
    response.json(rows)
  } catch (error) {
    console.error('Error fetching journals:', error)
    response.status(500).json({ error: 'Failed to fetch journals' })
  }
})

journalRouter.post('/', verifyToken, async (request, response) => {
  try {
    const firebaseUid = request.user.uid
    const { title, content } = request.body

    if (!title || !content) {
      return response.status(400).json({ error: 'Missing required fields: title, content' })
    }

    // Get user_id from authenticated user instead of request body
    const userResult = await pool.query('SELECT id FROM users WHERE firebase_uid = $1', [firebaseUid])

    if (userResult.rows.length === 0) {
      return response.status(404).json({ error: 'User not found' })
    }

    const userId = userResult.rows[0].id

    // Handle emotions properly for PostgreSQL JSONB
    const emotions = await getEmotion(content)

    const emotionsJson = emotions ? JSON.stringify(emotions) : null

    const journalQuery = await pool.query(
      `INSERT INTO journal_entries(user_id, title, content, emotions)
       VALUES ($1, $2, $3, $4::jsonb)
       RETURNING *`,
      [userId, title, content, emotionsJson]
    )

    response.status(201).json(journalQuery.rows[0])
  } catch (error) {
    console.error('Error creating journal entry:', error)
    response.status(500).json({ error: 'Failed to create journal entry' })
  }
})

module.exports = journalRouter