const { Pool } = require('pg')
require('dotenv').config()

// Create database connection
const PORT = process.env.PORT
const DB_URI = process.env.DB_URI_TEST

const pool = new Pool({
  connectionString: DB_URI
})


// Handle pool events
pool.on('connect', () => {
  console.log('New client connected to PostgreSQL')
})

pool.on('error', (err) => {
  console.error('Unexpected error on idle client:', err)
})

module.exports = {
  PORT,
  pool
}