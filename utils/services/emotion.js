const axios = require('./axios.js')
const baseUrl = '/emotions'

const getEmotion = async () => {
  const response = await axios.post(baseUrl, { text: 'ang tanong' })
  return response.data
}

module.exports = { getEmotion }