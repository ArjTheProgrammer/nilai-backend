const axios = require('./axios.js')
const baseUrl = '/emotions'

const getEmotion = async (content) => {
  const response = await axios.post(baseUrl, { text: content })
  return response.data
}

module.exports = { getEmotion }