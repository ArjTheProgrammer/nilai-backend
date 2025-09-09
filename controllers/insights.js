const express = require('express')
const { pool } = require('../utils/config')
const { verifyToken } = require('../utils/auth')
const { generateDailyQuote, generateDailySummaryForUser } = require('../utils/services/insights')

const insightsRouter = express.Router()

// Get daily quote
insightsRouter.get('/quote', verifyToken, async (request, response) => {
  try {
    const firebaseUid = request.user.uid

    const userResult = await pool.query('SELECT user_id FROM users WHERE firebase_uid = $1', [firebaseUid])
    if (userResult.rows.length === 0) {
      return response.status(404).json({ error: 'User not found' })
    }
    const userId = userResult.rows[0].user_id

    // Check if quote already exists for today - let PostgreSQL determine "today"
    const existingQuote = await pool.query(
      'SELECT title, quote, author, citation, explanation FROM daily_quotes WHERE user_id = $1 AND quote_date = CURRENT_DATE',
      [userId]
    )

    if (existingQuote.rows.length > 0) {
      return response.json(existingQuote.rows[0])
    }

    // Generate new quote
    const quote = await generateDailyQuote(userId)

    console.log('Generated quote:', quote) // Add this debug line

    if (!quote || !quote.quote) {
      return response.json({
        message: 'Start journaling to receive personalized daily quotes!'
      })
    }

    // Store the quote - let the DEFAULT CURRENT_DATE handle the date
    await pool.query(
      'INSERT INTO daily_quotes (user_id, title, quote, author, citation, explanation) VALUES ($1, $2, $3, $4, $5, $6)',
      [userId, quote.title, quote.quote, quote.author, quote.citation, quote.explanation]
    )

    const stored = await pool.query(
      'SELECT title, quote, author, citation, explanation, quote_date FROM daily_quotes WHERE user_id = $1 AND quote_date = CURRENT_DATE',
      [userId]
    )

    console.log('Stored quote:', stored.rows[0]) // Add this debug line

    response.json(stored.rows[0])
  } catch (error) {
    console.error('Error fetching daily quote:', error)
    response.status(500).json({ error: 'Failed to fetch daily quote' })
  }
})

// Get daily summary
insightsRouter.get('/summary', verifyToken, async (request, response) => {
  try {
    const firebaseUid = request.user.uid
    const today = new Date().toISOString().split('T')[0]

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

    // If no summary exists at all, try to generate one for today
    if (recentSummary.rows.length === 0) {
      // Check if user has journal entries to generate summary from
      const sevenDaysAgo = new Date()
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

      const entries = await pool.query(`
        SELECT title, content, emotions, created_at 
        FROM journal_entries 
        WHERE user_id = $1 
        AND created_at >= $2
        ORDER BY created_at DESC
      `, [userId, sevenDaysAgo])

      if (entries.rows.length === 0) {
        return response.json({
          message: 'No summaries available yet. Keep journaling and check back tomorrow!'
        })
      }

      // Generate summary for today
      await generateDailySummaryForUser(userId, today)

      // Fetch the newly generated summary
      const newSummary = await pool.query(`
        SELECT summary, key_themes, emotional_trends, entry_count, 
               analysis_period_start, analysis_period_end, summary_date
        FROM daily_summaries 
        WHERE user_id = $1 AND summary_date = $2
      `, [userId, today])

      if (newSummary.rows.length > 0) {
        const summary = newSummary.rows[0]
        return response.json({
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
      }
    }

    // Check if the most recent summary is from today
    const summary = recentSummary.rows[0]
    const summaryDate = new Date(summary.summary_date).toISOString().split('T')[0]

    // If the most recent summary is not from today, try to generate a new one
    if (summaryDate !== today) {
      // Check if user has journal entries from the past 7 days to generate summary from
      const sevenDaysAgo = new Date()
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

      const entries = await pool.query(`
        SELECT title, content, emotions, created_at 
        FROM journal_entries 
        WHERE user_id = $1 
        AND created_at >= $2
        ORDER BY created_at DESC
      `, [userId, sevenDaysAgo])

      if (entries.rows.length > 0) {
        // Generate summary for today
        await generateDailySummaryForUser(userId, today)

        // Fetch the newly generated summary
        const newSummary = await pool.query(`
          SELECT summary, key_themes, emotional_trends, entry_count, 
                 analysis_period_start, analysis_period_end, summary_date
          FROM daily_summaries 
          WHERE user_id = $1 AND summary_date = $2
        `, [userId, today])

        if (newSummary.rows.length > 0) {
          const todaySummary = newSummary.rows[0]
          return response.json({
            summary: todaySummary.summary,
            key_themes: todaySummary.key_themes,
            emotional_trends: todaySummary.emotional_trends,
            entry_count: todaySummary.entry_count,
            analysis_period: {
              start: todaySummary.analysis_period_start,
              end: todaySummary.analysis_period_end
            },
            generated_date: todaySummary.summary_date
          })
        }
      }
    }

    // Return the most recent summary (fallback)
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