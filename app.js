const express = require('express')
const cors = require('cors')
const helmet = require('helmet')
const journalRouter = require('./controllers/journals')
const authRouter = require('./controllers/auth')
const app = express()
const { pool } = require('./utils/config')

app.use(cors())
app.use(helmet())
app.use(express.json())


console.log('Postgress has been intialize.')

app.use('/api/journals', journalRouter)
app.use('/api/auth', authRouter)

const gracefulShutdown = async (signal) => {
  console.log(`\nReceived ${signal}. Shutting down server gracefully...`)

  try {
    await pool.end()
    console.log('PostgreSQL pool has ended.')

    process.exit(0)
  } catch (error) {
    console.error('Error during shutdown:', error)
    process.exit(1)
  }
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'))
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason)
  gracefulShutdown('unhandledRejection')
})

module.exports = app