const { test, beforeEach, after, describe } = require('node:test')
const supertest = require('supertest')
const app = require('../app')
const { pool } = require('../utils/config')
const admin = require('../firebaseAdmin')
const assert = require('assert')

const api = supertest(app)

// Store original method to restore later
const originalVerifyIdToken = admin.auth().verifyIdToken

const testUser = {
  firebaseUid: 'test-insights-uid-' + Date.now(),
  email: `insights-test-${Date.now()}@example.com`,
  firstName: 'Insights',
  lastName: 'Tester',
  username: `insightstester${Date.now()}`,
  authProvider: 'email'
}

let userId // Will store the database user ID

beforeEach(async () => {
  // Clean up any existing test data
  if (userId) {
    await pool.query('DELETE FROM daily_quotes WHERE user_id = $1', [userId])
    await pool.query('DELETE FROM daily_summaries WHERE user_id = $1', [userId])
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
    if (token === 'mock-insights-token') {
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
    await pool.query('DELETE FROM daily_quotes WHERE user_id = $1', [userId])
    await pool.query('DELETE FROM daily_summaries WHERE user_id = $1', [userId])
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

describe('Daily Quote Generation', () => {
  test('GET /api/insights/quote - should generate quote from journal entries and follow database schema', async () => {
    // First create some journal entries with GoEmotions format
    const testJournals = [
      {
        title: 'Grateful Day',
        content: 'Today I feel incredibly grateful for my family and friends. Their support means everything to me. I realized that happiness comes from appreciating what we have.',
        emotions: [
          { emotion: 'gratitude', confidence: 0.89 },
          { emotion: 'joy', confidence: 0.76 },
          { emotion: 'love', confidence: 0.82 }
        ]
      },
      {
        title: 'Overcoming Challenges',
        content: 'I faced a difficult situation at work today, but I managed to stay calm and find a solution. I am learning that resilience is built through facing our fears.',
        emotions: [
          { emotion: 'pride', confidence: 0.84 },
          { emotion: 'relief', confidence: 0.78 },
          { emotion: 'calmness', confidence: 0.72 }
        ]
      },
      {
        title: 'Peaceful Evening',
        content: 'Spent the evening reading and reflecting on my goals. There is something beautiful about quiet moments that help us reconnect with ourselves.',
        emotions: [
          { emotion: 'calmness', confidence: 0.87 },
          { emotion: 'contentment', confidence: 0.81 },
          { emotion: 'realization', confidence: 0.79 }
        ]
      }
    ]

    // Create the journal entries
    for (const journal of testJournals) {
      await api
        .post('/api/journals')
        .set('Authorization', 'Bearer mock-insights-token')
        .send(journal)
        .expect(201)
    }

    // Now test quote generation
    const response = await api
      .get('/api/insights/quote')
      .set('Authorization', 'Bearer mock-insights-token')
      .expect(200)

    // Verify the response structure matches the database schema
    assert(response.body.title, 'Should have title field')
    assert(response.body.quote, 'Should have quote field')
    assert(response.body.explanation, 'Should have explanation field')
    
    // Verify data types and constraints
    assert(typeof response.body.title === 'string', 'Title should be string')
    assert(response.body.title.length <= 255, 'Title should not exceed 255 characters')
    assert(typeof response.body.quote === 'string', 'Quote should be string')
    assert(typeof response.body.explanation === 'string', 'Explanation should be string')

    // Optional fields - can be null or string
    if (response.body.author !== undefined) {
      assert(typeof response.body.author === 'string', 'Author should be string if present')
      assert(response.body.author.length <= 255, 'Author should not exceed 255 characters')
    }
    if (response.body.citation !== undefined) {
      assert(typeof response.body.citation === 'string', 'Citation should be string if present')
      assert(response.body.citation.length <= 500, 'Citation should not exceed 500 characters')
    }

    // Verify quote was stored in database with correct schema
    const dbQuote = await pool.query(
      'SELECT quote_id, user_id, title, quote, author, citation, explanation, quote_date, created_at FROM daily_quotes WHERE user_id = $1',
      [userId]
    )

    assert.strictEqual(dbQuote.rows.length, 1, 'Quote should be stored in database')
    const storedQuote = dbQuote.rows[0]

    // Verify database schema compliance
    assert(storedQuote.quote_id, 'Should have UUID quote_id')
    assert.strictEqual(storedQuote.user_id, userId, 'Should have correct user_id')
    assert.strictEqual(storedQuote.title, response.body.title, 'Title should match response')
    assert.strictEqual(storedQuote.quote, response.body.quote, 'Quote should match response')
    assert.strictEqual(storedQuote.explanation, response.body.explanation, 'Explanation should match response')
    assert(storedQuote.quote_date, 'Should have quote_date')
    assert(storedQuote.created_at, 'Should have created_at timestamp')

    // Verify date is today
    const today = new Date().toISOString().split('T')[0]
    const storedDate = new Date(storedQuote.quote_date).toISOString().split('T')[0]
    assert.strictEqual(storedDate, today, 'Quote date should be today')

    console.log('Generated quote:', {
      title: response.body.title,
      quote: response.body.quote.substring(0, 100) + '...',
      author: response.body.author,
      explanation: response.body.explanation.substring(0, 100) + '...'
    })
  })

  test('GET /api/insights/quote - should return cached quote for same day', async () => {
    // Create journal entries
    const journal = {
      title: 'Daily Reflection',
      content: 'Today was a day of learning and growth. I discovered new things about myself and feel optimistic about the future.'
    }

    await api
      .post('/api/journals')
      .set('Authorization', 'Bearer mock-insights-token')
      .send(journal)
      .expect(201)

    // First request should generate new quote
    const firstResponse = await api
      .get('/api/insights/quote')
      .set('Authorization', 'Bearer mock-insights-token')
      .expect(200)

    assert(firstResponse.body.quote, 'First request should generate quote')

    // Second request should return the same cached quote
    const secondResponse = await api
      .get('/api/insights/quote')
      .set('Authorization', 'Bearer mock-insights-token')
      .expect(200)

    assert.strictEqual(secondResponse.body.title, firstResponse.body.title, 'Title should be same')
    assert.strictEqual(secondResponse.body.quote, firstResponse.body.quote, 'Quote should be same')
    assert.strictEqual(secondResponse.body.explanation, firstResponse.body.explanation, 'Explanation should be same')

    // Verify only one quote exists in database
    const dbQuotes = await pool.query(
      'SELECT COUNT(*) FROM daily_quotes WHERE user_id = $1',
      [userId]
    )
    assert.strictEqual(parseInt(dbQuotes.rows[0].count), 1, 'Should have only one quote in database')
  })

  test('GET /api/insights/quote - should handle unauthorized access', async () => {
    const response = await api
      .get('/api/insights/quote')
      .expect(401)

    assert.strictEqual(response.body.message, 'No token provided', 'Should reject unauthorized access')
  })
})

describe('Daily Summary Generation', () => {
  test('GET /api/insights/summary - should return message when no summaries exist', async () => {
    const response = await api
      .get('/api/insights/summary')
      .set('Authorization', 'Bearer mock-insights-token')
      .expect(200)

    assert.strictEqual(response.body.message, 'No summaries available yet. Keep journaling and check back tomorrow!', 'Should return message for no summaries')
  })

  test('GET /api/insights/summary - should return most recent summary with correct structure', async () => {
    // Manually insert a test summary to verify retrieval
    const today = new Date().toISOString().split('T')[0]
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

    await pool.query(`
      INSERT INTO daily_summaries 
      (user_id, summary, key_themes, emotional_trends, entry_count, analysis_period_start, analysis_period_end, summary_date)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [
      userId,
      'Test summary of recent journal entries showing growth and reflection.',
      JSON.stringify(['growth', 'reflection', 'gratitude']),
      JSON.stringify({ positive: 70, neutral: 20, negative: 10 }),
      5,
      sevenDaysAgo.toISOString().split('T')[0],
      today,
      today
    ])

    const response = await api
      .get('/api/insights/summary')
      .set('Authorization', 'Bearer mock-insights-token')
      .expect(200)

    // Verify response structure
    assert(response.body.summary, 'Should have summary')
    assert(Array.isArray(response.body.key_themes), 'Should have key_themes array')
    assert(typeof response.body.emotional_trends === 'object', 'Should have emotional_trends object')
    assert(typeof response.body.entry_count === 'number', 'Should have entry_count number')
    assert(response.body.analysis_period, 'Should have analysis_period')
    assert(response.body.analysis_period.start, 'Should have analysis period start')
    assert(response.body.analysis_period.end, 'Should have analysis period end')
    assert(response.body.generated_date, 'Should have generated_date')

    // Verify content
    assert.strictEqual(response.body.entry_count, 5, 'Entry count should match')
    assert(response.body.key_themes.includes('growth'), 'Should include growth theme')
    assert(response.body.emotional_trends.positive === 70, 'Should have correct emotional trend')
  })

  test('GET /api/insights/summary - should generate summary from journal entries with GoEmotions format', async () => {
    // Create journal entries that match GoEmotions dataset format
  const testJournals = [
    {
      title: 'Grateful Day',
      content: 'Today I feel incredibly grateful for my family and friends. Their support means everything to me. I realized that happiness comes from appreciating what we have.',
      emotions: [
        { emotion: 'gratitude', confidence: 0.89 },
        { emotion: 'joy', confidence: 0.76 },
        { emotion: 'love', confidence: 0.82 }
      ]
    },
    {
      title: 'Overcoming Challenges', 
      content: 'I faced a difficult situation at work today, but I managed to stay calm and find a solution. I am learning that resilience is built through facing our fears.',
      emotions: [
        { emotion: 'pride', confidence: 0.84 },
        { emotion: 'relief', confidence: 0.78 },
        { emotion: 'approval', confidence: 0.72 }
      ]
    },
    {
      title: 'Peaceful Evening',
      content: 'Spent the evening reading and reflecting on my goals. There is something beautiful about quiet moments that help us reconnect with ourselves.',
      emotions: [
        { emotion: 'neutral', confidence: 0.87 },
        { emotion: 'approval', confidence: 0.81 },
        { emotion: 'realization', confidence: 0.79 }
      ]
    }
  ]

    // Create the journal entries
    for (const journal of testJournals) {
      await api
        .post('/api/journals')
        .set('Authorization', 'Bearer mock-insights-token') 
        .send(journal)
        .expect(201)
    }

    // Now test the actual summary generation function
    const { generateDailySummaryForUser } = require('../utils/services/insights')
    const today = new Date().toISOString().split('T')[0]
    
    // Call the generation function directly
    await generateDailySummaryForUser(userId, today)

    // Verify summary was created in database
    const generatedSummary = await pool.query(
      'SELECT * FROM daily_summaries WHERE user_id = $1 AND summary_date = $2',
      [userId, today]
    )

    assert.strictEqual(generatedSummary.rows.length, 1, 'Summary should be generated')
    const summary = generatedSummary.rows[0]
    
    assert(summary.summary, 'Should have summary text')
    assert(summary.key_themes, 'Should have key themes')
    assert(summary.emotional_trends, 'Should have emotional trends')
    assert.strictEqual(summary.entry_count, 5, 'Should reflect correct entry count')
    assert(summary.analysis_period_start, 'Should have analysis period start')
    assert(summary.analysis_period_end, 'Should have analysis period end')

    // Parse JSON fields and verify structure
    const keyThemes = JSON.parse(summary.key_themes)
    const emotionalTrends = JSON.parse(summary.emotional_trends)
    
    assert(Array.isArray(keyThemes), 'Key themes should be array')
    assert(typeof emotionalTrends === 'object', 'Emotional trends should be object')
    
    console.log('Generated summary:', {
      summary: summary.summary.substring(0, 100) + '...',
      keyThemes,
      emotionalTrends,
      entryCount: summary.entry_count
    })
  })
})

