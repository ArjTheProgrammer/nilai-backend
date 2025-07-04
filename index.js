const app = require('./app')
const { pool } = require('./utils/config')
const config = require('./utils/config')

app.listen(config.PORT, () => {
  console.log(`server running on port ${config.PORT}`)

  console.log('Connecting to PostgreSQL database...')
  pool.connect()
    .then(client => {
      console.log('Connected to PostgreSQL database.')
      client.release()
    })
    .catch(err => {
      console.error('Failed to connect to PostgreSQL database:', err)
    })
})

process.on('SIGINT', async () => {
  console.log('\nShutting down server...')
  await pool.end()
  console.log('PostgreSQL pool has ended.')
  process.exit(0)
})