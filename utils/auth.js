const admin = require('../firebaseAdmin')

const verifyToken = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1]

    if (!token) {
      return res.status(401).json({ message: 'No token provided' })
    }

    const decodedToken = await admin.auth().verifyIdToken(token)
    req.user = decodedToken
    next()
  } catch (error) {
    console.error('Token verification failed:', error)
    res.status(401).json({ message: 'Invalid token' })
  }
}

module.exports = { verifyToken }