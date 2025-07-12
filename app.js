const express = require('express')
const cors = require('cors')
const helmet = require('helmet')
const journalRouter = require('./controllers/journals')
const app = express()

app.use(cors())
app.use(helmet())
app.use(express.json())

app.use('/api/journals', journalRouter)

module.exports = app