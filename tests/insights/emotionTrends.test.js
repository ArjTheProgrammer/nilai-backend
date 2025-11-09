const { test, beforeEach, after, describe } = require("node:test");
const supertest = require("supertest");
const app = require("../../app");
const { pool } = require("../../utils/config");
const admin = require("../../firebaseAdmin");
const assert = require("assert");

const api = supertest(app);

// Store original method to restore later
const originalVerifyIdToken = admin.auth().verifyIdToken;

const testUser = {
  firebaseUid: "test-insights-uid-" + Date.now(),
  email: `insights-test-${Date.now()}@example.com`,
  name: "Insights Tester",
  username: `insightstester${Date.now()}`,
  authProvider: "email",
};

let userId;

beforeEach(async () => {
  // Clean up any existing test data
  if (userId) {
    await pool.query("DELETE FROM daily_quotes WHERE user_id = $1", [userId]);
    await pool.query("DELETE FROM daily_summaries WHERE user_id = $1", [
      userId,
    ]);
    await pool.query("DELETE FROM journal_entries WHERE user_id = $1", [
      userId,
    ]);
  }

  // Create test user in Firebase if not exists
  try {
    await admin.auth().getUser(testUser.firebaseUid);
  } catch (error) {
    if (error.code === "auth/user-not-found") {
      await admin.auth().createUser({
        uid: testUser.firebaseUid,
        email: testUser.email,
        emailVerified: true,
      });
    }
  }

  // Mock token verification
  admin.auth().verifyIdToken = async (token) => {
    if (token === "mock-insights-token") {
      return {
        uid: testUser.firebaseUid,
        email: testUser.email,
        email_verified: true,
      };
    }
    return originalVerifyIdToken.call(admin.auth(), token);
  };

  // Create or get user in database
  const existingUser = await pool.query(
    "SELECT * FROM users WHERE firebase_uid = $1",
    [testUser.firebaseUid]
  );

  if (existingUser.rows.length === 0) {
    const result = await pool.query(
      `INSERT INTO users (firebase_uid, name, username, email, auth_provider, email_verified)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
      [
        testUser.firebaseUid,
        testUser.name,
        testUser.username,
        testUser.email,
        testUser.authProvider,
        true,
      ]
    );
    userId = result.rows[0].user_id;
  } else {
    userId = existingUser.rows[0].user_id;
  }
});

after(async () => {
  // Cleanup
  admin.auth().verifyIdToken = originalVerifyIdToken;

  // Clean up database
  if (userId) {
    await pool.query("DELETE FROM daily_quotes WHERE user_id = $1", [userId]);
    await pool.query("DELETE FROM daily_summaries WHERE user_id = $1", [
      userId,
    ]);
    await pool.query("DELETE FROM journal_entries WHERE user_id = $1", [
      userId,
    ]);
    await pool.query("DELETE FROM users WHERE firebase_uid = $1", [
      testUser.firebaseUid,
    ]);
  }

  // Clean up Firebase
  try {
    await admin.auth().deleteUser(testUser.firebaseUid);
  } catch (error) {
    if (error.code !== "auth/user-not-found") {
      console.error("Error deleting Firebase user:", error);
    }
  }
});

describe("Emotion Trends Analysis", () => {
  test("GET /api/insights/emotionTrends - should return emotion trends over 30-day periods", async () => {
    // Create test entries for specific days
    const testEntries = [
      {
        // Day 1 entries
        emotions: [
          { emotion: "joy", confidence: 0.9 },
          { emotion: "gratitude", confidence: 0.8 },
        ],
        created_at: `CURRENT_DATE`,
      },
      {
        // Day 3 entries (should count in day 5 bucket)
        emotions: [
          { emotion: "sadness", confidence: 0.85 },
          { emotion: "disappointment", confidence: 0.75 },
        ],
        created_at: `CURRENT_DATE - INTERVAL '3 days'`,
      },
      {
        // Day 7 entries (should count in day 10 bucket)
        emotions: [
          { emotion: "love", confidence: 0.95 },
          { emotion: "excitement", confidence: 0.85 },
        ],
        created_at: `CURRENT_DATE - INTERVAL '7 days'`,
      },
      {
        // Day 12 entries (should count in day 15 bucket)
        emotions: [
          { emotion: "anger", confidence: 0.8 },
          { emotion: "fear", confidence: 0.7 },
        ],
        created_at: `CURRENT_DATE - INTERVAL '12 days'`,
      },
    ];

    // Insert entries into database
    for (const entry of testEntries) {
      const sent = await pool.query(
        `INSERT INTO journal_entries 
         (user_id, title, content, emotions, created_at)
         VALUES ($1, $2, $3, $4::jsonb, ${entry.created_at})`,
        [userId, "Test Entry", "Test content", JSON.stringify(entry.emotions)]
      );
    }

    const journals = await api
      .get("/api/journals")
      .set("Authorization", "Bearer mock-insights-token")
      .expect(200);

    console.log("=== Journals ===");
    console.log(JSON.stringify(journals.body, null, 2));

    const response = await api
      .get("/api/insights/emotionTrends")
      .set("Authorization", "Bearer mock-insights-token")
      .expect(200);

    // Add detailed logging
    console.log("\n=== Response Body ===");
    console.log(JSON.stringify(response.body, null, 2));

    // Basic structure assertions
    assert(
      response.body.emotionTrends,
      "Response should have emotionTrends field"
    );
    assert(
      Array.isArray(response.body.emotionTrends),
      "emotionTrends should be an array"
    );

    // Convert the response data for easier testing
    const trendsMap = new Map(
      response.body.emotionTrends.map((trend) => [
        trend.day,
        {
          positive: Number(trend.positive),
          negative: Number(trend.negative),
          ambiguous: Number(trend.ambiguous),
        },
      ])
    );

    // Add trendsMap logging
    console.log("\n=== Trends Map ===");
    console.log("Map entries:");
    trendsMap.forEach((value, key) => {
      console.log(`Day ${key}:`, value);
    });

    // Test each day's bucket
    const day1 = trendsMap.get("1");
    assert.strictEqual(
      day1.positive,
      2,
      "Day 1 should have 2 positive emotions (joy, gratitude)"
    );

    const day5 = trendsMap.get("5");
    assert.strictEqual(
      day5.negative,
      2,
      "Day 5 should have 2 negative emotions (sadness, disappointment)"
    );

    const day10 = trendsMap.get("10");
    assert.strictEqual(
      day10.positive,
      2,
      "Day 10 should have 2 positive emotions (love, excitement)"
    );

    const day15 = trendsMap.get("15");
    assert.strictEqual(
      day15.negative,
      2,
      "Day 15 should have 2 negative emotions (anger, fear)"
    );

    // Verify all days are present
    const expectedDays = ["1", "5", "10", "15", "20", "25", "30"];
    expectedDays.forEach((day) => {
      assert(trendsMap.has(day), `Should have data for day ${day}`);
    });
  });

  test("GET /api/insights/emotionTrends - should handle no entries case", async () => {
    const response = await api
      .get("/api/insights/emotionTrends")
      .set("Authorization", "Bearer mock-insights-token")
      .expect(200);

    assert(
      Array.isArray(response.body.emotionTrends),
      "Should return array even with no entries"
    );
    assert(
      response.body.emotionTrends.length > 0,
      "Should return all date intervals"
    );

    // Verify all counts are zero
    response.body.emotionTrends.forEach((trend) => {
      assert.strictEqual(
        Number(trend.positive),
        0,
        "Positive count should be 0"
      );
      assert.strictEqual(
        Number(trend.negative),
        0,
        "Negative count should be 0"
      );
      assert.strictEqual(
        Number(trend.ambiguous),
        0,
        "Ambiguous count should be 0"
      );
    });
  });

  test("GET /api/insights/emotionTrends - should handle unauthorized access", async () => {
    const response = await api.get("/api/insights/emotionTrends").expect(401);

    assert.strictEqual(
      response.body.message,
      "No token provided",
      "Should reject unauthorized access"
    );
  });
});
