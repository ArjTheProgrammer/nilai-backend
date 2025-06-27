const axios = require('./axios.js')
const baseUrl = '/emotions'

const getEmotion = async () => {
  const response = await axios.post(baseUrl, { text: 'I am happy today!' })
  return response.data
}

module.exports = { getEmotion }