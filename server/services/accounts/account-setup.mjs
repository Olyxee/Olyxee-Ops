export async function upsertAccountForSetup(client, {
  email,
  passwordHash,
  displayName,
  role,
}) {
  return client.query(`
    INSERT INTO public.ops_users (email, password_hash, display_name, role, active)
    VALUES ($1, $2, $3, $4, true)
    ON CONFLICT (email) DO UPDATE
    SET display_name = EXCLUDED.display_name,
        role = EXCLUDED.role,
        updated_at = now()
    RETURNING id, role
  `, [email, passwordHash, displayName, role]);
}

export async function redeemAccountSetupToken(client, { tokenHash, passwordHash }) {
  const setup = await client.query(`
    SELECT id, user_id
    FROM public.account_setup_tokens
    WHERE token_hash=$1 AND used_at IS NULL AND expires_at > now()
    FOR UPDATE
  `, [tokenHash]);
  if (!setup.rowCount) return null;

  await client.query(
    "UPDATE public.ops_users SET password_hash=$1, updated_at=now() WHERE id=$2",
    [passwordHash, setup.rows[0].user_id],
  );
  await client.query(
    "UPDATE public.account_setup_tokens SET used_at=now() WHERE id=$1",
    [setup.rows[0].id],
  );
  return setup.rows[0];
}