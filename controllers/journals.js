const { verifyToken } = require('../utils/auth')
const { pool } = require('../utils/config')
const journalRouter = require('express').Router()

journalRouter.get('/', verifyToken, async (request, response) => {
  try {
    const { rows } = await pool.query('SELECT * FROM journal_entries')
    response.json(rows)
  } catch (error) {
    console.error('Error fetching journals:', error)
    response.status(500).json({ error: 'Failed to fetch journals' })
  }
})

journalRouter.post('/', verifyToken, async (request, response) => {
  try {
    const journalBody = request.body

    const { user_id, title, content, emotions } = journalBody
    if (!user_id || !title || !content) {
      return response.status(400).json({ error: 'Missing required fields: user_id, title, content' })
    }

    const journalQuery = await pool.query(
      `INSERT INTO journal_entries(user_id, title, content, emotions)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [user_id, title, content, emotions]
    )

    response.status(201).json(journalQuery.rows[0])
  } catch (error) {
    console.error('Error creating journal entry:', error)
    response.status(500).json({ error: 'Failed to create journal entry' })
  }
})

module.exports = journalRouter