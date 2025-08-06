const cron = require('node-cron')
const { pool } = require('../config')
const axios = require('./axios.js')

// Run every day at 12:00 AM
cron.schedule('0 0 * * *', async () => {
  console.log('Running daily summary generation at 12:00 AM')
  await generateDailySummariesForAllUsers()
})

async function generateDailySummariesForAllUsers() {
  try {
    // Get all users who had journal entries yesterday
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const yesterdayStr = yesterday.toISOString().split('T')[0]
    
    const today = new Date().toISOString().split('T')[0]

    // Find users with journal entries from yesterday
    const usersWithYesterdayEntries = await pool.query(`
      SELECT DISTINCT user_id 
      FROM journal_entries 
      WHERE DATE(created_at) = $1
    `, [yesterdayStr])

    console.log(`Found ${usersWithYesterdayEntries.rows.length} users with journal entries from yesterday`)

    // Generate summary for each user
    for (const user of usersWithYesterdayEntries.rows) {
      try {
        await generateDailySummaryForUser(user.user_id, today)
      } catch (error) {
        console.error(`Failed to generate summary for user ${user.user_id}:`, error)
      }
    }

    console.log('Daily summary generation completed')
  } catch (error) {
    console.error('Error in daily summary generation:', error)
  }
}

async function generateDailySummaryForUser(userId, summaryDate) {
  // Check if summary already exists for today
  const existingSummary = await pool.query(
    'SELECT summary_id FROM daily_summaries WHERE user_id = $1 AND summary_date = $2',
    [userId, summaryDate]
  )

  if (existingSummary.rows.length > 0) {
    console.log(`Summary already exists for user ${userId} on ${summaryDate}`)
    return
  }

  // Get past 7 days of entries
  const sevenDaysAgo = new Date()
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)

  const entries = await pool.query(`
    SELECT title, content, emotions, created_at 
    FROM journal_entries 
    WHERE user_id = $1 
    AND created_at >= $2 
    AND created_at < $3
    ORDER BY created_at DESC
  `, [userId, sevenDaysAgo, new Date()])

  if (entries.rows.length === 0) {
    console.log(`No entries found for user ${userId} in the past 7 days`)
    return
  }

  // Generate summary via NLP service
  try {
    const response = await axios.post('/insights/daily-summary', {
      entries: entries.rows,
      userId: userId 
    })

    const summaryData = response.data

    // Store the summary
    await pool.query(`
      INSERT INTO daily_summaries 
      (user_id, summary, key_themes, emotional_trends, entry_count, analysis_period_start, analysis_period_end, summary_date)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [
      userId,
      summaryData.summary,
      JSON.stringify(summaryData.key_themes),
      JSON.stringify(summaryData.emotional_trends),
      entries.rows.length,
      sevenDaysAgo.toISOString().split('T')[0],
      yesterday.toISOString().split('T')[0],
      summaryDate
    ])

    console.log(`Generated daily summary for user ${userId}`)
  } catch (error) {
    console.error(`Error generating summary for user ${userId}:`, error)
  }
}

async function generateDailyQuote(userId) {
  try {
    // Get last 7 days of entries
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    
    const entries = await pool.query(
      'SELECT title, content, emotions, created_at FROM journal_entries WHERE user_id = $1 AND created_at >= $2 ORDER BY created_at DESC',
      [userId, sevenDaysAgo]
    )

    if (entries.rows.length === 0) {
      return null
    }

    // Call NLP service using axios
    const response = await axios.post('/insights/quote', {
      entries: entries.rows
    })

    return response.data
  } catch (error) {
    console.error('Error generating daily quote:', error)
    return null
  }
}

module.exports = { generateDailySummariesForAllUsers, generateDailySummaryForUser, generateDailyQuote }