const axios = require('axios')

const apiClient = axios.create({
  baseURL: 'http://localhost:8000',
})

module.exports = apiClient