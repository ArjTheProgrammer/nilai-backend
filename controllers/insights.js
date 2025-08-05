const express = require('express')
const { pool } = require('../utils/config')
const { verifyToken } = require('../utils/auth')
const { generateDailyQuote } = require('../utils/services/insights')

const insightsRouter = express.Router()

// Get daily quote
insightsRouter.get('/quote', verifyToken, async (request, response) => {
  try {
    const firebaseUid = request.user.uid
    const today = new Date().toISOString().split('T')[0]
    
    const userResult = await pool.query('SELECT user_id FROM users WHERE firebase_uid = $1', [firebaseUid])
    if (userResult.rows.length === 0) {
      return response.status(404).json({ error: 'User not found' })
    }
    const userId = userResult.rows[0].user_id

    // Check if quote already exists for today
    const existingQuote = await pool.query(
      'SELECT title, quote, author, citation, explanation FROM daily_quotes WHERE user_id = $1 AND quote_date = $2',
      [userId, today]
    )

    if (existingQuote.rows.length > 0) {
      return response.json(existingQuote.rows[0])
    }

    // Generate new quote
    const quote = await generateDailyQuote(userId)
    
    if (!quote || !quote.quote) {
      return response.json({ 
        message: 'Start journaling to receive personalized daily quotes!' 
      })
    }

    // Store the quote
    await pool.query(
      'INSERT INTO daily_quotes (user_id, title, quote, author, citation, explanation, quote_date) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [userId, quote.title, quote.quote, quote.author, quote.citation, quote.explanation, today]
    )

    response.json(quote)
  } catch (error) {
    console.error('Error fetching daily quote:', error)
    response.status(500).json({ error: 'Failed to fetch daily quote' })
  }
})

// Get daily summary
insightsRouter.get('/summary', verifyToken, async (request, response) => {
  try {
    const firebaseUid = request.user.uid
    
    const userResult = await pool.query('SELECT user_id FROM users WHERE firebase_uid = $1', [firebaseUid])
    if (userResult.rows.length === 0) {
      return response.status(404).json({ error: 'User not found' })
    }
    const userId = userResult.rows[0].user_id

    // Get the most recent summary
    const recentSummary = await pool.query(`
      SELECT summary, key_themes, emotional_trends, entry_count, 
             analysis_period_start, analysis_period_end, summary_date
      FROM daily_summaries 
      WHERE user_id = $1 
      ORDER BY summary_date DESC 
      LIMIT 1
    `, [userId])

    if (recentSummary.rows.length === 0) {
      return response.json({ 
        message: 'No summaries available yet. Keep journaling and check back tomorrow!' 
      })
    }

    const summary = recentSummary.rows[0]
    response.json({
      summary: summary.summary,
      key_themes: summary.key_themes,
      emotional_trends: summary.emotional_trends,
      entry_count: summary.entry_count,
      analysis_period: {
        start: summary.analysis_period_start,
        end: summary.analysis_period_end
      },
      generated_date: summary.summary_date
    })
  } catch (error) {
    console.error('Error fetching daily summary:', error)
    response.status(500).json({ error: 'Failed to fetch daily summary' })
  }
})

module.exports = insightsRouter