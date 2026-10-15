/**
 * Creates the first Owner account interactively:
 *
 *   npm run create-owner
 *
 * Non-interactive use (e.g. provisioning): set OWNER_NAME, OWNER_EMAIL and
 * OWNER_PASSWORD in the environment. The password is never logged.
 */
const readline = require('readline');
const { withTransaction, pool } = require('../src/database/db');
const { hashPassword, isStrongPassword, PASSWORD_RULES } = require('../src/auth/password');

function ask(rl, question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    if (!hidden) return rl.question(question, (answer) => resolve(answer.trim()));
    const output = rl.output;
    const originalWrite = rl._writeToOutput;
    rl._writeToOutput = (text) => {
      if (text.includes(question)) output.write(text);
      else output.write('*');
    };
    rl.question(question, (answer) => {
      rl._writeToOutput = originalWrite;
      output.write('\n');
      resolve(answer);
    });
  });
}

async function promptForOwner() {
  if (process.env.OWNER_EMAIL) {
    return {
      fullName: process.env.OWNER_NAME || 'Owner',
      email: process.env.OWNER_EMAIL,
      password: process.env.OWNER_PASSWORD || '',
    };
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const fullName = await ask(rl, 'Full name: ');
    const email = await ask(rl, 'Email: ');
    const password = await ask(rl, 'Password: ', { hidden: true });
    const confirm = await ask(rl, 'Confirm password: ', { hidden: true });
    if (password !== confirm) throw new Error('Passwords do not match.');
    return { fullName, email, password };
  } finally {
    rl.close();
  }
}

async function main() {
  const input = await promptForOwner();
  const email = input.email.trim().toLowerCase();
  if (!input.fullName.trim()) throw new Error('Full name is required.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('A valid email is required.');
  if (!isStrongPassword(input.password)) throw new Error(PASSWORD_RULES);

  const passwordHash = await hashPassword(input.password);
  await withTransaction(async (client) => {
    const role = await client.query("SELECT id FROM roles WHERE code = 'OWNER'");
    if (!role.rows[0]) throw new Error('Roles are not seeded. Run "npm run seed" first.');

    const existing = await client.query('SELECT 1 FROM users WHERE lower(email) = $1 AND deleted_at IS NULL', [email]);
    if (existing.rows[0]) throw new Error('A user with this email already exists.');

    const { rows } = await client.query(
      `INSERT INTO users (full_name, email, password_hash, role_id)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [input.fullName.trim(), email, passwordHash, role.rows[0].id],
    );
    await client.query(
      `INSERT INTO audit_logs (user_id, role_at_time, action, entity_type, entity_id, description, new_values)
       VALUES ($1, 'OWNER', 'USER_CREATED', 'USER', $1, 'Owner account created from the command line', $2)`,
      [rows[0].id, JSON.stringify({ fullName: input.fullName.trim(), email, role: 'OWNER' })],
    );
  });
  console.log(`Owner account created for ${email}.`);
}

main()
  .catch((err) => {
    console.error(`Could not create owner: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
