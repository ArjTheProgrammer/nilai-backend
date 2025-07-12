const express = require('express')
const router = express.Router()
const pool = require('../database')
const { verifyToken } = require('../middleware/auth')

// POST /api/auth/signup - Create new user with email
router.post('/signup', verifyToken, async (req, res) => {
  const { firstName, lastName, username, email, authProvider } = req.body
  const firebaseUid = req.user.uid

  try {
    // Check if user already exists
    const existingUser = await pool.query(
      'SELECT * FROM users WHERE firebase_uid = $1 OR email = $2 OR username = $3',
      [firebaseUid, email, username]
    )

    if (existingUser.rows.length > 0) {
      return res.status(400).json({ message: 'User already exists' })
    }

    // Create new user
    const result = await pool.query(
      `INSERT INTO users (firebase_uid, first_name, last_name, username, email, auth_provider, email_verified)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [firebaseUid, firstName, lastName, username, email, authProvider, req.user.email_verified]
    )

    const user = result.rows[0]

    // Remove sensitive data before sending response
    const { ...userData } = user

    res.status(201).json({
      message: 'User created successfully',
      user: userData
    })

  } catch (error) {
    console.error('Signup error:', error)

    if (error.code === '23505') { // Unique constraint violation
      res.status(400).json({ message: 'Username or email already exists' })
    } else {
      res.status(500).json({ message: 'Internal server error' })
    }
  }
})

// POST /api/auth/google - Handle Google OAuth
router.post('/google', verifyToken, async (req, res) => {
  const { email, firstName, lastName, googleId, googleAvatarUrl, authProvider } = req.body
  const firebaseUid = req.user.uid

  try {
    // Check if user exists
    let user = await pool.query(
      'SELECT * FROM users WHERE firebase_uid = $1 OR email = $2',
      [firebaseUid, email]
    )

    if (user.rows.length > 0) {
      // User exists, update login timestamp
      await pool.query(
        'UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE firebase_uid = $1',
        [firebaseUid]
      )

      const { ...userData } = user.rows[0]

      res.json({
        message: 'Login successful',
        user: userData
      })
    } else {
      // Create new user with Google data
      // Generate username from email
      const username = email.split('@')[0] + Math.random().toString(36).substring(2, 6)

      const result = await pool.query(
        `INSERT INTO users (firebase_uid, first_name, last_name, username, email, auth_provider, google_id, google_avatar_url, email_verified, profile_picture_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [firebaseUid, firstName, lastName, username, email, authProvider, googleId, googleAvatarUrl, true, googleAvatarUrl]
      )

      const newUser = result.rows[0]
      const { ...userData } = newUser

      res.status(201).json({
        message: 'User created successfully',
        user: userData
      })
    }

  } catch (error) {
    console.error('Google auth error:', error)
    res.status(500).json({ message: 'Internal server error' })
  }
})

// GET /api/auth/verify - Verify token and get user data
router.get('/verify', verifyToken, async (req, res) => {
  try {
    const firebaseUid = req.user.uid

    const result = await pool.query(
      'SELECT * FROM users WHERE firebase_uid = $1',
      [firebaseUid]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' })
    }

    // Update last login
    await pool.query(
      'UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE firebase_uid = $1',
      [firebaseUid]
    )

    const { ...userData } = result.rows[0]

    res.json({
      message: 'Token verified',
      user: userData
    })

  } catch (error) {
    console.error('Verify error:', error)
    res.status(500).json({ message: 'Internal server error' })
  }
})

module.exports = router