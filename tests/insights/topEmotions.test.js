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

describe("Top Emotions Analysis", () => {
  test("GET /api/insights/topEmotions - should return top 5 emotions from last 30 days", async () => {
    // Create test journal entries with emotions
    const testJournals = [
      {
        title: "Grateful Day",
        content: "Today I feel incredibly grateful.",
      },
      {
        title: "Joyful Moments",
        content: "Another happy day!",
      },
      {
        title: "Love and Joy",
        content: "Feeling blessed.",
      },
    ];

    // Create the journal entries with proper JSONB handling
    for (const journal of testJournals) {
      const response = await api
        .post("/api/journals")
        .set("Authorization", "Bearer mock-insights-token")
        .send({
          title: journal.title,
          content: journal.content,
          emotions: JSON.stringify(journal.emotions),
        })
        .expect(201);

      // Verify emotions were stored correctly
      assert(
        response.body.emotions,
        "Journal entry should have emotions field"
      );
    }

    // Test the topEmotions endpoint
    const response = await api
      .get("/api/insights/topEmotions")
      .set("Authorization", "Bearer mock-insights-token")
      .expect(200);

    // Verify response structure
    assert(response.body.topEmotions, "Response should have topEmotions field");
    assert(
      Array.isArray(response.body.topEmotions),
      "topEmotions should be an array"
    );
    assert(
      response.body.topEmotions.length <= 5,
      "Should return maximum 5 emotions"
    );

    // Verify each emotion entry structure
    response.body.topEmotions.forEach((item) => {
      assert(item.emotion, "Each item should have emotion field");
      assert(
        typeof Number(item.count) === "number" && !isNaN(Number(item.count)),
        "Each item should have count as number or number string"
      );
    });

    // Convert all counts to numbers for comparison
    const emotionsWithCounts = response.body.topEmotions.map((item) => ({
      emotion: item.emotion,
      count: Number(item.count),
    }));

    response.body.topEmotions.forEach((item) => {
      assert(item.emotion, "Each item should have emotion field");
      assert(
        typeof Number(item.count) === "number",
        `Count should be a number, got ${typeof item.count}`
      );
      assert(!isNaN(item.count), "Count should not be NaN");
    });

    // Verify ordering (should be descending by count)
    const counts = emotionsWithCounts.map((e) => e.count);
    assert(
      counts.every((val, i) => i === 0 || val <= counts[i - 1]),
      "Should be ordered by descending count"
    );
  });

  test("GET /api/insights/topEmotions - should handle no entries case", async () => {
    const response = await api
      .get("/api/insights/topEmotions")
      .set("Authorization", "Bearer mock-insights-token")
      .expect(200);

    assert.strictEqual(
      response.body.message,
      "No journal entries found in the last 30 days",
      "Should return appropriate message when no entries exist"
    );
  });

  test("GET /api/insights/topEmotions - should handle unauthorized access", async () => {
    const response = await api.get("/api/insights/topEmotions").expect(401);

    assert.strictEqual(
      response.body.message,
      "No token provided",
      "Should reject unauthorized access"
    );
  });
});
