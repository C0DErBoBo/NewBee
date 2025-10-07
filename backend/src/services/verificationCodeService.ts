import bcrypt from 'bcryptjs';
import { pool } from '../database/client';

const CODE_TTL_MINUTES = 5;

function randomSixDigitCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function generateVerificationCode(phone: string) {
  const code = randomSixDigitCode();
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000);

  await pool.query(
    `
      DELETE FROM verification_codes
      WHERE phone = $1 OR expires_at < NOW()
    `,
    [phone]
  );

  await pool.query(
    `
      INSERT INTO verification_codes (phone, code_hash, expires_at)
      VALUES ($1, $2, $3)
    `,
    [phone, codeHash, expiresAt]
  );

  return {
    code,
    expiresAt
  };
}

export async function verifyCode(phone: string, code: string) {
  const result = await pool.query(
    `
      SELECT id, code_hash, expires_at
      FROM verification_codes
      WHERE phone = $1
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [phone]
  );

  const record = result.rows[0];
  if (!record) {
    return false;
  }

  if (new Date(record.expires_at).getTime() < Date.now()) {
    await pool.query('DELETE FROM verification_codes WHERE id = $1', [
      record.id
    ]);
    return false;
  }

  const isMatch = await bcrypt.compare(code, record.code_hash);

  if (isMatch) {
    await pool.query('DELETE FROM verification_codes WHERE id = $1', [
      record.id
    ]);
  }

  return isMatch;
}
