const { verifyToken } = require('../utils/auth')
const { pool } = require('../utils/config')
const { getEmotion } = require('../utils/services/emotion')
const journalRouter = require('express').Router()

journalRouter.get('/', verifyToken, async (request, response) => {
  try {
    // Get user_id from authenticated user
    const firebaseUid = request.user.uid

    const userResult = await pool.query('SELECT user_id FROM users WHERE firebase_uid = $1', [firebaseUid])

    if (userResult.rows.length === 0) {
      return response.status(404).json({ error: 'User not found' })
    }

    const userId = userResult.rows[0].user_id

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
    const userResult = await pool.query('SELECT user_id FROM users WHERE firebase_uid = $1', [firebaseUid])

    if (userResult.rows.length === 0) {
      return response.status(404).json({ error: 'User not found' })
    }

    const userId = userResult.rows[0].user_id

    // Handle emotions properly for PostgreSQL JSONB
    const emotions = await getEmotion(content)

    const emotionsJson = emotions ? JSON.stringify(emotions) : null

    const journalQuery = await pool.query(
      `INSERT INTO journal_entries(user_id, title, content, emotions)
       VALUES ($1, $2, $3, $4::jsonb)
       RETURNING journal_id, title, content, emotions`,
      [userId, title, content, emotionsJson]
    )

    response.status(201).json(journalQuery.rows[0])
  } catch (error) {
    console.error('Error creating journal entry:', error)
    response.status(500).json({ error: 'Failed to create journal entry' })
  }
})

journalRouter.put('/:id', verifyToken, async (request, response) => {
  try {
    const firebaseUid = request.user.uid
    const journalId = request.params.id
    const { title, content } = request.body

    if (!title || !content) {
      return response.status(400).json({ error: 'Missing required fields: title, content' })
    }

    // Get user_id from authenticated user
    const userResult = await pool.query('SELECT user_id FROM users WHERE firebase_uid = $1', [firebaseUid])

    if (userResult.rows.length === 0) {
      return response.status(404).json({ error: 'User not found' })
    }

    const userId = userResult.rows[0].user_id

    // Check if journal entry exists and belongs to the user
    const existingJournal = await pool.query(
      'SELECT journal_id FROM journal_entries WHERE journal_id = $1 AND user_id = $2',
      [journalId, userId]
    )

    if (existingJournal.rows.length === 0) {
      return response.status(404).json({ error: 'Journal entry not found or access denied' })
    }

    // Get updated emotions for the new content
    const emotions = await getEmotion(content)
    const emotionsJson = emotions ? JSON.stringify(emotions) : null

    const updateQuery = await pool.query(
      `UPDATE journal_entries 
       SET title = $1, content = $2, emotions = $3::jsonb, updated_at = CURRENT_TIMESTAMP
       WHERE journal_id = $4 AND user_id = $5
       RETURNING journal_id, title, content, emotions, created_at, updated_at`,
      [title, content, emotionsJson, journalId, userId]
    )

    response.json(updateQuery.rows[0])
  } catch (error) {
    console.error('Error updating journal entry:', error)
    response.status(500).json({ error: 'Failed to update journal entry' })
  }
})

journalRouter.patch('/:id/favourite', verifyToken, async (request, response) => {
  try {
    const firebaseUid = request.user.uid
    const journalId = request.params.id
    const { favourite } = request.body

    if (typeof favourite !== 'boolean') {
      return response.status(400).json({ error: 'Missing or invalid field: favourite must be boolean' })
    }

    const userResult = await pool.query('SELECT user_id FROM users WHERE firebase_uid = $1', [firebaseUid])

    if (userResult.rows.length === 0) {
      return response.status(404).json({ error: 'User not found' })
    }

    const userId = userResult.rows[0].user_id

    const updateQuery = await pool.query(
      `UPDATE journal_entries
       SET favourite = $1
       WHERE journal_id = $2 AND user_id = $3
       RETURNING journal_id, favourite`,
      [favourite, journalId, userId]
    )

    if (updateQuery.rows.length === 0) {
      return response.status(404).json({ error: 'Journal entry not found or access denied' })
    }

    response.json(updateQuery.rows[0])
  } catch (error) {
    console.error('Error updating journal favourite:', error)
    response.status(500).json({ error: 'Failed to update journal favourite' })
  }
})

journalRouter.delete('/:id', verifyToken, async (request, response) => {
  try {
    const firebaseUid = request.user.uid
    const journalId = request.params.id

    // Get user_id from authenticated user
    const userResult = await pool.query('SELECT user_id FROM users WHERE firebase_uid = $1', [firebaseUid])

    if (userResult.rows.length === 0) {
      return response.status(404).json({ error: 'User not found' })
    }

    const userId = userResult.rows[0].user_id

    // Check if journal entry exists and belongs to the user, then delete
    const deleteQuery = await pool.query(
      'DELETE FROM journal_entries WHERE journal_id = $1 AND user_id = $2 RETURNING journal_id',
      [journalId, userId]
    )

    if (deleteQuery.rows.length === 0) {
      return response.status(404).json({ error: 'Journal entry not found or access denied' })
    }

    response.json({ message: 'Journal entry deleted successfully', journal_id: deleteQuery.rows[0].journal_id })
  } catch (error) {
    console.error('Error deleting journal entry:', error)
    response.status(500).json({ error: 'Failed to delete journal entry' })
  }
})

module.exports = journalRouter