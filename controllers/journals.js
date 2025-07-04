const { pool } = require('../utils/config')
const journalRouter = require('express').Router()

journalRouter.get('/', async(request, response) => {
  const { rows } = await pool.query('SELECT * FROM journals')
  response.send(rows)
})

module.exports = journalRouter