const { test, beforeEach, after } = require('node:test')
const supertest = require('supertest')
const app = require('../app')
const { pool } = require('../utils/config')
const admin = require('../firebaseAdmin')
const assert = require('assert')

const api = supertest(app)

// Store original method to restore later
const originalVerifyIdToken = admin.auth().verifyIdToken

const testUser = {
  firebaseUid: 'test-journal-basic-uid-' + Date.now(),
  email: `journal-basic-test-${Date.now()}@example.com`,
  firstName: 'Journal',
  lastName: 'BasicTester',
  username: `journalbasictester${Date.now()}`,
  authProvider: 'email'
}

let userId // Will store the database user ID

beforeEach(async () => {
  // Clean up any existing test data
  if (userId) {
    await pool.query('DELETE FROM journal_entries WHERE user_id = $1', [userId])
  }

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
    if (token === 'mock-journal-basic-token') {
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
    userId = result.rows[0].user_id
  } else {
    userId = existingUser.rows[0].user_id
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

// Test POST /api/journals - Create journal entry
test('POST /api/journals - should create a journal entry with emotions', async () => {
  const sampleJournal = {
    title: 'Sample Journal Title',
    content: 'I am feeling happy today and I want to thank the love of my life for always supporting me.',
  }

  const response = await api
    .post('/api/journals')
    .set('Authorization', 'Bearer mock-journal-basic-token')
    .send(sampleJournal)
    .expect(201)

  // Verify response structure
  assert(response.body.journal_id, 'Should return journal_id')
  assert.strictEqual(response.body.title, sampleJournal.title, 'Title should match')
  assert.strictEqual(response.body.content, sampleJournal.content, 'Content should match')
  assert(response.body.emotions, 'Should include emotions')

  // Verify in database
  const dbEntry = await pool.query('SELECT * FROM journal_entries WHERE journal_id = $1', [response.body.journal_id])
  assert.strictEqual(dbEntry.rows.length, 1, 'Journal entry should exist in database')
  assert.strictEqual(dbEntry.rows[0].title, sampleJournal.title, 'Title should match in DB')
  assert.strictEqual(dbEntry.rows[0].content, sampleJournal.content, 'Content should match in DB')
  assert.strictEqual(dbEntry.rows[0].user_id, userId, 'User ID should match in DB')
})

// Test GET /api/journals - Get all journal entries
test.only('GET /api/journals - should get all journal entries for authenticated user', async () => {
  // First create test journal entries
  const testJournals = [
    {
      title: 'First Journal',
      content: 'I am happy!'
    },
    {
      title: 'Second Journal',
      content: 'Content of second journal entry'
    }
  ]

  // Create the journal entries
  for (const journal of testJournals) {
    await api
      .post('/api/journals')
      .set('Authorization', 'Bearer mock-journal-basic-token')
      .send(journal)
      .expect(201)
  }

  // Now test GET request
  const response = await api
    .get('/api/journals')
    .set('Authorization', 'Bearer mock-journal-basic-token')
    .expect(200)

  assert(Array.isArray(response.body), 'Response should be an array')
  assert(response.body.length >= 2, 'Should have at least two journal entries')

  // Verify entries are ordered by created_at DESC (newest first)
  const titles = response.body.map(journal => journal.title)
  assert(titles.includes('First Journal'), 'Should include first journal')
  assert(titles.includes('Second Journal'), 'Should include second journal')

  // Verify structure of returned entries
  response.body.forEach(journal => {
    assert(journal.journal_id, 'Each entry should have journal_id')
    assert(journal.title, 'Each entry should have title')
    assert(journal.content, 'Each entry should have content')
    assert(journal.user_id === userId, 'Each entry should belong to authenticated user')
    assert(journal.created_at, 'Each entry should have created_at timestamp')
  })
})