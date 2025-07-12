const { Pool } = require('pg')
require('dotenv').config()

//Create database connection
const PORT = process.env.PORT
const pool = new Pool({
  connectionString: process.env.DB_URI
})

module.exports = {
  PORT,
  pool
}