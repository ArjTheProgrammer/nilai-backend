
const journalRouter = require('express').Router()

journalRouter.get('/', async(request, response) => {
  response.send('sample response')
})

module.exports = journalRouter