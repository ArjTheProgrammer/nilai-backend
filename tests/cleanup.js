const { pool } = require('../utils/config')
const admin = require('../firebaseAdmin')

// Clean up function to delete test users from Firebase
const deleteFirebaseUser = async (uid) => {
  try {
    await admin.auth().deleteUser(uid)
    console.log(`Deleted Firebase user: ${uid}`)
  } catch (error) {
    if (error.code !== 'auth/user-not-found') {
      console.error('Error deleting Firebase user:', error)
    }
  }
}

// Clean up function to delete ALL test users
const cleanupAllTestUsers = async () => {
  console.log('Starting comprehensive test cleanup...')

  try {
    // Clean up database first
    const dbResult = await pool.query(`
      DELETE FROM users 
      WHERE firebase_uid LIKE 'test-%' 
      OR email LIKE '%test%@example.com' 
      OR email LIKE '%test%@gmail.com'
      OR username LIKE '%test%'
      OR username LIKE '%tester%'
    `)
    console.log(`Deleted ${dbResult.rowCount} test users from database`)

    // Clean up Firebase
    const listUsersResult = await admin.auth().listUsers(1000)
    const testFirebaseUsers = listUsersResult.users.filter(user =>
      user.uid.startsWith('test-') ||
      (user.email && (
        user.email.includes('test') ||
        user.email.includes('example.com') ||
        user.email.includes('gmail.com')
      ))
    )

    for (const user of testFirebaseUsers) {
      await deleteFirebaseUser(user.uid)
    }

    console.log(`Deleted ${testFirebaseUsers.length} test users from Firebase`)
    console.log('Test cleanup completed successfully')

  } catch (error) {
    console.error('Error during test cleanup:', error)
  }
}

module.exports = {
  cleanupAllTestUsers,
  deleteFirebaseUser
}