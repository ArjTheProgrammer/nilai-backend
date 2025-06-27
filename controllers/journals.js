const { getEmotion } = require('../utils/services/emotion')
const journalRouter = require('express').Router()

journalRouter.get('/', async(request, response) => {
  const emotion = await getEmotion()
  response.send(emotion)
})

module.exports = journalRouter