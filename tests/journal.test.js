const { test, beforeEach, after } = require('node:test')
const supertest = require('supertest')
const app = require('../app')
const { pool } = require('../utils/config')
const admin = require('../firebaseAdmin')
const { getEmotion } = require('../utils/services/emotion')
const assert = require('assert')

const api = supertest(app)

// Store original method to restore later
const originalVerifyIdToken = admin.auth().verifyIdToken

const testUser = {
  firebaseUid: 'test-journal-uid-' + Date.now(),
  email: `journal-test-${Date.now()}@example.com`,
  firstName: 'Journal',
  lastName: 'Tester',
  username: `journaltester${Date.now()}`,
  authProvider: 'email'
}

let userId // Will store the database user ID

beforeEach(async () => {
  // Clean up any existing test data
  await pool.query('DELETE FROM journal_entries WHERE user_id = $1', [userId])

  // Create test user in Firebase if not exists
  try {
    await admin.auth().getUser(testUser.firebaseUid)
  } catch (error) {
    if (error.code === 'auth/user-not-found') {
      await admin.auth().createUser({
        uid: testUser.firebaseUid,
        email: testUser.email,
        emailVerified: true
      })
    }
  }

  // Mock token verification
  admin.auth().verifyIdToken = async (token) => {
    if (token === 'mock-journal-token') {
      return {
        uid: testUser.firebaseUid,
        email: testUser.email,
        email_verified: true
      }
    }
    return originalVerifyIdToken.call(admin.auth(), token)
  }

  // Create or get user in database
  const existingUser = await pool.query('SELECT * FROM users WHERE firebase_uid = $1', [testUser.firebaseUid])

  if (existingUser.rows.length === 0) {
    const result = await pool.query(
      `INSERT INTO users (firebase_uid, first_name, last_name, username, email, auth_provider, email_verified)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
      [testUser.firebaseUid, testUser.firstName, testUser.lastName, testUser.username, testUser.email, testUser.authProvider, true]
    )
    userId = result.rows[0].id
  } else {
    userId = existingUser.rows[0].id
  }
})

after(async () => {
  // Cleanup
  admin.auth().verifyIdToken = originalVerifyIdToken

  // Clean up database
  if (userId) {
    await pool.query('DELETE FROM journal_entries WHERE user_id = $1', [userId])
    await pool.query('DELETE FROM users WHERE firebase_uid = $1', [testUser.firebaseUid])
  }

  // Clean up Firebase
  try {
    await admin.auth().deleteUser(testUser.firebaseUid)
  } catch (error) {
    if (error.code !== 'auth/user-not-found') {
      console.error('Error deleting Firebase user:', error)
    }
  }
})

test.only('should create a journal entry', async () => {
  const sampleJournal = {
    user_id: userId,
    title: 'Sample Journal Title',
    content: 'I am feeling happy today and I want to thank the love of my life for always supporting me today in my finals basketball game where I won finals MVP.',
  }

  const response = await api
    .post('/api/journals')
    .set('Authorization', 'Bearer mock-journal-token')
    .send(sampleJournal)
    .expect(201)

  // Verify response
  console.log(response.body)

  console.assert(response.body.title === sampleJournal.title, 'Title should match')
  console.assert(response.body.content === sampleJournal.content, 'Content should match')
  console.assert(response.body.user_id === userId, 'User ID should match')
  console.assert(Array.isArray(response.body.emotions), 'Emotions should be an array')

  // Verify in database
  const dbEntry = await pool.query('SELECT * FROM journal_entries WHERE id = $1', [response.body.id])
  console.log(dbEntry.rows[0])
  console.assert(dbEntry.rows.length === 1, 'Journal entry should exist in database')
  console.assert(dbEntry.rows[0].title === sampleJournal.title, 'Title should match in DB')
})

test('should get all journal entries', async () => {
  // First create a test journal entry
  const testJournal = {
    user_id: userId,
    title: 'Test Journal for GET',
    content: 'Test content for GET request',
    emotions: [{ emotion: 'happiness', confidence: 0.85 }]
  }

  await api
    .post('/api/journals')
    .set('Authorization', 'Bearer mock-journal-token')
    .send(testJournal)
    .expect(201)

  // Now test GET request
  const response = await api
    .get('/api/journals')
    .set('Authorization', 'Bearer mock-journal-token')
    .expect(200)

  console.assert(Array.isArray(response.body), 'Response should be an array')
  console.assert(response.body.length >= 1, 'Should have at least one journal entry')

  // Find our test journal
  const foundJournal = response.body.find(journal => journal.title === testJournal.title)
  console.assert(foundJournal !== undefined, 'Should find our test journal')
  console.assert(foundJournal.content === testJournal.content, 'Content should match')
})

test('should reject journal creation without required fields', async () => {
  const incompleteJournal = {
    user_id: userId,
    title: 'Missing Content'
    // Missing content field
  }

  const response = await api
    .post('/api/journals')
    .set('Authorization', 'Bearer mock-journal-token')
    .send(incompleteJournal)
    .expect(400)

  console.assert(response.body.error.includes('Missing required fields'), 'Should reject incomplete data')
})

test('should reject requests without authentication', async () => {
  const sampleJournal = {
    user_id: userId,
    title: 'Unauthorized Test',
    content: 'This should fail without token'
  }

  await api
    .post('/api/journals')
    .send(sampleJournal)
    .expect(401)

  await api
    .get('/api/journals')
    .expect(401)
})

test('should handle invalid authentication token', async () => {
  const sampleJournal = {
    user_id: userId,
    title: 'Invalid Token Test',
    content: 'This should fail with invalid token'
  }

  // Temporarily restore original method for invalid token test
  admin.auth().verifyIdToken = originalVerifyIdToken

  await api
    .post('/api/journals')
    .set('Authorization', 'Bearer invalid-token')
    .send(sampleJournal)
    .expect(401)

  // Restore mock for other tests
  admin.auth().verifyIdToken = async (token) => {
    if (token === 'mock-journal-token') {
      return {
        uid: testUser.firebaseUid,
        email: testUser.email,
        email_verified: true
      }
    }
    return originalVerifyIdToken.call(admin.auth(), token)
  }
})

test('test if the returned emotion is a array', async () => {
  const emotions = await getEmotion('Hello I am happy to see you!')
  console.log(emotions)
  assert(Array.isArray(emotions), 'emotions should be an array')
})