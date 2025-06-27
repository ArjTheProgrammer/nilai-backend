const axios = require('./axios.js')
const baseUrl = '/emotions'

const getEmotion = async () => {
  const response = await axios.get(baseUrl)
  return response.data
}

module.exports = { getEmotion }