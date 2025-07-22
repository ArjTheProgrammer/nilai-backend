const { test, after, describe } = require('node:test')
const supertest = require('supertest')
const app = require('../app')
const { pool } = require('../utils/config')
const admin = require('../firebaseAdmin')
const { cleanupAllTestUsers } = require('./cleanup')

const api = supertest(app)

// Store original method to restore later
const originalVerifyIdToken = admin.auth().verifyIdToken

describe('Authentication Tests', () => {
  const testUsers = []

  // Clean up after all tests
  after(async () => {
    console.log('Cleaning up authentication tests...')

    // Restore original method
    admin.auth().verifyIdToken = originalVerifyIdToken

    // Use shared cleanup utility
    await cleanupAllTestUsers()

    console.log('Authentication test cleanup completed')
  })

  describe('Email/Password Authentication', () => {
    test('POST /api/auth/signup - should create new user with email/password', async () => {
      const testUser = {
        firebaseUid: 'test-email-uid-' + Date.now(),
        email: `test-${Date.now()}@example.com`,
        firstName: 'John',
        lastName: 'Doe',
        username: `testuser${Date.now()}`,
        authProvider: 'email'
      }

      testUsers.push(testUser)

      // First create the user in Firebase
      await admin.auth().createUser({
        uid: testUser.firebaseUid,
        email: testUser.email,
        emailVerified: true
      })

      // Mock token verification for this specific test
      admin.auth().verifyIdToken = async (token) => {
        if (token === 'mock-token') {
          return {
            uid: testUser.firebaseUid,
            email: testUser.email,
            email_verified: true
          }
        }
        return originalVerifyIdToken.call(admin.auth(), token)
      }

      const response = await api
        .post('/api/auth/signup')
        .set('Authorization', 'Bearer mock-token')
        .send({
          firstName: testUser.firstName,
          lastName: testUser.lastName,
          username: testUser.username,
          email: testUser.email,
          authProvider: testUser.authProvider
        })
        .expect(201)

      // Verify response
      const { user } = response.body
      console.assert(user.first_name === testUser.firstName, 'First name should match')
      console.assert(user.last_name === testUser.lastName, 'Last name should match')
      console.assert(user.username === testUser.username, 'Username should match')
      console.assert(user.email === testUser.email, 'Email should match')
      console.assert(user.auth_provider === testUser.authProvider, 'Auth provider should match')
      console.assert(!user.firebase_uid, 'Firebase UID should not be exposed')

      // Verify user exists in database
      const dbUser = await pool.query('SELECT * FROM users WHERE firebase_uid = $1', [testUser.firebaseUid])
      console.assert(dbUser.rows.length === 1, 'User should exist in database')
      console.assert(dbUser.rows[0].firebase_uid === testUser.firebaseUid, 'Firebase UID should match in DB')
    })

    test('POST /api/auth/signup - should reject duplicate email', async () => {
      const baseEmail = `duplicate-${Date.now()}@example.com`

      const testUser = {
        firebaseUid: 'test-duplicate-uid-' + Date.now(),
        email: baseEmail,
        firstName: 'Jane',
        lastName: 'Doe',
        username: `duplicateuser${Date.now()}`,
        authProvider: 'email'
      }

      testUsers.push(testUser)

      // Create first Firebase user
      await admin.auth().createUser({
        uid: testUser.firebaseUid,
        email: testUser.email,
        emailVerified: true
      })

      // Mock token verification for first user
      admin.auth().verifyIdToken = async (token) => {
        if (token === 'mock-token-duplicate') {
          return {
            uid: testUser.firebaseUid,
            email: testUser.email,
            email_verified: true
          }
        }
        return originalVerifyIdToken.call(admin.auth(), token)
      }

      // First signup should succeed
      await api
        .post('/api/auth/signup')
        .set('Authorization', 'Bearer mock-token-duplicate')
        .send({
          firstName: testUser.firstName,
          lastName: testUser.lastName,
          username: testUser.username,
          email: testUser.email,
          authProvider: testUser.authProvider
        })
        .expect(201)

      // Try to signup again with the same email but different Firebase user
      // This should fail at the database level since email is unique
      const secondUser = {
        firebaseUid: 'test-duplicate-uid-2-' + Date.now(),
        email: baseEmail, // Same email - this will test database constraint
        username: `duplicateuser2${Date.now()}`
      }

      testUsers.push(secondUser)

      // Create second Firebase user with different email to avoid Firebase conflict
      await admin.auth().createUser({
        uid: secondUser.firebaseUid,
        email: `different-${Date.now()}@example.com`, // Different email for Firebase
        emailVerified: true
      })

      // Update mock to handle second user
      admin.auth().verifyIdToken = async (token) => {
        if (token === 'mock-token-duplicate') {
          return {
            uid: testUser.firebaseUid,
            email: testUser.email,
            email_verified: true
          }
        }
        if (token === 'mock-token-duplicate-2') {
          return {
            uid: secondUser.firebaseUid,
            email: baseEmail, // Return the duplicate email in token
            email_verified: true
          }
        }
        return originalVerifyIdToken.call(admin.auth(), token)
      }

      const response = await api
        .post('/api/auth/signup')
        .set('Authorization', 'Bearer mock-token-duplicate-2')
        .send({
          firstName: 'Another',
          lastName: 'User',
          username: secondUser.username,
          email: baseEmail, // Same email should be rejected
          authProvider: 'email'
        })
        .expect(400)

      console.assert(response.body.message.includes('already exists'), 'Should reject duplicate email')
    })
  })

  describe('Google OAuth Authentication', () => {
    test('POST /api/auth/google - should create new user with Google OAuth', async () => {
      const testUser = {
        firebaseUid: 'test-google-uid-' + Date.now(),
        email: `google-${Date.now()}@gmail.com`,
        firstName: 'Google',
        lastName: 'User',
        googleId: 'google-id-' + Date.now(),
        googleAvatarUrl: 'https://example.com/avatar.jpg',
        authProvider: 'google'
      }

      testUsers.push(testUser)

      // Create Firebase user
      await admin.auth().createUser({
        uid: testUser.firebaseUid,
        email: testUser.email,
        emailVerified: true,
        displayName: `${testUser.firstName} ${testUser.lastName}`,
        photoURL: testUser.googleAvatarUrl
      })

      // Mock token verification
      admin.auth().verifyIdToken = async (token) => {
        if (token === 'mock-google-token') {
          return {
            uid: testUser.firebaseUid,
            email: testUser.email,
            email_verified: true
          }
        }
        return originalVerifyIdToken.call(admin.auth(), token)
      }

      const response = await api
        .post('/api/auth/google')
        .set('Authorization', 'Bearer mock-google-token')
        .send({
          email: testUser.email,
          firstName: testUser.firstName,
          lastName: testUser.lastName,
          googleId: testUser.googleId,
          googleAvatarUrl: testUser.googleAvatarUrl,
          authProvider: testUser.authProvider
        })
        .expect(201)

      // Verify response
      const { user } = response.body
      console.assert(user.first_name === testUser.firstName, 'First name should match')
      console.assert(user.last_name === testUser.lastName, 'Last name should match')
      console.assert(user.email === testUser.email, 'Email should match')
      console.assert(user.auth_provider === testUser.authProvider, 'Auth provider should match')
      console.assert(user.google_id === testUser.googleId, 'Google ID should match')
      console.assert(user.google_avatar_url === testUser.googleAvatarUrl, 'Google avatar URL should match')
      console.assert(!user.firebase_uid, 'Firebase UID should not be exposed')

      // Verify user exists in database
      const dbUser = await pool.query('SELECT * FROM users WHERE firebase_uid = $1', [testUser.firebaseUid])
      console.assert(dbUser.rows.length === 1, 'User should exist in database')
      console.assert(dbUser.rows[0].google_id === testUser.googleId, 'Google ID should match in DB')
    })

    test('POST /api/auth/google - should login existing Google user', async () => {
      const testUser = {
        firebaseUid: 'test-existing-google-uid-' + Date.now(),
        email: `existing-google-${Date.now()}@gmail.com`,
        firstName: 'Existing',
        lastName: 'GoogleUser',
        googleId: 'existing-google-id-' + Date.now(),
        googleAvatarUrl: 'https://example.com/existing-avatar.jpg',
        authProvider: 'google'
      }

      testUsers.push(testUser)

      // Create Firebase user
      await admin.auth().createUser({
        uid: testUser.firebaseUid,
        email: testUser.email,
        emailVerified: true
      })

      // Mock token verification
      admin.auth().verifyIdToken = async (token) => {
        if (token === 'mock-existing-google-token') {
          return {
            uid: testUser.firebaseUid,
            email: testUser.email,
            email_verified: true
          }
        }
        return originalVerifyIdToken.call(admin.auth(), token)
      }

      // First request should create the user
      const createResponse = await api
        .post('/api/auth/google')
        .set('Authorization', 'Bearer mock-existing-google-token')
        .send({
          email: testUser.email,
          firstName: testUser.firstName,
          lastName: testUser.lastName,
          googleId: testUser.googleId,
          googleAvatarUrl: testUser.googleAvatarUrl,
          authProvider: testUser.authProvider
        })
        .expect(201)

      console.assert(createResponse.body.message === 'User created successfully', 'Should create user first time')

      // Second request should login the existing user
      const loginResponse = await api
        .post('/api/auth/google')
        .set('Authorization', 'Bearer mock-existing-google-token')
        .send({
          email: testUser.email,
          firstName: testUser.firstName,
          lastName: testUser.lastName,
          googleId: testUser.googleId,
          googleAvatarUrl: testUser.googleAvatarUrl,
          authProvider: testUser.authProvider
        })
        .expect(200)

      console.assert(loginResponse.body.message === 'Login successful', 'Should login existing user')
      console.assert(loginResponse.body.user.email === testUser.email, 'Should return correct user data')
    })
  })

  describe('Token Verification', () => {
    test('GET /api/auth/verify - should verify valid token and return user data', async () => {
      const testUser = {
        firebaseUid: 'test-verify-uid-' + Date.now(),
        email: `verify-${Date.now()}@example.com`,
        firstName: 'Verify',
        lastName: 'User',
        username: `verifyuser${Date.now()}`,
        authProvider: 'email'
      }

      testUsers.push(testUser)

      // Create Firebase user
      await admin.auth().createUser({
        uid: testUser.firebaseUid,
        email: testUser.email,
        emailVerified: true
      })

      // Mock token verification
      admin.auth().verifyIdToken = async (token) => {
        if (token === 'mock-verify-token') {
          return {
            uid: testUser.firebaseUid,
            email: testUser.email,
            email_verified: true
          }
        }
        return originalVerifyIdToken.call(admin.auth(), token)
      }

      // First create the user
      await api
        .post('/api/auth/signup')
        .set('Authorization', 'Bearer mock-verify-token')
        .send({
          firstName: testUser.firstName,
          lastName: testUser.lastName,
          username: testUser.username,
          email: testUser.email,
          authProvider: testUser.authProvider
        })
        .expect(201)

      // Then verify the token
      const response = await api
        .get('/api/auth/verify')
        .set('Authorization', 'Bearer mock-verify-token')
        .expect(200)

      console.assert(response.body.message === 'Token verified', 'Should verify token')
      console.assert(response.body.user.email === testUser.email, 'Should return correct user data')
      console.assert(!response.body.user.firebase_uid, 'Should not expose Firebase UID')
    })

    test('GET /api/auth/verify - should reject invalid token', async () => {
      // Temporarily restore original method for invalid token test
      admin.auth().verifyIdToken = originalVerifyIdToken

      const response = await api
        .get('/api/auth/verify')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401)

      console.assert(response.body.message === 'Invalid token', 'Should reject invalid token')
    })

    test('GET /api/auth/verify - should reject missing token', async () => {
      const response = await api
        .get('/api/auth/verify')
        .expect(401)

      console.assert(response.body.message === 'No token provided', 'Should reject missing token')
    })
  })

  describe('Error Handling', () => {
    test('should handle database errors gracefully', async () => {
      const testUser = {
        firebaseUid: 'test-error-uid-' + Date.now(),
        email: `error-${Date.now()}@example.com`
      }

      testUsers.push(testUser)

      // Create Firebase user
      await admin.auth().createUser({
        uid: testUser.firebaseUid,
        email: testUser.email,
        emailVerified: true
      })

      // Mock token verification
      admin.auth().verifyIdToken = async (token) => {
        if (token === 'mock-error-token') {
          return {
            uid: testUser.firebaseUid,
            email: testUser.email,
            email_verified: true
          }
        }
        return originalVerifyIdToken.call(admin.auth(), token)
      }

      // Try to create user with missing required fields
      const response = await api
        .post('/api/auth/signup')
        .set('Authorization', 'Bearer mock-error-token')
        .send({
          email: testUser.email,
          authProvider: 'email'
          // Missing firstName, lastName, username
        })
        .expect(500)

      console.assert(response.body.message === 'Internal server error', 'Should handle errors gracefully')
    })
  })
})